import { x25519, ed25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { SecureBuffer } from './secureMemory';
import bs58 from 'bs58';

export interface PairingPayload {
  seedPhrase: string;
  rootDbKey: string;
  masterIdentityPub: string;
  assignedDeviceId: number;
  deviceLinkSignature: string; // Ed25519 signature over the new device's public key
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
 * Derives a specific device's Ed25519 identity seed from the master seed phrase bytes.
 * This prevents Ratchet State collisions (Key Reuse) between multiple devices.
 */
export function deriveDeviceIdentitySeed(masterSeed: Uint8Array, deviceId: number): Uint8Array {
  const info = new TextEncoder().encode(`zkmsg-identity-v1-device-${deviceId}`);
  return hkdf(sha256, masterSeed, undefined, info, 32);
}

/**
 * Generates a 6-digit Short Authentication String (SAS) from the SessionKey.
 */
function generateSAS(sessionKey: Uint8Array): string {
  const sasBytes = hkdf(sha256, sessionKey, undefined, "zkmsg-sas-verification", 4);
  const dataView = new DataView(sasBytes.buffer, sasBytes.byteOffset, sasBytes.byteLength);
  const num = dataView.getUint32(0, false) % 1000000;
  return num.toString().padStart(6, '0');
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
 * Generates SAS, signs the new device's identity, and encrypts the payload.
 */
export function encryptSyncPayload(
  qrData: PairingQRData, 
  seedPhrase: string,
  masterSeedBytes: Uint8Array,
  rootDbKey: string,
  masterIdentityPriv: Uint8Array,
  newDeviceId: number
): { message: EncryptedPairingMessage, sasCode: string } {
  const mobilePriv = x25519.utils.randomPrivateKey();
  const mobilePub = x25519.getPublicKey(mobilePriv);
  const desktopPub = bs58.decode(qrData.desktopPub);

  // 1. ECDH Shared Secret
  const sharedSecret = x25519.getSharedSecret(mobilePriv, desktopPub);

  // 2. HKDF Key Derivation for the Tunnel
  const sessionKey = hkdf(sha256, sharedSecret, undefined, "zkmsg-pairing", 32);

  // 3. Generate SAS for manual verification
  const sasCode = generateSAS(sessionKey);

  // 4. Cryptographic Linkage: Master signs the Slave's new Public Key
  const newDeviceSeed = deriveDeviceIdentitySeed(masterSeedBytes, newDeviceId);
  const newDevicePub = ed25519.getPublicKey(newDeviceSeed);
  const deviceLinkSignature = ed25519.sign(newDevicePub, masterIdentityPriv);

  const payload: PairingPayload = {
    seedPhrase,
    rootDbKey,
    masterIdentityPub: bs58.encode(ed25519.getPublicKey(masterIdentityPriv)),
    assignedDeviceId: newDeviceId,
    deviceLinkSignature: bs58.encode(deviceLinkSignature)
  };

  // 5. XChaCha20-Poly1305 Encryption
  const nonce = x25519.utils.randomPrivateKey().slice(0, 24);
  const cipher = xchacha20poly1305(sessionKey, nonce);
  
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = cipher.encrypt(plaintext);

  // 6. Secure Zeroing
  mobilePriv.fill(0);
  sharedSecret.fill(0);
  sessionKey.fill(0);
  newDeviceSeed.fill(0);

  return {
    message: {
      mobilePub: bs58.encode(mobilePub),
      nonce: bs58.encode(nonce),
      ciphertext: bs58.encode(ciphertext),
    },
    sasCode
  };
}

/**
 * Executes on the DESKTOP (Slave) device.
 * Decrypts the payload and returns the SAS code for the user to verify BEFORE applying the payload.
 */
export function decryptSyncPayload(
  desktopPriv: SecureBuffer, 
  message: EncryptedPairingMessage
): { payload: PairingPayload, sasCode: string } {
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

    // 3. Generate SAS for manual verification
    const sasCode = generateSAS(sessionKey);

    // 4. XChaCha20-Poly1305 Decryption
    const cipher = xchacha20poly1305(sessionKey, nonce);
    plaintext = cipher.decrypt(ciphertext);

    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as PairingPayload;
    
    // Note: The UI layer MUST prompt the user to compare `sasCode` with the Mobile screen
    // BEFORE accepting `payload` and deriving keys.
    
    return { payload, sasCode };

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
