// Package store provides in-memory storage for mailbox envelopes and prekey bundles.
// These implementations are suitable for the MVP phase. Production deployments
// should replace them with persistent storage backends.
package store

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/ratz/zkmsg-server/internal/envelope"
)

// mailboxEntry holds a stored envelope along with its expiration time.
type mailboxEntry struct {
	env       *envelope.Envelope
	expiresAt time.Time
}

// Mailbox provides in-memory offline message storage.
// When a recipient is offline, envelopes are stored here until they reconnect.
// Envelopes are opaque encrypted blobs — the server never inspects their content.
type Mailbox struct {
	mu      sync.Mutex
	entries map[[32]byte][]*mailboxEntry

	// maxPerRecipient is the maximum number of stored messages per recipient.
	maxPerRecipient int

	// ttl is how long envelopes are kept before automatic expiry.
	ttl time.Duration
}

// NewMailbox creates a new in-memory mailbox store.
// maxPerRecipient limits queued messages per account. ttl sets the envelope expiration.
func NewMailbox(maxPerRecipient int, ttl time.Duration) *Mailbox {
	return &Mailbox{
		entries:         make(map[[32]byte][]*mailboxEntry),
		maxPerRecipient: maxPerRecipient,
		ttl:             ttl,
	}
}

// StartCleanup launches a background goroutine that periodically removes expired
// mailbox entries. It stops when the done channel is closed.
func (m *Mailbox) StartCleanup(interval time.Duration, done <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				m.cleanup()
			}
		}
	}()
}

// cleanup removes all expired entries from all mailboxes.
func (m *Mailbox) cleanup() {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	for id, entries := range m.entries {
		filtered := entries[:0]
		for _, e := range entries {
			if now.Before(e.expiresAt) {
				filtered = append(filtered, e)
			}
		}
		if len(filtered) == 0 {
			delete(m.entries, id)
		} else {
			m.entries[id] = filtered
		}
	}
}

// Store adds an envelope to the recipient's mailbox.
// Returns an error if the mailbox is full (maxPerRecipient reached).
// The envelope payload is never inspected by this function.
func (m *Mailbox) Store(recipientID [32]byte, env *envelope.Envelope) error {
	if env == nil {
		return errors.New("envelope must not be nil")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	entries := m.entries[recipientID]

	// Remove expired entries inline before checking capacity.
	now := time.Now()
	filtered := entries[:0]
	for _, e := range entries {
		if now.Before(e.expiresAt) {
			filtered = append(filtered, e)
		}
	}
	entries = filtered

	if len(entries) >= m.maxPerRecipient {
		return fmt.Errorf("mailbox full for recipient: %d/%d messages stored",
			len(entries), m.maxPerRecipient)
	}

	entries = append(entries, &mailboxEntry{
		env:       env,
		expiresAt: now.Add(m.ttl),
	})
	m.entries[recipientID] = entries

	return nil
}

// Fetch retrieves and deletes all stored envelopes for the given recipient.
// Returns an empty slice (not nil) if no messages are stored.
// This implements a consume-on-read pattern suitable for the MVP.
func (m *Mailbox) Fetch(recipientID [32]byte) ([]*envelope.Envelope, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	entries, exists := m.entries[recipientID]
	if !exists {
		return []*envelope.Envelope{}, nil
	}

	// Remove the mailbox immediately (consume-on-read).
	delete(m.entries, recipientID)

	now := time.Now()
	result := make([]*envelope.Envelope, 0, len(entries))
	for _, e := range entries {
		if now.Before(e.expiresAt) {
			result = append(result, e.env)
		}
	}

	return result, nil
}

// Count returns the number of currently stored (non-expired) messages for a recipient.
func (m *Mailbox) Count(recipientID [32]byte) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	entries, exists := m.entries[recipientID]
	if !exists {
		return 0
	}

	count := 0
	now := time.Now()
	for _, e := range entries {
		if now.Before(e.expiresAt) {
			count++
		}
	}
	return count
}

// TotalCount returns the total number of stored messages across all mailboxes.
// Used for metrics reporting.
func (m *Mailbox) TotalCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()

	total := 0
	now := time.Now()
	for _, entries := range m.entries {
		for _, e := range entries {
			if now.Before(e.expiresAt) {
				total++
			}
		}
	}
	return total
}
