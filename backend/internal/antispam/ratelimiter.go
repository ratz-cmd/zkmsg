package antispam

import (
	"sync"
	"time"
)

// bucket holds the state for a single token bucket.
type bucket struct {
	tokens     float64
	maxTokens  float64
	refillRate float64 // tokens per second
	lastRefill time.Time
}

// refill adds tokens based on elapsed time since last refill.
func (b *bucket) refill(now time.Time) {
	elapsed := now.Sub(b.lastRefill).Seconds()
	if elapsed <= 0 {
		return
	}
	b.tokens += elapsed * b.refillRate
	if b.tokens > b.maxTokens {
		b.tokens = b.maxTokens
	}
	b.lastRefill = now
}

// consume tries to take one token. Returns true if allowed.
func (b *bucket) consume(now time.Time) bool {
	b.refill(now)
	if b.tokens >= 1.0 {
		b.tokens -= 1.0
		return true
	}
	return false
}

// RateLimiter implements a per-account token bucket rate limiter.
// Non-contact messages can be rate-limited more strictly via AllowStricter.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[[32]byte]*bucket

	// rate is the refill rate in tokens per second.
	rate float64

	// burst is the maximum number of tokens (burst capacity).
	burst int

	// staleTimeout determines when an unused bucket is eligible for cleanup.
	staleTimeout time.Duration
}

// NewRateLimiter creates a new RateLimiter.
// rate is messages per minute, burst is the maximum burst size.
func NewRateLimiter(rate float64, burst int) *RateLimiter {
	return &RateLimiter{
		buckets:      make(map[[32]byte]*bucket),
		rate:         rate / 60.0, // convert msgs/min to msgs/sec
		burst:        burst,
		staleTimeout: 10 * time.Minute,
	}
}

// StartCleanup launches a background goroutine that periodically removes
// stale rate limiter entries. It stops when the done channel is closed.
func (rl *RateLimiter) StartCleanup(interval time.Duration, done <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				rl.cleanup()
			}
		}
	}()
}

// cleanup removes buckets that have been idle for longer than staleTimeout.
func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	for id, b := range rl.buckets {
		if now.Sub(b.lastRefill) > rl.staleTimeout {
			delete(rl.buckets, id)
		}
	}
}

// Allow checks whether the given accountID is allowed to send a message.
// Returns true if the request is within rate limits, false if throttled.
func (rl *RateLimiter) Allow(accountID [32]byte) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, exists := rl.buckets[accountID]
	if !exists {
		b = &bucket{
			tokens:     float64(rl.burst),
			maxTokens:  float64(rl.burst),
			refillRate: rl.rate,
			lastRefill: now,
		}
		rl.buckets[accountID] = b
	}

	return b.consume(now)
}

// AllowStricter checks rate limits with a 2x reduction for messages to non-contacts.
// This provides stronger anti-spam protection for unsolicited messages.
func (rl *RateLimiter) AllowStricter(accountID [32]byte) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	// Use a derived key for stricter bucket to keep it separate.
	var strictID [32]byte
	copy(strictID[:], accountID[:])
	strictID[0] ^= 0xFF // Differentiate from normal bucket.

	b, exists := rl.buckets[strictID]
	if !exists {
		// Half the rate and burst for non-contact messages.
		b = &bucket{
			tokens:     float64(rl.burst / 2),
			maxTokens:  float64(rl.burst / 2),
			refillRate: rl.rate / 2.0,
			lastRefill: now,
		}
		if b.maxTokens < 1 {
			b.maxTokens = 1
			b.tokens = 1
		}
		rl.buckets[strictID] = b
	}

	return b.consume(now)
}

// BucketCount returns the current number of tracked buckets. Used for metrics.
func (rl *RateLimiter) BucketCount() int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	return len(rl.buckets)
}
