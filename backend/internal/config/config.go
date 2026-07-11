// Package config provides application configuration loaded from environment variables.
// All settings have sensible defaults suitable for development. In production,
// override via environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all server configuration values.
// Values are loaded from environment variables with sensible defaults.
type Config struct {
	// Port is the TCP port the HTTP/WS server listens on.
	Port int

	// LogLevel controls structured logging verbosity ("debug", "info", "warn", "error").
	LogLevel string

	// MaxConnections is the maximum number of concurrent WebSocket connections.
	MaxConnections int

	// PoWDifficulty is the number of leading zero bits required in SHA-256 for PoW.
	PoWDifficulty int

	// PoWChallengeTTL is how long a PoW challenge remains valid.
	PoWChallengeTTL time.Duration

	// PoWTokenTTL is how long a PoW access token remains valid after verification.
	PoWTokenTTL time.Duration

	// RateLimitRate is the number of messages allowed per minute per account.
	RateLimitRate float64

	// RateLimitBurst is the maximum burst size for the rate limiter.
	RateLimitBurst int

	// MailboxMaxPerRecipient is the maximum number of stored envelopes per recipient.
	MailboxMaxPerRecipient int

	// MailboxTTL is how long envelopes are kept in the mailbox before expiry.
	MailboxTTL time.Duration

	// MailboxCleanupInterval is how often the mailbox cleanup goroutine runs.
	MailboxCleanupInterval time.Duration

	// ReadBufferSize is the WebSocket read buffer size in bytes.
	ReadBufferSize int

	// WriteBufferSize is the WebSocket write buffer size in bytes.
	WriteBufferSize int

	// WriteWait is the time allowed to write a message to the peer.
	WriteWait time.Duration

	// PongWait is the time allowed to read the next pong message from the peer.
	PongWait time.Duration

	// PingPeriod is the interval between pings sent to the peer. Must be less than PongWait.
	PingPeriod time.Duration

	// MaxMessageSize is the maximum allowed WebSocket message size in bytes.
	MaxMessageSize int64

	// ShutdownTimeout is the maximum time to wait for graceful shutdown.
	ShutdownTimeout time.Duration

	// CORSAllowedOrigins is the list of allowed CORS origins.
	CORSAllowedOrigins []string
}

// Load reads configuration from environment variables and returns a Config
// with defaults applied for any unset values.
func Load() (*Config, error) {
	cfg := &Config{
		Port:                   8080,
		LogLevel:               "info",
		MaxConnections:         10000,
		PoWDifficulty:          16,
		PoWChallengeTTL:        5 * time.Minute,
		PoWTokenTTL:            1 * time.Hour,
		RateLimitRate:          30,
		RateLimitBurst:         10,
		MailboxMaxPerRecipient: 1000,
		MailboxTTL:             7 * 24 * time.Hour,
		MailboxCleanupInterval: 15 * time.Minute,
		ReadBufferSize:         4096,
		WriteBufferSize:        4096,
		WriteWait:              10 * time.Second,
		PongWait:               60 * time.Second,
		PingPeriod:             54 * time.Second,
		MaxMessageSize:         65536, // 64 KB
		ShutdownTimeout:        15 * time.Second,
		CORSAllowedOrigins: []string{
			"http://localhost:1420",
			"http://127.0.0.1:1420",
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"tauri://localhost",
		},
	}

	if v := os.Getenv("CORS_ALLOWED_ORIGINS"); v != "" {
		cfg.CORSAllowedOrigins = strings.Split(v, ",")
	}

	if v := os.Getenv("PORT"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid PORT %q: %w", v, err)
		}
		if p < 1 || p > 65535 {
			return nil, fmt.Errorf("PORT must be between 1 and 65535, got %d", p)
		}
		cfg.Port = p
	}

	if v := os.Getenv("LOG_LEVEL"); v != "" {
		switch v {
		case "debug", "info", "warn", "error":
			cfg.LogLevel = v
		default:
			return nil, fmt.Errorf("invalid LOG_LEVEL %q: must be debug, info, warn, or error", v)
		}
	}

	if v := os.Getenv("MAX_CONNECTIONS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid MAX_CONNECTIONS %q: %w", v, err)
		}
		if n < 1 {
			return nil, fmt.Errorf("MAX_CONNECTIONS must be positive, got %d", n)
		}
		cfg.MaxConnections = n
	}

	if v := os.Getenv("POW_DIFFICULTY"); v != "" {
		d, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid POW_DIFFICULTY %q: %w", v, err)
		}
		if d < 1 || d > 32 {
			return nil, fmt.Errorf("POW_DIFFICULTY must be between 1 and 32, got %d", d)
		}
		cfg.PoWDifficulty = d
	}

	if v := os.Getenv("RATE_LIMIT_RATE"); v != "" {
		r, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid RATE_LIMIT_RATE %q: %w", v, err)
		}
		if r <= 0 {
			return nil, fmt.Errorf("RATE_LIMIT_RATE must be positive, got %f", r)
		}
		cfg.RateLimitRate = r
	}

	if v := os.Getenv("RATE_LIMIT_BURST"); v != "" {
		b, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid RATE_LIMIT_BURST %q: %w", v, err)
		}
		if b < 1 {
			return nil, fmt.Errorf("RATE_LIMIT_BURST must be positive, got %d", b)
		}
		cfg.RateLimitBurst = b
	}

	return cfg, nil
}

// Addr returns the formatted listen address string.
func (c *Config) Addr() string {
	return fmt.Sprintf(":%d", c.Port)
}
