/**
 * @module crypto/identity
 * @description Gestion des paires de clés d'identité (Ed25519 / X25519).
 *
 * Fournit la génération de clés, la signature et la vérification
 * en utilisant exclusivement @noble/curves.
 * Toutes les clés secrètes sont encapsulées dans SecureBuffer.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { SecureBuffer } from './secureMemory';
import type { PreKey } from '../types/crypto';

/** Sel vide pour les dérivations HKDF de pré-clés. */
const EMPTY_SALT = new Uint8Array(32);

/* ────────────────────────────────────────────────────────────────────────────
 * Ed25519 Identity
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Génère une paire de clés Ed25519 à partir d'une seed dérivée.
 *
 * La seed (32 octets) est utilisée directement comme clé privée Ed25519.
 * La clé publique correspondante est calculée.
 *
 * @param seed - SecureBuffer de 32 octets (clé d'identité dérivée via HKDF).
 * @returns Paire { publicKey, secretKey } où secretKey est un SecureBuffer.
 */
export function generateIdentityKeyPair(seed: SecureBuffer): {
  publicKey: Uint8Array;
  secretKey: SecureBuffer;
} {
  const seedBytes = seed.expose() as Uint8Array;

  if (seedBytes.length !== 32) {
    throw new Error(
      `generateIdentityKeyPair: seed doit faire 32 octets, reçu ${seedBytes.length}`,
    );
  }

  // Ed25519 utilise la seed de 32 octets pour dériver la clé privée interne
  const publicKey = ed25519.getPublicKey(seedBytes);

  // Copier la seed comme clé secrète (la seed EST la clé privée Ed25519)
  const secretCopy = new Uint8Array(32);
  secretCopy.set(seedBytes);
  const secretKey = SecureBuffer.wrap(secretCopy);

  return { publicKey, secretKey };
}

/* ────────────────────────────────────────────────────────────────────────────
 * X25519 Key Exchange
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Génère une paire de clés X25519 à partir d'une seed dérivée.
 *
 * Utilisé pour l'échange de clés Diffie-Hellman dans le protocole X3DH.
 *
 * @param seed - SecureBuffer de 32 octets.
 * @returns Paire { publicKey, secretKey } pour X25519.
 */
export function generateX25519KeyPair(seed: SecureBuffer): {
  publicKey: Uint8Array;
  secretKey: SecureBuffer;
} {
  const seedBytes = seed.expose() as Uint8Array;

  if (seedBytes.length !== 32) {
    throw new Error(
      `generateX25519KeyPair: seed doit faire 32 octets, reçu ${seedBytes.length}`,
    );
  }

  const publicKey = x25519.getPublicKey(seedBytes);

  const secretCopy = new Uint8Array(32);
  secretCopy.set(seedBytes);
  const secretKey = SecureBuffer.wrap(secretCopy);

  return { publicKey, secretKey };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Signing & Verification
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Signe des données avec une clé privée Ed25519.
 *
 * @param secretKey - Clé privée Ed25519 (SecureBuffer de 32 octets).
 * @param data - Données à signer.
 * @returns Signature Ed25519 (64 octets).
 * @throws {Error} Si la clé secrète est zeroed.
 */
export function signData(
  secretKey: SecureBuffer,
  data: Uint8Array,
): Uint8Array {
  const keyBytes = secretKey.expose() as Uint8Array;
  return ed25519.sign(data, keyBytes);
}

/**
 * Vérifie une signature Ed25519.
 *
 * @param publicKey - Clé publique Ed25519 (32 octets).
 * @param data - Données originales signées.
 * @param signature - Signature à vérifier (64 octets).
 * @returns `true` si la signature est valide.
 */
export function verifySignature(
  publicKey: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, data, publicKey);
  } catch {
    // En cas d'entrée malformée, considérer comme invalide
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pre-Keys Generation
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Génère un lot de pré-clés X25519 pour le protocole X3DH.
 *
 * Chaque pré-clé est dérivée de manière déterministe:
 *   HKDF(seed, info = 'zkmsg-otp-<id>-v1') → 32 octets → X25519 keypair
 *
 * @param seed - Seed maître (SecureBuffer).
 * @param count - Nombre de pré-clés à générer (max 100).
 * @returns Tableau de pré-clés avec id, publicKey et secretKey.
 */
export function generatePreKeys(
  seed: SecureBuffer,
  count: number,
): PreKey[] {
  if (count <= 0 || count > 100) {
    throw new RangeError(
      `generatePreKeys: count doit être entre 1 et 100, reçu ${count}`,
    );
  }

  const seedBytes = seed.expose() as Uint8Array;
  const preKeys: PreKey[] = [];

  for (let i = 0; i < count; i++) {
    const info = new TextEncoder().encode(`zkmsg-otp-${i}-v1`);
    const derivedKey = hkdf(sha256, seedBytes, EMPTY_SALT, info, 32);

    const publicKey = x25519.getPublicKey(derivedKey);

    // Copier la clé dérivée pour la stocker
    const secretKeyCopy = new Uint8Array(32);
    secretKeyCopy.set(derivedKey);

    // Zero le buffer HKDF intermédiaire
    derivedKey.fill(0);

    preKeys.push({
      id: i,
      publicKey,
      secretKey: secretKeyCopy,
    });
  }

  return preKeys;
}
