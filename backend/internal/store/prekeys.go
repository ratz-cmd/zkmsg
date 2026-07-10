package store

import (
	"errors"
	"fmt"
	"sync"
)

// MaxPreKeysPerAccount is the maximum number of one-time prekeys an account can store.
const MaxPreKeysPerAccount = 100

// PreKeyBundle holds the public key material needed for X3DH key exchange.
// All fields are opaque byte slices — the server stores but never interprets them.
type PreKeyBundle struct {
	// IdentityKey is the long-term identity public key (opaque to server).
	IdentityKey []byte `json:"identity_key"`

	// SignedPreKey is the signed prekey (opaque to server).
	SignedPreKey []byte `json:"signed_prekey"`

	// SignedPreKeySig is the signature over the signed prekey (opaque to server).
	SignedPreKeySig []byte `json:"signed_prekey_sig"`

	// OneTimePreKeys is a stack of one-time prekeys consumed one per session.
	OneTimePreKeys [][]byte `json:"one_time_prekeys"`
}

// PreKeyStore manages prekey bundles for X3DH offline key exchange.
// The server stores key material opaquely and never interprets it.
// One-time prekeys are consumed (deleted) when fetched, ensuring forward secrecy.
type PreKeyStore struct {
	mu      sync.Mutex
	bundles map[[32]byte]*PreKeyBundle
}

// NewPreKeyStore creates a new in-memory prekey store.
func NewPreKeyStore() *PreKeyStore {
	return &PreKeyStore{
		bundles: make(map[[32]byte]*PreKeyBundle),
	}
}

// Upload stores a prekey bundle for the given account.
// If a bundle already exists, the identity key and signed prekey are updated,
// and new one-time prekeys are appended (up to MaxPreKeysPerAccount).
// Returns an error if the bundle is invalid.
func (ps *PreKeyStore) Upload(accountID [32]byte, bundle PreKeyBundle) error {
	if len(bundle.IdentityKey) == 0 {
		return errors.New("identity key must not be empty")
	}
	if len(bundle.SignedPreKey) == 0 {
		return errors.New("signed prekey must not be empty")
	}
	if len(bundle.SignedPreKeySig) == 0 {
		return errors.New("signed prekey signature must not be empty")
	}

	ps.mu.Lock()
	defer ps.mu.Unlock()

	existing, exists := ps.bundles[accountID]
	if !exists {
		// Store a new bundle, capping one-time prekeys.
		stored := PreKeyBundle{
			IdentityKey:     copyBytes(bundle.IdentityKey),
			SignedPreKey:    copyBytes(bundle.SignedPreKey),
			SignedPreKeySig: copyBytes(bundle.SignedPreKeySig),
			OneTimePreKeys:  copyByteSlices(bundle.OneTimePreKeys),
		}
		if len(stored.OneTimePreKeys) > MaxPreKeysPerAccount {
			stored.OneTimePreKeys = stored.OneTimePreKeys[:MaxPreKeysPerAccount]
		}
		ps.bundles[accountID] = &stored
		return nil
	}

	// Update existing bundle: replace identity/signed keys, append one-time prekeys.
	existing.IdentityKey = copyBytes(bundle.IdentityKey)
	existing.SignedPreKey = copyBytes(bundle.SignedPreKey)
	existing.SignedPreKeySig = copyBytes(bundle.SignedPreKeySig)

	for _, otpk := range bundle.OneTimePreKeys {
		if len(existing.OneTimePreKeys) >= MaxPreKeysPerAccount {
			break
		}
		existing.OneTimePreKeys = append(existing.OneTimePreKeys, copyBytes(otpk))
	}

	return nil
}

// Fetch retrieves a prekey bundle for the given account, consuming one one-time prekey.
// If one-time prekeys are available, exactly one is popped and included in the result.
// If no one-time prekeys remain, the bundle is returned without one (fallback to signed prekey).
// Returns an error if no bundle exists for this account.
func (ps *PreKeyStore) Fetch(accountID [32]byte) (*PreKeyBundle, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	bundle, exists := ps.bundles[accountID]
	if !exists {
		return nil, fmt.Errorf("no prekey bundle found for account")
	}

	result := &PreKeyBundle{
		IdentityKey:     copyBytes(bundle.IdentityKey),
		SignedPreKey:    copyBytes(bundle.SignedPreKey),
		SignedPreKeySig: copyBytes(bundle.SignedPreKeySig),
	}

	// Consume one one-time prekey (FIFO).
	if len(bundle.OneTimePreKeys) > 0 {
		otpk := bundle.OneTimePreKeys[0]
		bundle.OneTimePreKeys = bundle.OneTimePreKeys[1:]
		result.OneTimePreKeys = [][]byte{copyBytes(otpk)}
	}

	return result, nil
}

// CountRemaining returns the number of unused one-time prekeys for the account.
// Returns 0 if no bundle exists.
func (ps *PreKeyStore) CountRemaining(accountID [32]byte) int {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	bundle, exists := ps.bundles[accountID]
	if !exists {
		return 0
	}
	return len(bundle.OneTimePreKeys)
}

// AccountCount returns the number of accounts with stored prekey bundles.
// Used for metrics reporting.
func (ps *PreKeyStore) AccountCount() int {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	return len(ps.bundles)
}

// copyBytes returns a copy of the input byte slice to prevent mutation of stored data.
func copyBytes(b []byte) []byte {
	if b == nil {
		return nil
	}
	c := make([]byte, len(b))
	copy(c, b)
	return c
}

// copyByteSlices returns a deep copy of a slice of byte slices.
func copyByteSlices(in [][]byte) [][]byte {
	if in == nil {
		return nil
	}
	out := make([][]byte, len(in))
	for i, b := range in {
		out[i] = copyBytes(b)
	}
	return out
}
