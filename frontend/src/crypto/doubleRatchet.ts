import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { SecureBuffer } from './secureMemory';

const MAX_SKIP = 50;
const RK_KDF_INFO = new TextEncoder().encode('KDF_RK');
const CK_KDF_INFO_MSG = new TextEncoder().encode('KDF_MSG');
const CK_KDF_INFO_NEXT = new TextEncoder().encode('KDF_NEXT');

// Type aliases for clarity
export type PublicKey = Uint8Array;
export type PrivateKey = SecureBuffer;

export interface RatchetState {
  DHs: { publicKey: PublicKey; secretKey: PrivateKey };
  DHr: PublicKey | null;
  RK: SecureBuffer;
  CKs: SecureBuffer | null;
  CKr: SecureBuffer | null;
  Ns: number;
  Nr: number;
  PN: number;
  MKSKIPPED: Map<string, SecureBuffer>;
}

export interface MessageHeader {
  dh: PublicKey;
  pn: number;
  n: number;
}

export class DoubleRatchet {
  
  // X3DH initialization for Alice (Sender)
  static async initAlice(
    sharedSecret: SecureBuffer, // Computed from X3DH
    bobDHr: PublicKey
  ): Promise<RatchetState> {
    const DHs_priv = x25519.utils.randomPrivateKey();
    const DHs_pub = x25519.getPublicKey(DHs_priv);
    const DHs = { publicKey: DHs_pub, secretKey: SecureBuffer.from(DHs_priv) };
    
    // Alice computes first Root Key and Chain Key Send (CKs)
    const dhOut = x25519.getSharedSecret(DHs.secretKey.expose(), bobDHr);
    const rk_cks = hkdf(sha256, dhOut, sharedSecret.expose(), RK_KDF_INFO, 64);
    dhOut.fill(0);

    return {
      DHs,
      DHr: bobDHr,
      RK: SecureBuffer.from(rk_cks.slice(0, 32)),
      CKs: SecureBuffer.from(rk_cks.slice(32, 64)),
      CKr: null,
      Ns: 0,
      Nr: 0,
      PN: 0,
      MKSKIPPED: new Map()
    };
  }

  // X3DH initialization for Bob (Receiver)
  static async initBob(
    sharedSecret: SecureBuffer, // Computed from X3DH
    bobDHs: { publicKey: PublicKey; secretKey: PrivateKey }
  ): Promise<RatchetState> {
    return {
      DHs: bobDHs,
      DHr: null,
      RK: SecureBuffer.from(sharedSecret.expose()),
      CKs: null,
      CKr: null,
      Ns: 0,
      Nr: 0,
      PN: 0,
      MKSKIPPED: new Map()
    };
  }

  // Symmetric Ratchet step
  private static kdfCK(ck: SecureBuffer): { ck: SecureBuffer; mk: SecureBuffer } {
    const ckNext = hkdf(sha256, CK_KDF_INFO_NEXT, ck.expose(), undefined, 32);
    const mk = hkdf(sha256, CK_KDF_INFO_MSG, ck.expose(), undefined, 32);
    return { ck: SecureBuffer.from(ckNext), mk: SecureBuffer.from(mk) };
  }

  // Asymmetric Ratchet step
  private static kdfRK(rk: SecureBuffer, dhOut: Uint8Array): { rk: SecureBuffer; ck: SecureBuffer } {
    const out = hkdf(sha256, dhOut, rk.expose(), RK_KDF_INFO, 64);
    return { rk: SecureBuffer.from(out.slice(0, 32)), ck: SecureBuffer.from(out.slice(32, 64)) };
  }

