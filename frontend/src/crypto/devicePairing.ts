import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { SecureBuffer } from './secureMemory';
import bs58 from 'bs58';

export interface PairingPayload {
  seedPhrase: string;
  rootDbKey: string;
  masterIdentityPub: string;
}

export interface PairingQRData {
  sessionId: string;
  desktopPub: string;
}

export interface EncryptedPairingMessage {
  mobilePub: string;
  nonce: string;
  ciphertext: string;
}

/**
 * Executes on the DESKTOP (Slave) device.
 * Generates the ephemeral keys and the QR code data.
 */
export function generatePairingSession(): { qrData: PairingQRData, privateKey: SecureBuffer } {
  const sessionId = bs58.encode(x25519.utils.randomPrivateKey().slice(0, 16));
  const ephemPriv = x25519.utils.randomPrivateKey();
  const ephemPub = x25519.getPublicKey(ephemPriv);

  return {
    qrData: {
      sessionId,
      desktopPub: bs58.encode(ephemPub),
    },
    privateKey: SecureBuffer.from(ephemPriv) // Secure memory, cleared after tunnel finishes
  };
}

/**
 * Executes on the MOBILE (Master) device.
 * Consumes the QR code data, generates a local ephemeral key, computes the DH shared secret,
 * encrypts the payload, and returns the ciphertext package to be sent over the socket.
 */
export function encryptSyncPayload(qrData: PairingQRData, payload: PairingPayload): EncryptedPairingMessage {
  const mobilePriv = x25519.utils.randomPrivateKey();
  const mobilePub = x25519.getPublicKey(mobilePriv);
  const desktopPub = bs58.decode(qrData.desktopPub);

  // 1. ECDH Shared Secret
  const sharedSecret = x25519.getSharedSecret(mobilePriv, desktopPub);

  // 2. HKDF Key Derivation
  const sessionKey = hkdf(sha256, sharedSecret, undefined, "zkmsg-pairing", 32);

  // 3. XChaCha20-Poly1305 Encryption
  const nonce = x25519.utils.randomPrivateKey().slice(0, 24);
  const cipher = xchacha20poly1305(sessionKey, nonce);
  
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = cipher.encrypt(plaintext);

  // 4. Secure Zeroing
  mobilePriv.fill(0);
  sharedSecret.fill(0);
  sessionKey.fill(0);

  return {
    mobilePub: bs58.encode(mobilePub),
    nonce: bs58.encode(nonce),
    ciphertext: bs58.encode(ciphertext),
  };
}

/**
 * Executes on the DESKTOP (Slave) device.
 * Receives the encrypted payload from the socket, reconstructs the DH secret, decrypts the payload.
 */
export function decryptSyncPayload(
  desktopPriv: SecureBuffer, 
  message: EncryptedPairingMessage
): PairingPayload {
  const mobilePub = bs58.decode(message.mobilePub);
  const nonce = bs58.decode(message.nonce);
  const ciphertext = bs58.decode(message.ciphertext);

  let sharedSecret: Uint8Array | null = null;
  let sessionKey: Uint8Array | null = null;
  let plaintext: Uint8Array | null = null;

  try {
    // 1. ECDH Shared Secret reconstruction
    sharedSecret = x25519.getSharedSecret(desktopPriv.expose(), mobilePub);

    // 2. HKDF Key Derivation
    sessionKey = hkdf(sha256, sharedSecret, undefined, "zkmsg-pairing", 32);

    // 3. XChaCha20-Poly1305 Decryption
    const cipher = xchacha20poly1305(sessionKey, nonce);
    plaintext = cipher.decrypt(ciphertext);

    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as PairingPayload;
    return payload;

  } catch (err) {
    throw new Error("Pairing failed: Payload tampering detected or keys mismatched.");
  } finally {
    // Zero all sensitive cryptographic material from RAM immediately
    desktopPriv.zero();
    if (sharedSecret) sharedSecret.fill(0);
    if (sessionKey) sessionKey.fill(0);
    if (plaintext) plaintext.fill(0);
  }
}
