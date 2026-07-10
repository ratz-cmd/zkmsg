// Package middleware provides HTTP middleware for logging, panic recovery,
// CORS enforcement, and request ID tracking.
package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// contextKey is an unexported type for context keys in this package.
type contextKey string

// RequestIDKey is the context key for the request ID.
const RequestIDKey contextKey = "request_id"

// GetRequestID extracts the request ID from the request context.
// Returns an empty string if no request ID is set.
func GetRequestID(r *http.Request) string {
	if id, ok := r.Context().Value(RequestIDKey).(string); ok {
		return id
	}
	return ""
}

// RequestID is middleware that generates a unique request ID for each request
// and adds it to the request context and response headers.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var idBytes [16]byte
		if _, err := rand.Read(idBytes[:]); err != nil {
			// Fallback to timestamp-based ID if crypto/rand fails.
			id := fmt.Sprintf("req-%d", time.Now().UnixNano())
			ctx := context.WithValue(r.Context(), RequestIDKey, id)
			w.Header().Set("X-Request-ID", id)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		id := hex.EncodeToString(idBytes[:])
		ctx := context.WithValue(r.Context(), RequestIDKey, id)
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	written    bool
}

// WriteHeader captures the status code before writing it.
func (rw *responseWriter) WriteHeader(code int) {
	if !rw.written {
		rw.statusCode = code
		rw.written = true
	}
	rw.ResponseWriter.WriteHeader(code)
}

// Write captures a 200 status if WriteHeader hasn't been called yet.
func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.written {
		rw.statusCode = http.StatusOK
		rw.written = true
	}
	return rw.ResponseWriter.Write(b)
}

// Logging is middleware that logs each HTTP request with structured logging (slog).
// It records method, path, status code, duration, and request ID.
func Logging(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

			next.ServeHTTP(rw, r)

			duration := time.Since(start)
			reqID := GetRequestID(r)

			logger.Info("http request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", rw.statusCode),
				slog.Duration("duration", duration),
				slog.String("request_id", reqID),
				slog.String("remote_addr", r.RemoteAddr),
			)
		})
	}
}

// Recovery is middleware that recovers from panics in downstream handlers,
// logs the panic, and returns a 500 Internal Server Error to the client.
// This prevents a single panicking request from crashing the entire server.
func Recovery(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					reqID := GetRequestID(r)
					logger.Error("panic recovered",
						slog.Any("panic", rec),
						slog.String("method", r.Method),
						slog.String("path", r.URL.Path),
						slog.String("request_id", reqID),
					)
					http.Error(w, "internal server error", http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// CORS is middleware that enforces Cross-Origin Resource Sharing headers.
// Only the specified origins are allowed. An empty allowedOrigins list blocks
// all cross-origin requests.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		originSet[strings.TrimRight(o, "/")] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			if origin != "" {
				_, allowed := originSet[strings.TrimRight(origin, "/")]
				if allowed {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
					w.Header().Set("Access-Control-Max-Age", "3600")
					w.Header().Set("Vary", "Origin")
				}
			}

			// Handle preflight OPTIONS requests.
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// Chain applies a sequence of middleware to a handler, in the order provided.
// The first middleware in the list is the outermost (runs first).
func Chain(handler http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	// Apply in reverse order so that the first middleware listed wraps the outermost layer.
	for i := len(middlewares) - 1; i >= 0; i-- {
		handler = middlewares[i](handler)
	}
	return handler
}
