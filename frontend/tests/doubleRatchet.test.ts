import { describe, it, expect } from 'vitest';
import { DoubleRatchet } from '../src/crypto/doubleRatchet';
import { SecureBuffer } from '../src/crypto/secureMemory';
import { x25519 } from '@noble/curves/ed25519';

describe('Double Ratchet', () => {
  it('should encrypt and decrypt sequentially', async () => {
    // Mock X3DH outputs
    const sharedSecret = SecureBuffer.from(x25519.utils.randomPrivateKey());
    
    // Bob's initial DH key
    const bobDHsPriv = x25519.utils.randomPrivateKey();
    const bobDHsPub = x25519.getPublicKey(bobDHsPriv);
    const bobDHs = { publicKey: bobDHsPub, secretKey: SecureBuffer.from(bobDHsPriv) };

    const sharedSecretClone = SecureBuffer.from(new Uint8Array(sharedSecret.expose()));

    // Init
    const aliceState = await DoubleRatchet.initAlice(sharedSecret, bobDHsPub);
    const bobState = await DoubleRatchet.initBob(sharedSecretClone, bobDHs);

    const AD = new Uint8Array([1, 2, 3]);
    const pt = new TextEncoder().encode("Hello Bob!");

    // Alice -> Bob
    const { header, ciphertext } = await DoubleRatchet.encrypt(aliceState, pt, AD, async () => {});
    const decrypted = await DoubleRatchet.decrypt(bobState, header, ciphertext, AD, async () => {});
    
    expect(new TextDecoder().decode(decrypted)).toBe("Hello Bob!");
  });

  it('should handle out-of-order messages (Skipped Keys Window)', async () => {
    const sharedSecret = SecureBuffer.from(x25519.utils.randomPrivateKey());
    const bobDHsPriv = x25519.utils.randomPrivateKey();
    const bobDHsPub = x25519.getPublicKey(bobDHsPriv);
    const bobDHs = { publicKey: bobDHsPub, secretKey: SecureBuffer.from(bobDHsPriv) };
    const sharedSecretClone = SecureBuffer.from(new Uint8Array(sharedSecret.expose()));

    const aliceState = await DoubleRatchet.initAlice(sharedSecret, bobDHsPub);
    const bobState = await DoubleRatchet.initBob(sharedSecretClone, bobDHs);
    const AD = new Uint8Array([1, 2, 3]);

    // Alice sends 3 messages
    const msg1 = await DoubleRatchet.encrypt(aliceState, new TextEncoder().encode("Msg 1"), AD, async () => {});
    const msg2 = await DoubleRatchet.encrypt(aliceState, new TextEncoder().encode("Msg 2"), AD, async () => {});
    const msg3 = await DoubleRatchet.encrypt(aliceState, new TextEncoder().encode("Msg 3"), AD, async () => {});

    // Bob receives msg 3 FIRST (out of order)
    const dec3 = await DoubleRatchet.decrypt(bobState, msg3.header, msg3.ciphertext, AD, async () => {});
    expect(new TextDecoder().decode(dec3)).toBe("Msg 3");

    // Bob receives msg 1 LATER (skipped keys feature)
    const dec1 = await DoubleRatchet.decrypt(bobState, msg1.header, msg1.ciphertext, AD, async () => {});
    expect(new TextDecoder().decode(dec1)).toBe("Msg 1");

    // Bob receives msg 2
    const dec2 = await DoubleRatchet.decrypt(bobState, msg2.header, msg2.ciphertext, AD, async () => {});
    expect(new TextDecoder().decode(dec2)).toBe("Msg 2");

    // Ensure state map is cleaned up
    expect(bobState.MKSKIPPED.size).toBe(0);
  });
});
