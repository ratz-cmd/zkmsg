// Package envelope defines the opaque envelope format used for sealed-sender routing.
// The server only reads routing metadata (version, type, recipient ID) and never
// inspects or decrypts the payload. All cryptographic operations happen client-side.
package envelope

import (
	"encoding/binary"
	"errors"
	"fmt"
	"time"
)

// Envelope type constants identify the purpose of the enclosed payload.
const (
	// TypeMessage is an encrypted chat message.
	TypeMessage uint8 = 1
	// TypePrekeyBundle is a prekey bundle for X3DH key exchange.
	TypePrekeyBundle uint8 = 2
	// TypeReceipt is a delivery or read receipt.
	TypeReceipt uint8 = 3
	// TypeKeyRequest is a request for new prekeys.
	TypeKeyRequest uint8 = 4
)

// CurrentVersion is the current envelope wire format version.
const CurrentVersion uint8 = 1

// MaxPayloadSize is the maximum allowed payload size (64 KB).
const MaxPayloadSize = 65536

// headerSize is the fixed header size:
// version(1) + type(1) + recipient(32) + timestamp(8) + payloadLen(4) = 46 bytes.
const headerSize = 46

// Envelope represents a sealed-sender message envelope.
// The server routes based on Recipient but never inspects Payload content.
type Envelope struct {
	// Version is the wire format version.
	Version uint8

	// Type identifies the envelope purpose (message, prekey, receipt, key request).
	Type uint8

	// Recipient is the 32-byte account ID of the intended recipient.
	Recipient [32]byte

	// Payload is the opaque encrypted blob. The server MUST NOT inspect this.
	Payload []byte

	// Timestamp is the envelope creation time as Unix nanoseconds.
	Timestamp int64
}

// Validate checks that the envelope fields are within acceptable bounds.
// Returns an error describing the first validation failure, or nil if valid.
func (e *Envelope) Validate() error {
	if e.Version != CurrentVersion {
		return fmt.Errorf("unsupported envelope version %d, expected %d", e.Version, CurrentVersion)
	}

	if e.Type < TypeMessage || e.Type > TypeKeyRequest {
		return fmt.Errorf("invalid envelope type %d, must be between %d and %d", e.Type, TypeMessage, TypeKeyRequest)
	}

	// Reject zero recipient ID (all zeros means no recipient specified).
	allZero := true
	for _, b := range e.Recipient {
		if b != 0 {
			allZero = false
			break
		}
	}
	if allZero {
		return errors.New("recipient ID must not be all zeros")
	}

	if len(e.Payload) == 0 {
		return errors.New("payload must not be empty")
	}

	if len(e.Payload) > MaxPayloadSize {
		return fmt.Errorf("payload size %d exceeds maximum %d bytes", len(e.Payload), MaxPayloadSize)
	}

	if e.Timestamp <= 0 {
		return errors.New("timestamp must be positive")
	}

	// Reject timestamps more than 5 minutes in the future.
	maxFuture := time.Now().UnixNano() + int64(5*time.Minute)
	if e.Timestamp > maxFuture {
		return errors.New("timestamp is too far in the future")
	}

	return nil
}

// Serialize encodes the envelope into its binary wire format.
// Wire format: version(1) | type(1) | recipient(32) | timestamp(8) | payloadLen(4) | payload(N)
func (e *Envelope) Serialize() []byte {
	payloadLen := len(e.Payload)
	buf := make([]byte, headerSize+payloadLen)

	buf[0] = e.Version
	buf[1] = e.Type
	copy(buf[2:34], e.Recipient[:])
	binary.BigEndian.PutUint64(buf[34:42], uint64(e.Timestamp))
	binary.BigEndian.PutUint32(buf[42:46], uint32(payloadLen))
	copy(buf[46:], e.Payload)

	return buf
}

// Parse decodes a raw byte slice into an Envelope.
// Returns an error if the data is malformed or fails validation.
// This function performs strict validation and will not panic on malformed input.
func Parse(raw []byte) (*Envelope, error) {
	if len(raw) < headerSize {
		return nil, fmt.Errorf("envelope too short: got %d bytes, need at least %d", len(raw), headerSize)
	}

	payloadLen := binary.BigEndian.Uint32(raw[42:46])

	if payloadLen > MaxPayloadSize {
		return nil, fmt.Errorf("declared payload size %d exceeds maximum %d", payloadLen, MaxPayloadSize)
	}

	expectedTotal := headerSize + int(payloadLen)
	if len(raw) < expectedTotal {
		return nil, fmt.Errorf("envelope truncated: declared payload %d bytes but only %d bytes available",
			payloadLen, len(raw)-headerSize)
	}

	if len(raw) > expectedTotal {
		return nil, fmt.Errorf("envelope has %d trailing bytes", len(raw)-expectedTotal)
	}

	env := &Envelope{
		Version:   raw[0],
		Type:      raw[1],
		Timestamp: int64(binary.BigEndian.Uint64(raw[34:42])),
		Payload:   make([]byte, payloadLen),
	}

	copy(env.Recipient[:], raw[2:34])
	copy(env.Payload, raw[46:46+payloadLen])

	if err := env.Validate(); err != nil {
		return nil, fmt.Errorf("envelope validation failed: %w", err)
	}

	return env, nil
}

// NewEnvelope creates a new envelope with the current timestamp.
// The caller must fill Recipient and Payload before sending.
func NewEnvelope(envelopeType uint8, recipient [32]byte, payload []byte) *Envelope {
	return &Envelope{
		Version:   CurrentVersion,
		Type:      envelopeType,
		Recipient: recipient,
		Payload:   payload,
		Timestamp: time.Now().UnixNano(),
	}
}
