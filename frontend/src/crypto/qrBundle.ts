import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';

export interface QRPayload {
  accountId: Uint8Array;      // 32 bytes
  identityKey: Uint8Array;    // 32 bytes
  signedPreKey: Uint8Array;   // 32 bytes
  signature: Uint8Array;      // 64 bytes
}

export class QRBundle {
  /**
   * Generates a compact base58 string containing the Account ID, public keys, and signature.
   * Total size: 160 bytes -> ~220 chars in base58.
   */
  static encode(payload: QRPayload): string {
    if (payload.accountId.length !== 32 || payload.identityKey.length !== 32 || 
        payload.signedPreKey.length !== 32 || payload.signature.length !== 64) {
      throw new Error("Invalid payload lengths. Expected 32 bytes for keys and 64 bytes for signature.");
    }
    
    // Structure: [AccountId(32)] + [IdentityKey(32)] + [SignedPreKey(32)] + [Signature(64)]
    const buffer = new Uint8Array(160);
    buffer.set(payload.accountId, 0);
    buffer.set(payload.identityKey, 32);
    buffer.set(payload.signedPreKey, 64);
    buffer.set(payload.signature, 96);
    
    return bs58.encode(buffer);
  }

  /**
   * Parses the base58 string back into QRPayload and validates the signature.
   */
  static decode(qrString: string): QRPayload {
    const buffer = bs58.decode(qrString);
    if (buffer.length !== 160) {
      throw new Error(`Invalid QR payload length. Expected 160 bytes, got ${buffer.length}`);
    }
    
    const payload: QRPayload = {
      accountId: buffer.slice(0, 32),
      identityKey: buffer.slice(32, 64),
      signedPreKey: buffer.slice(64, 96),
      signature: buffer.slice(96, 160)
    };

    // Protocol enforcement: verify that IdentityKey signed the SignedPreKey
    const isValid = ed25519.verify(payload.signature, payload.signedPreKey, payload.identityKey);
    if (!isValid) {
      throw new Error("Invalid QR Bundle: Signature verification failed. Identity Key did not sign this PreKey.");
    }

    return payload;
  }
}
