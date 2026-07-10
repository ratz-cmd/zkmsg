// Package antispam provides proof-of-work challenge/verification and rate limiting
// to protect the server from abuse without requiring user identity.
package antispam

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Challenge represents a proof-of-work challenge issued to a client.
type Challenge struct {
	// Nonce is the random 32-byte value the client must incorporate into its proof.
	Nonce [32]byte

	// Difficulty is the number of leading zero bits required in the SHA-256 hash.
	Difficulty int

	// ExpiresAt is the deadline after which this challenge is no longer valid.
	ExpiresAt time.Time
}

// ChallengeResponse is the serializable form of a challenge sent to clients.
type ChallengeResponse struct {
	// NonceHex is the hex-encoded nonce.
	NonceHex string `json:"nonce"`

	// Difficulty is the required number of leading zero bits.
	Difficulty int `json:"difficulty"`

	// ExpiresAt is the expiration timestamp (Unix seconds).
	ExpiresAt int64 `json:"expires_at"`
}

// AccessToken represents a time-limited access token obtained after solving a PoW challenge.
type AccessToken struct {
	// Token is the 32-byte opaque token value.
	Token [32]byte

	// ExpiresAt is the deadline after which this token is no longer valid.
	ExpiresAt time.Time
}

// PoWVerifier manages proof-of-work challenge issuance and verification.
type PoWVerifier struct {
	mu         sync.Mutex
	challenges map[string]*Challenge // keyed by hex(nonce)
	tokens     map[string]*AccessToken
	difficulty int
	challengeTTL time.Duration
	tokenTTL     time.Duration
}

// NewPoWVerifier creates a new PoW verifier with the given difficulty and TTLs.
// Difficulty specifies the number of leading zero bits required in SHA-256(nonce || solution).
func NewPoWVerifier(difficulty int, challengeTTL, tokenTTL time.Duration) *PoWVerifier {
	pv := &PoWVerifier{
		challenges:   make(map[string]*Challenge),
		tokens:       make(map[string]*AccessToken),
		difficulty:   difficulty,
		challengeTTL: challengeTTL,
		tokenTTL:     tokenTTL,
	}
	return pv
}

// StartCleanup launches a background goroutine that periodically removes expired
// challenges and tokens. It stops when the done channel is closed.
func (pv *PoWVerifier) StartCleanup(interval time.Duration, done <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				pv.cleanup()
			}
		}
	}()
}

// cleanup removes expired challenges and tokens.
func (pv *PoWVerifier) cleanup() {
	pv.mu.Lock()
	defer pv.mu.Unlock()

	now := time.Now()
	for k, c := range pv.challenges {
		if now.After(c.ExpiresAt) {
			delete(pv.challenges, k)
		}
	}
	for k, t := range pv.tokens {
		if now.After(t.ExpiresAt) {
			delete(pv.tokens, k)
		}
	}
}

// GenerateChallenge creates a new PoW challenge with a random nonce.
// The client must find a solution such that SHA-256(nonce || solution) has
// the required number of leading zero bits.
func (pv *PoWVerifier) GenerateChallenge() (*ChallengeResponse, error) {
	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, fmt.Errorf("failed to generate nonce: %w", err)
	}

	challenge := &Challenge{
		Nonce:      nonce,
		Difficulty: pv.difficulty,
		ExpiresAt:  time.Now().Add(pv.challengeTTL),
	}

	nonceHex := hex.EncodeToString(nonce[:])

	pv.mu.Lock()
	pv.challenges[nonceHex] = challenge
	pv.mu.Unlock()

	return &ChallengeResponse{
		NonceHex:   nonceHex,
		Difficulty: pv.difficulty,
		ExpiresAt:  challenge.ExpiresAt.Unix(),
	}, nil
}

