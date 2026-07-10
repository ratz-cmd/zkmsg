// ZKMsg Server — Phase 1 MVP
//
// A zero-knowledge messaging relay server. The server routes opaque encrypted
// envelopes between clients based on recipient IDs. It never sees plaintext
// message content or sender identity.
//
// Usage:
//
//	PORT=8080 POW_DIFFICULTY=16 LOG_LEVEL=info go run ./cmd/server
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ratz/zkmsg-server/internal/antispam"
	"github.com/ratz/zkmsg-server/internal/api"
	"github.com/ratz/zkmsg-server/internal/config"
	"github.com/ratz/zkmsg-server/internal/hub"
	"github.com/ratz/zkmsg-server/internal/middleware"
	"github.com/ratz/zkmsg-server/internal/store"
)

func main() {
	// Load configuration from environment variables.
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "configuration error: %v\n", err)
		os.Exit(1)
	}

	// Set up structured logger.
	logger := setupLogger(cfg.LogLevel)
	logger.Info("starting ZKMsg server",
		slog.Int("port", cfg.Port),
		slog.String("log_level", cfg.LogLevel),
		slog.Int("max_connections", cfg.MaxConnections),
		slog.Int("pow_difficulty", cfg.PoWDifficulty),
	)

	// done channel signals background goroutines to stop.
	done := make(chan struct{})

	// Initialize stores.
	mailbox := store.NewMailbox(cfg.MailboxMaxPerRecipient, cfg.MailboxTTL)
	mailbox.StartCleanup(cfg.MailboxCleanupInterval, done)

	prekeyStore := store.NewPreKeyStore()

	// Initialize anti-spam.
	rateLimiter := antispam.NewRateLimiter(cfg.RateLimitRate, cfg.RateLimitBurst)
	rateLimiter.StartCleanup(5*time.Minute, done)

	powVerifier := antispam.NewPoWVerifier(cfg.PoWDifficulty, cfg.PoWChallengeTTL, cfg.PoWTokenTTL)
	powVerifier.StartCleanup(1*time.Minute, done)

	// Initialize hub.
	wsHub := hub.NewHub(mailbox, rateLimiter, logger)

	// Initialize API server.
	apiServer := api.NewServer(wsHub, powVerifier, rateLimiter, prekeyStore, mailbox, cfg, logger)

	// Build route handler with middleware.
	handler := middleware.Chain(
		apiServer.Routes(),
		middleware.RequestID,
		middleware.Logging(logger),
		middleware.Recovery(logger),
		middleware.CORS(cfg.CORSAllowedOrigins),
	)

	// Create HTTP server.
	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler,
		ReadTimeout:       15 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 16, // 64 KB
	}

	// Start server in a goroutine.
	serverErr := make(chan error, 1)
	go func() {
		logger.Info("HTTP server listening", slog.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	// Wait for interrupt signal or server error.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		logger.Info("received shutdown signal", slog.String("signal", sig.String()))
	case err := <-serverErr:
		logger.Error("server error", slog.String("error", err.Error()))
	}

	// Graceful shutdown.
	logger.Info("initiating graceful shutdown", slog.Duration("timeout", cfg.ShutdownTimeout))

	// Signal background goroutines to stop.
	close(done)

	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("server shutdown error", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("server stopped gracefully")
}

// setupLogger creates a structured slog.Logger at the specified level.
func setupLogger(level string) *slog.Logger {
	var logLevel slog.Level
	switch level {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level: logLevel,
	}

	handler := slog.NewJSONHandler(os.Stdout, opts)
	return slog.New(handler)
}