  static async encrypt(state: RatchetState, plaintext: Uint8Array, ad: Uint8Array): Promise<{ header: MessageHeader, ciphertext: Uint8Array }> {
    if (!state.CKs) throw new Error("Cannot encrypt: CKs is null");
    
    const { ck, mk } = this.kdfCK(state.CKs);
    state.CKs.zero(); // Dispose old CKs
    state.CKs = ck;
    
    const header: MessageHeader = {
      dh: state.DHs.publicKey,
      pn: state.PN,
      n: state.Ns
    };
    state.Ns++;

    // XChaCha20-Poly1305 requires 24 bytes nonce, derived safely from mk (or random)
    const nonce = x25519.utils.randomPrivateKey().slice(0, 24);
    const cipher = xchacha20poly1305(mk.expose(), nonce, ad);
    const ciphertextBase = cipher.encrypt(plaintext);
    
    // Concat nonce + ciphertext
    const ciphertext = new Uint8Array(nonce.length + ciphertextBase.length);
    ciphertext.set(nonce, 0);
    ciphertext.set(ciphertextBase, nonce.length);
    
    mk.zero();
    return { header, ciphertext };
  }

  static async decrypt(state: RatchetState, header: MessageHeader, ciphertext: Uint8Array, ad: Uint8Array): Promise<Uint8Array> {
    const mk = await this.trySkipMessageKeys(state, header);
    
    let messageKey = mk;
    if (!messageKey) {
      if (header.dh.toString() !== state.DHr?.toString()) {
        this.skipMessageKeys(state, header.pn);
        this.dhRatchet(state, header.dh);
      }
      this.skipMessageKeys(state, header.n);
      if (!state.CKr) throw new Error("CKr is null after DHRatchet");
      const next = this.kdfCK(state.CKr);
      state.CKr.zero();
      state.CKr = next.ck;
      messageKey = next.mk;
      state.Nr++;
    }

    // Decrypt
    const nonce = ciphertext.slice(0, 24);
    const ct = ciphertext.slice(24);
    const cipher = xchacha20poly1305(messageKey.expose(), nonce, ad);
    
    let pt: Uint8Array;
    try {
      pt = cipher.decrypt(ct);
    } finally {
      messageKey.zero();
      if (mk) {
        // Remove from skipped keys if it was found
        const keyString = header.dh.toString() + header.n;
        state.MKSKIPPED.delete(keyString);
      }
    }
    return pt;
  }

  private static async trySkipMessageKeys(state: RatchetState, header: MessageHeader): Promise<SecureBuffer | null> {
    const keyString = header.dh.toString() + header.n;
    if (state.MKSKIPPED.has(keyString)) {
      return state.MKSKIPPED.get(keyString)!;
    }
    return null;
  }

  private static skipMessageKeys(state: RatchetState, until: number) {
    if (state.Nr + MAX_SKIP < until) {
      throw new Error(`Too many skipped messages (max ${MAX_SKIP})`);
    }
    if (state.CKr) {
      while (state.Nr < until) {
        const { ck, mk } = this.kdfCK(state.CKr);
        state.CKr.zero();
        state.CKr = ck;
        const keyString = state.DHr!.toString() + state.Nr;
        state.MKSKIPPED.set(keyString, mk);
        state.Nr++;
      }
    }
  }

  private static dhRatchet(state: RatchetState, headerDH: PublicKey) {
    state.PN = state.Ns;
    state.Ns = 0;
    state.Nr = 0;
    state.DHr = headerDH;
    
    // Rx Chain
    let dhOut = x25519.getSharedSecret(state.DHs.secretKey.expose(), state.DHr);
    let nextRK = this.kdfRK(state.RK, dhOut);
    dhOut.fill(0);
    state.RK.zero();
    state.RK = nextRK.rk;
    if (state.CKr) state.CKr.zero();
    state.CKr = nextRK.ck;

    // New Tx Key
    const DHs_priv = x25519.utils.randomPrivateKey();
    state.DHs.secretKey.zero();
    state.DHs = { publicKey: x25519.getPublicKey(DHs_priv), secretKey: SecureBuffer.from(DHs_priv) };

    // Tx Chain
    dhOut = x25519.getSharedSecret(state.DHs.secretKey.expose(), state.DHr);
    nextRK = this.kdfRK(state.RK, dhOut);
    dhOut.fill(0);
    state.RK.zero();
    state.RK = nextRK.rk;
    if (state.CKs) state.CKs.zero();
    state.CKs = nextRK.ck;
  }
}
