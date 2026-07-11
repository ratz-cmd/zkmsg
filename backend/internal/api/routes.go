// Package api defines the HTTP and WebSocket routes for the ZKMsg server.
// All routes enforce the zero-knowledge principle: the server never sees
// plaintext message content or sender identity.
package api

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ratz/zkmsg-server/internal/antispam"
	"github.com/ratz/zkmsg-server/internal/config"
	"github.com/ratz/zkmsg-server/internal/hub"
	"github.com/ratz/zkmsg-server/internal/store"
)

// Server holds all dependencies needed by the HTTP/WebSocket handlers.
type Server struct {
	hub         *hub.Hub
	pow         *antispam.PoWVerifier
	rateLimiter *antispam.RateLimiter
	prekeys     *store.PreKeyStore
	mailbox     *store.Mailbox
	cfg         *config.Config
	logger      *slog.Logger
	upgrader    websocket.Upgrader
	startTime   time.Time

	activeConnections atomic.Int64
}

// NewServer creates a new API server with all dependencies wired up.
func NewServer(
	h *hub.Hub,
	pow *antispam.PoWVerifier,
	rl *antispam.RateLimiter,
	pk *store.PreKeyStore,
	mb *store.Mailbox,
	cfg *config.Config,
	logger *slog.Logger,
) *Server {
	return &Server{
		hub:         h,
		pow:         pow,
		rateLimiter: rl,
		prekeys:     pk,
		mailbox:     mb,
		cfg:         cfg,
		logger:      logger,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  cfg.ReadBufferSize,
			WriteBufferSize: cfg.WriteBufferSize,
			CheckOrigin: func(r *http.Request) bool {
				// In production, restrict to allowed origins.
				// For MVP, we validate via PoW token instead.
				return true
			},
		},
		startTime: time.Now(),
	}
}

// Routes returns an http.ServeMux with all routes registered.
func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /ws", s.handleWebSocket)
	mux.HandleFunc("POST /prekeys", s.handleUploadPreKeys)
	mux.HandleFunc("GET /prekeys/{account_id}", s.handleFetchPreKeys)
	mux.HandleFunc("POST /pow/challenge", s.handlePoWChallenge)
	mux.HandleFunc("POST /pow/verify", s.handlePoWVerify)
	mux.HandleFunc("GET /metrics", s.handleMetrics)

	return mux
}

// handleHealth responds with server health status.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	resp := map[string]interface{}{
		"status":  "ok",
		"version": "0.1.0-mvp",
		"uptime":  time.Since(s.startTime).String(),
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// handleWebSocket upgrades an HTTP connection to WebSocket.
// Requires a valid PoW token in the "token" query parameter and an "account_id"
// (hex-encoded 32-byte public identity) in the query.
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Validate PoW token.
	token := r.URL.Query().Get("token")
	accountIDHex := r.URL.Query().Get("account_id")

	s.logger.Info("🚨 WS HANDSHAKE START", 
		slog.String("token", token), 
		slog.String("account_id_hex", accountIDHex),
	)

	if token == "" {
		s.logger.Warn("❌ WS REJECTED: missing token")
		http.Error(w, `{"error":"missing token"}`, http.StatusUnauthorized)
		return
	}

	if !s.pow.ValidateToken(token) {
		s.logger.Warn("❌ WS REJECTED: invalid or expired token", slog.String("token", token))
		http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
		return
	}

	// Parse account ID.
	accountID, err := parseAccountID(accountIDHex)
	if err != nil {
		s.logger.Warn("❌ WS REJECTED: invalid account ID", slog.String("account_id_hex", accountIDHex), slog.String("error", err.Error()))
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	// Check max connections.
	if s.hub.ConnectionCount() >= s.cfg.MaxConnections {
		s.logger.Warn("❌ WS REJECTED: server at capacity")
		http.Error(w, `{"error":"server at capacity"}`, http.StatusServiceUnavailable)
		return
	}

	// Upgrade to WebSocket.
	s.logger.Info("🔌 Attempting WebSocket upgrade...", slog.String("account_id", accountIDHex))
	ws, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error("❌ WS UPGRADE FAILED", slog.String("error", err.Error()))
		return
	}
	s.logger.Info("✅ WS UPGRADE SUCCESSFUL", slog.String("account_id", accountIDHex))

	// Revoke the PoW token (single-use for connection establishment).
	s.pow.RevokeToken(token)

	// Create connection and register with hub.
	conn := hub.NewConnection(s.hub, ws, accountID, s.rateLimiter, s.logger)
	s.hub.Register(conn, accountID)

	s.activeConnections.Add(1)

	// Start read and write pumps.
	go conn.WritePump()
	go func() {
		conn.ReadPump()
		s.activeConnections.Add(-1)
	}()
}