// VerifyProof checks whether the submitted solution satisfies the PoW challenge.
// The proof must be exactly 32 bytes. On success, the challenge is consumed
// (one-time use) and an access token is returned.
func (pv *PoWVerifier) VerifyProof(nonceHex string, proof []byte) (string, error) {
	if len(proof) != 32 {
		return "", errors.New("proof must be exactly 32 bytes")
	}

	nonceBytes, err := hex.DecodeString(nonceHex)
	if err != nil || len(nonceBytes) != 32 {
		return "", errors.New("invalid nonce format")
	}

	pv.mu.Lock()
	challenge, exists := pv.challenges[nonceHex]
	if exists {
		// Consume the challenge immediately (one-time use).
		delete(pv.challenges, nonceHex)
	}
	pv.mu.Unlock()

	if !exists {
		return "", errors.New("unknown or expired challenge")
	}

	if time.Now().After(challenge.ExpiresAt) {
		return "", errors.New("challenge has expired")
	}

	// Verify: SHA-256(nonce || proof) must have N leading zero bits.
	h := sha256.New()
	h.Write(challenge.Nonce[:])
	h.Write(proof)
	hash := h.Sum(nil)

	if !hasLeadingZeroBits(hash, challenge.Difficulty) {
		return "", fmt.Errorf("proof does not satisfy difficulty %d", challenge.Difficulty)
	}

	// Issue an access token.
	var tokenBytes [32]byte
	if _, err := rand.Read(tokenBytes[:]); err != nil {
		return "", fmt.Errorf("failed to generate token: %w", err)
	}

	tokenHex := hex.EncodeToString(tokenBytes[:])

	pv.mu.Lock()
	pv.tokens[tokenHex] = &AccessToken{
		Token:     tokenBytes,
		ExpiresAt: time.Now().Add(pv.tokenTTL),
	}
	pv.mu.Unlock()

	return tokenHex, nil
}

// ValidateToken checks whether the given token is valid and not expired.
// Uses constant-time comparison to prevent timing attacks.
func (pv *PoWVerifier) ValidateToken(tokenHex string) bool {
	tokenBytes, err := hex.DecodeString(tokenHex)
	if err != nil || len(tokenBytes) != 32 {
		return false
	}

	pv.mu.Lock()
	defer pv.mu.Unlock()

	// Iterate all tokens and use constant-time comparison to prevent timing leaks
	// about which tokens exist.
	for _, stored := range pv.tokens {
		if time.Now().After(stored.ExpiresAt) {
			continue
		}
		if subtle.ConstantTimeCompare(tokenBytes, stored.Token[:]) == 1 {
			return true
		}
	}

	return false
}

// RevokeToken removes a token, invalidating it for future use.
func (pv *PoWVerifier) RevokeToken(tokenHex string) {
	pv.mu.Lock()
	defer pv.mu.Unlock()
	delete(pv.tokens, tokenHex)
}

// hasLeadingZeroBits checks whether the hash has at least n leading zero bits.
func hasLeadingZeroBits(hash []byte, n int) bool {
	if n <= 0 {
		return true
	}
	if len(hash)*8 < n {
		return false
	}

	fullBytes := n / 8
	remainingBits := n % 8

	for i := 0; i < fullBytes; i++ {
		if hash[i] != 0 {
			return false
		}
	}

	if remainingBits > 0 {
		// Check that the top `remainingBits` bits of the next byte are zero.
		mask := byte(0xFF << (8 - remainingBits))
		if hash[fullBytes]&mask != 0 {
			return false
		}
	}

	return true
}

// EstimateDifficulty returns the approximate number of hash attempts needed
// for a given difficulty (2^difficulty).
func EstimateDifficulty(difficulty int) uint64 {
	if difficulty <= 0 {
		return 1
	}
	if difficulty >= 64 {
		return ^uint64(0)
	}
	return 1 << uint(difficulty)
}

// SolveChallenge is a helper used for testing. It finds a 32-byte proof
// such that SHA-256(nonce || proof) has the required leading zero bits.
func SolveChallenge(nonce [32]byte, difficulty int) ([]byte, error) {
	var proof [32]byte
	var counter uint64

	for {
		binary.BigEndian.PutUint64(proof[24:], counter)

		h := sha256.New()
		h.Write(nonce[:])
		h.Write(proof[:])
		hash := h.Sum(nil)

		if hasLeadingZeroBits(hash, difficulty) {
			result := make([]byte, 32)
			copy(result, proof[:])
			return result, nil
		}

		counter++
		if counter == 0 {
			return nil, errors.New("exhausted search space")
		}
	}
}
