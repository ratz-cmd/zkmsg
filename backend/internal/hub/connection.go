package hub

import (
	"log/slog"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ratz/zkmsg-server/internal/antispam"
	"github.com/ratz/zkmsg-server/internal/envelope"
)

const (
	// writeWait is the time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// pongWait is the time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// pingPeriod is the interval at which pings are sent. Must be less than pongWait.
	pingPeriod = 54 * time.Second

	// maxMessageSize is the maximum message size allowed from the peer (64 KB).
	maxMessageSize = 65536

	// sendBufferSize is the channel buffer size for outgoing messages.
	sendBufferSize = 256
)

// Connection wraps a WebSocket connection with read/write pumps and keepalive.
// Each connection is associated with an account ID for routing purposes.
type Connection struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte
	accountID [32]byte
	logger    *slog.Logger
	limiter   *antispam.RateLimiter
	done      chan struct{}
}

// NewConnection creates a new Connection wrapping a WebSocket connection.
// The caller must start ReadPump and WritePump as goroutines after creation.
func NewConnection(hub *Hub, ws *websocket.Conn, accountID [32]byte, limiter *antispam.RateLimiter, logger *slog.Logger) *Connection {
	return &Connection{
		hub:       hub,
		conn:      ws,
		send:      make(chan []byte, sendBufferSize),
		accountID: accountID,
		logger:    logger,
		limiter:   limiter,
		done:      make(chan struct{}),
	}
}

// ReadPump reads messages from the WebSocket connection and forwards valid
// envelopes to the hub for routing. It runs until the connection is closed
// or an error occurs. ReadPump must be run as a goroutine — only one goroutine
// should read from a connection.
func (c *Connection) ReadPump() {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)

	if err := c.conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		c.logger.Warn("failed to set read deadline", slog.String("error", err.Error()))
		return
	}

	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		messageType, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				c.logger.Warn("unexpected websocket close",
					slog.String("account_prefix", formatIDPrefix(c.accountID)),
					slog.String("error", err.Error()),
				)
			}
			return
		}

		// Intercept frontend keep-alive pings and extend read deadline.
		if messageType == websocket.TextMessage && string(message) == "ping" {
			_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
			continue
		}

		// Only process binary messages (envelopes are binary).
		if messageType != websocket.BinaryMessage {
			c.logger.Debug("ignoring non-binary message",
				slog.String("account_prefix", formatIDPrefix(c.accountID)),
				slog.Int("type", messageType),
			)
			continue
		}

		// Rate limit check.
		if !c.limiter.Allow(c.accountID) {
			c.logger.Warn("rate limited",
				slog.String("account_prefix", formatIDPrefix(c.accountID)),
			)
			// Send a rate-limit error frame back to the client.
			c.sendError("rate_limited")
			continue
		}

		// Parse and validate the envelope.
		env, err := envelope.Parse(message)
		if err != nil {
			c.logger.Warn("invalid envelope",
				slog.String("account_prefix", formatIDPrefix(c.accountID)),
				slog.String("error", err.Error()),
			)
			c.sendError("invalid_envelope")
			continue
		}

		// Route the envelope through the hub.
		c.hub.RouteEnvelope(env)
	}
}

// WritePump pumps messages from the send channel to the WebSocket connection.
// It also handles ping/pong keepalive. WritePump must be run as a goroutine —
// only one goroutine should write to a connection.
func (c *Connection) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				c.logger.Warn("failed to set write deadline", slog.String("error", err.Error()))
				return
			}

			if !ok {
				// Hub closed the channel.
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.BinaryMessage, message); err != nil {
				c.logger.Warn("write error",
					slog.String("account_prefix", formatIDPrefix(c.accountID)),
					slog.String("error", err.Error()),
				)
				return
			}

		case <-ticker.C:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				c.logger.Warn("failed to set write deadline for ping", slog.String("error", err.Error()))
				return
			}

			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.logger.Debug("ping failed",
					slog.String("account_prefix", formatIDPrefix(c.accountID)),
					slog.String("error", err.Error()),
				)
				return
			}

		case <-c.done:
			return
		}
	}
}

// Close signals the connection to shut down.
func (c *Connection) Close() {
	select {
	case <-c.done:
		// Already closed.
	default:
		close(c.done)
	}
}

// sendError sends a text error message to the client. This is best-effort;
// failures are silently ignored since the connection may already be closing.
func (c *Connection) sendError(errCode string) {
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	_ = c.conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"`+errCode+`"}`))
}
