// Package hub implements the WebSocket connection hub with sealed-sender routing.
// The hub manages active connections indexed by account ID, routes opaque encrypted
// envelopes to recipients, and stores messages for offline users in the mailbox.
// The hub NEVER inspects envelope content — it only reads routing metadata.
package hub

import (
	"log/slog"
	"sync"
	"sync/atomic"

	"github.com/ratz/zkmsg-server/internal/antispam"
	"github.com/ratz/zkmsg-server/internal/envelope"
	"github.com/ratz/zkmsg-server/internal/store"
)

// Hub manages WebSocket connections indexed by account_id for sealed-sender routing.
// It is safe for concurrent use.
type Hub struct {
	mu          sync.RWMutex
	connections map[[32]byte]*Connection

	mailbox     *store.Mailbox
	rateLimiter *antispam.RateLimiter
	logger      *slog.Logger

	// Metrics counters.
	envelopesRouted  atomic.Int64
	envelopesStored  atomic.Int64
	totalConnections atomic.Int64
}

// NewHub creates a new connection hub with the given dependencies.
func NewHub(mailbox *store.Mailbox, rateLimiter *antispam.RateLimiter, logger *slog.Logger) *Hub {
	return &Hub{
		connections: make(map[[32]byte]*Connection),
		mailbox:     mailbox,
		rateLimiter: rateLimiter,
		logger:      logger,
	}
}

// Register adds a connection to the hub under the given accountID.
// If a previous connection exists for this accountID, it is closed and replaced.
// After registration, any stored mailbox messages are delivered to the connection.
func (h *Hub) Register(conn *Connection, accountID [32]byte) {
	h.mu.Lock()

	// Close existing connection for this account (only one session per account).
	if existing, ok := h.connections[accountID]; ok {
		h.logger.Info("replacing existing connection",
			slog.String("account_prefix", formatIDPrefix(accountID)),
		)
		existing.Close()
	}

	h.connections[accountID] = conn
	h.totalConnections.Add(1)
	h.mu.Unlock()

	h.logger.Info("connection registered",
		slog.String("account_prefix", formatIDPrefix(accountID)),
		slog.Int("total", h.ConnectionCount()),
	)

	// Deliver any queued mailbox messages.
	h.deliverMailbox(conn, accountID)
}

// Unregister removes a connection from the hub.
func (h *Hub) Unregister(conn *Connection) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Find and remove the connection by comparing pointers.
	for id, c := range h.connections {
		if c == conn {
			delete(h.connections, id)
			h.logger.Info("connection unregistered",
				slog.String("account_prefix", formatIDPrefix(id)),
				slog.Int("total", len(h.connections)),
			)
			return
		}
	}
}

// RouteEnvelope delivers an envelope to its recipient if online, otherwise
// stores it in the mailbox for later delivery. The hub never inspects the
// envelope payload — it only reads the Recipient field for routing.
func (h *Hub) RouteEnvelope(env *envelope.Envelope) {
	h.mu.RLock()
	conn, online := h.connections[env.Recipient]
	h.mu.RUnlock()

	if online {
		data := env.Serialize()
		select {
		case conn.send <- data:
			h.envelopesRouted.Add(1)
			h.logger.Debug("envelope routed to online recipient",
				slog.String("recipient_prefix", formatIDPrefix(env.Recipient)),
				slog.Int("size", len(data)),
			)
		default:
			// Send buffer full — store in mailbox as fallback.
			h.storeInMailbox(env)
		}
	} else {
		h.storeInMailbox(env)
	}
}

// storeInMailbox stores an envelope in the offline mailbox.
func (h *Hub) storeInMailbox(env *envelope.Envelope) {
	if err := h.mailbox.Store(env.Recipient, env); err != nil {
		h.logger.Warn("failed to store envelope in mailbox",
			slog.String("recipient_prefix", formatIDPrefix(env.Recipient)),
			slog.String("error", err.Error()),
		)
		return
	}
	h.envelopesStored.Add(1)
	h.logger.Debug("envelope stored in mailbox",
		slog.String("recipient_prefix", formatIDPrefix(env.Recipient)),
	)
}

// deliverMailbox sends all queued mailbox messages to a newly connected client.
func (h *Hub) deliverMailbox(conn *Connection, accountID [32]byte) {
	envelopes, err := h.mailbox.Fetch(accountID)
	if err != nil {
		h.logger.Warn("failed to fetch mailbox",
			slog.String("account_prefix", formatIDPrefix(accountID)),
			slog.String("error", err.Error()),
		)
		return
	}

	for _, env := range envelopes {
		data := env.Serialize()
		select {
		case conn.send <- data:
			h.logger.Debug("delivered mailbox message",
				slog.String("account_prefix", formatIDPrefix(accountID)),
			)
		default:
			h.logger.Warn("send buffer full during mailbox delivery, re-storing",
				slog.String("account_prefix", formatIDPrefix(accountID)),
			)
			// Re-store messages that couldn't be delivered.
			_ = h.mailbox.Store(accountID, env)
		}
	}

	if len(envelopes) > 0 {
		h.logger.Info("delivered mailbox messages",
			slog.String("account_prefix", formatIDPrefix(accountID)),
			slog.Int("count", len(envelopes)),
		)
	}
}

// ConnectionCount returns the current number of active connections.
func (h *Hub) ConnectionCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.connections)
}

// EnvelopesRouted returns the total number of envelopes routed to online recipients.
func (h *Hub) EnvelopesRouted() int64 {
	return h.envelopesRouted.Load()
}

// EnvelopesStored returns the total number of envelopes stored in the mailbox.
func (h *Hub) EnvelopesStored() int64 {
	return h.envelopesStored.Load()
}

// TotalConnections returns the total number of connections ever registered.
func (h *Hub) TotalConnections() int64 {
	return h.totalConnections.Load()
}

// formatIDPrefix returns a hex-like prefix of an account ID for logging.
// We log only a prefix to avoid leaking full account identifiers.
func formatIDPrefix(id [32]byte) string {
	const hexChars = "0123456789abcdef"
	out := make([]byte, 8) // 4 bytes = 8 hex chars
	for i := 0; i < 4; i++ {
		out[i*2] = hexChars[id[i]>>4]
		out[i*2+1] = hexChars[id[i]&0x0f]
	}
	return string(out) + "..."
}
