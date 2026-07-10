import bs58 from 'bs58';

export interface QRPayload {
  accountId: Uint8Array;      // 32 bytes
  identityKey: Uint8Array;    // 32 bytes
  signedPreKey: Uint8Array;   // 32 bytes
}

export class QRBundle {
  /**
   * Generates a compact base58 string containing the Account ID and public keys.
   * Total size: 96 bytes -> ~130 chars in base58.
   */
  static encode(payload: QRPayload): string {
    if (payload.accountId.length !== 32 || payload.identityKey.length !== 32 || payload.signedPreKey.length !== 32) {
      throw new Error("Invalid payload lengths. Expected 32 bytes per key.");
    }
    
    // Structure: [AccountId(32)] + [IdentityKey(32)] + [SignedPreKey(32)]
    const buffer = new Uint8Array(96);
    buffer.set(payload.accountId, 0);
    buffer.set(payload.identityKey, 32);
    buffer.set(payload.signedPreKey, 64);
    
    return bs58.encode(buffer);
  }

  /**
   * Parses the base58 string back into QRPayload.
   */
  static decode(qrString: string): QRPayload {
    const buffer = bs58.decode(qrString);
    if (buffer.length !== 96) {
      throw new Error(`Invalid QR payload length. Expected 96 bytes, got ${buffer.length}`);
    }
    
    return {
      accountId: buffer.slice(0, 32),
      identityKey: buffer.slice(32, 64),
      signedPreKey: buffer.slice(64, 96)
    };
  }
}