// powChallengeResponse is the JSON response for PoW challenge requests.
type powChallengeResponse = antispam.ChallengeResponse

// handlePoWChallenge issues a new proof-of-work challenge.
func (s *Server) handlePoWChallenge(w http.ResponseWriter, r *http.Request) {
	challenge, err := s.pow.GenerateChallenge()
	if err != nil {
		s.logger.Error("failed to generate PoW challenge", slog.String("error", err.Error()))
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(challenge)
}

// powVerifyRequest is the JSON request body for PoW solution submission.
type powVerifyRequest struct {
	Nonce string `json:"nonce"`
	Proof string `json:"proof"`
}

// powVerifyResponse is the JSON response after successful PoW verification.
type powVerifyResponse struct {
	Token     string `json:"token"`
	ExpiresIn int64  `json:"expires_in"`
}

// handlePoWVerify validates a submitted PoW solution and returns an access token.
func (s *Server) handlePoWVerify(w http.ResponseWriter, r *http.Request) {
	var req powVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if req.Nonce == "" || req.Proof == "" {
		http.Error(w, `{"error":"nonce and proof are required"}`, http.StatusBadRequest)
		return
	}

	proofBytes, err := hex.DecodeString(req.Proof)
	if err != nil {
		http.Error(w, `{"error":"proof must be hex-encoded"}`, http.StatusBadRequest)
		return
	}

	token, err := s.pow.VerifyProof(req.Nonce, proofBytes)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(powVerifyResponse{
		Token:     token,
		ExpiresIn: int64(s.cfg.PoWTokenTTL.Seconds()),
	})
}

// preKeyUploadRequest is the JSON body for uploading prekey bundles.
type preKeyUploadRequest struct {
	AccountID      string   `json:"account_id"`
	IdentityKey    string   `json:"identity_key"`
	SignedPreKey   string   `json:"signed_prekey"`
	SignedPreKeySig string  `json:"signed_prekey_sig"`
	OneTimePreKeys []string `json:"one_time_prekeys"`
}

// handleUploadPreKeys stores a prekey bundle for the given account.
func (s *Server) handleUploadPreKeys(w http.ResponseWriter, r *http.Request) {
	// Validate PoW token from Authorization header.
	token := extractBearerToken(r)
	if token == "" {
		http.Error(w, `{"error":"missing authorization token"}`, http.StatusUnauthorized)
		return
	}
	if !s.pow.ValidateToken(token) {
		http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
		return
	}

	var req preKeyUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	accountID, err := parseAccountID(req.AccountID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	identityKey, err := hex.DecodeString(req.IdentityKey)
	if err != nil || len(identityKey) == 0 {
		http.Error(w, `{"error":"invalid identity_key"}`, http.StatusBadRequest)
		return
	}

	signedPreKey, err := hex.DecodeString(req.SignedPreKey)
	if err != nil || len(signedPreKey) == 0 {
		http.Error(w, `{"error":"invalid signed_prekey"}`, http.StatusBadRequest)
		return
	}

	signedPreKeySig, err := hex.DecodeString(req.SignedPreKeySig)
	if err != nil || len(signedPreKeySig) == 0 {
		http.Error(w, `{"error":"invalid signed_prekey_sig"}`, http.StatusBadRequest)
		return
	}

	otpks := make([][]byte, 0, len(req.OneTimePreKeys))
	for i, otpkHex := range req.OneTimePreKeys {
		otpk, err := hex.DecodeString(otpkHex)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"invalid one_time_prekey at index %d"}`, i), http.StatusBadRequest)
			return
		}
		otpks = append(otpks, otpk)
	}

	bundle := store.PreKeyBundle{
		IdentityKey:     identityKey,
		SignedPreKey:    signedPreKey,
		SignedPreKeySig: signedPreKeySig,
		OneTimePreKeys:  otpks,
	}

	if err := s.prekeys.Upload(accountID, bundle); err != nil {
		s.logger.Error("failed to upload prekeys", slog.String("error", err.Error()))
		http.Error(w, `{"error":"failed to store prekeys"}`, http.StatusInternalServerError)
		return
	}

	remaining := s.prekeys.CountRemaining(accountID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":              "ok",
		"remaining_one_time":  remaining,
	})
}

// handleFetchPreKeys retrieves a prekey bundle for the specified account.
// One one-time prekey is consumed on each fetch.
func (s *Server) handleFetchPreKeys(w http.ResponseWriter, r *http.Request) {
	// Validate PoW token.
	token := extractBearerToken(r)
	if token == "" {
		http.Error(w, `{"error":"missing authorization token"}`, http.StatusUnauthorized)
		return
	}
	if !s.pow.ValidateToken(token) {
		http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
		return
	}

	accountIDHex := r.PathValue("account_id")
	accountID, err := parseAccountID(accountIDHex)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	bundle, err := s.prekeys.Fetch(accountID)
	if err != nil {
		http.Error(w, `{"error":"no prekey bundle found"}`, http.StatusNotFound)
		return
	}

	// Encode bundle fields back to hex for JSON response.
	resp := map[string]interface{}{
		"identity_key":     hex.EncodeToString(bundle.IdentityKey),
		"signed_prekey":    hex.EncodeToString(bundle.SignedPreKey),
		"signed_prekey_sig": hex.EncodeToString(bundle.SignedPreKeySig),
	}

	if len(bundle.OneTimePreKeys) > 0 {
		otpks := make([]string, len(bundle.OneTimePreKeys))
		for i, otpk := range bundle.OneTimePreKeys {
			otpks[i] = hex.EncodeToString(otpk)
		}
		resp["one_time_prekeys"] = otpks
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// metricsResponse is the JSON response for the metrics endpoint.
type metricsResponse struct {
	Uptime            string `json:"uptime"`
	UptimeSeconds     int64  `json:"uptime_seconds"`
	ActiveConnections int    `json:"active_connections"`
	TotalConnections  int64  `json:"total_connections"`
	EnvelopesRouted   int64  `json:"envelopes_routed"`
	EnvelopesStored   int64  `json:"envelopes_stored"`
	MailboxMessages   int    `json:"mailbox_messages"`
	PreKeyAccounts    int    `json:"prekey_accounts"`
	RateLimitBuckets  int    `json:"rate_limit_buckets"`
}

// handleMetrics returns basic server metrics for monitoring.
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(s.startTime)

	resp := metricsResponse{
		Uptime:            uptime.String(),
		UptimeSeconds:     int64(uptime.Seconds()),
		ActiveConnections: s.hub.ConnectionCount(),
		TotalConnections:  s.hub.TotalConnections(),
		EnvelopesRouted:   s.hub.EnvelopesRouted(),
		EnvelopesStored:   s.hub.EnvelopesStored(),
		MailboxMessages:   s.mailbox.TotalCount(),
		PreKeyAccounts:    s.prekeys.AccountCount(),
		RateLimitBuckets:  s.rateLimiter.BucketCount(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// parseAccountID parses and validates a hex-encoded 32-byte account ID.
func parseAccountID(hexStr string) ([32]byte, error) {
	var id [32]byte

	if hexStr == "" {
		return id, fmt.Errorf("account_id is required")
	}

	decoded, err := hex.DecodeString(hexStr)
	if err != nil {
		return id, fmt.Errorf("account_id must be valid hex: %w", err)
	}

	if len(decoded) != 32 {
		return id, fmt.Errorf("account_id must be exactly 32 bytes (64 hex chars), got %d bytes", len(decoded))
	}

	copy(id[:], decoded)

	// Reject all-zero IDs.
	allZero := true
	for _, b := range id {
		if b != 0 {
			allZero = false
			break
		}
	}
	if allZero {
		return id, fmt.Errorf("account_id must not be all zeros")
	}

	return id, nil
}

// extractBearerToken extracts a bearer token from the Authorization header.
// Expected format: "Bearer <token>"
func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return ""
	}
	return strings.TrimSpace(auth[len(prefix):])
}
