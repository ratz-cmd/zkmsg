/**
 * @module crypto/keyDerivation
 * @description Dérivation de clés à partir d'une seed BIP39.
 *
 * Utilise HKDF-SHA256 (@noble/hashes) pour dériver toutes les clés applicatives
 * à partir de la seed maître. Chaque dérivation utilise un `info` unique
 * pour garantir l'indépendance cryptographique des clés.
 *
 * Tous les buffers intermédiaires sont explicitement zeroed après usage.
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { mnemonicToSeed as bip39ToSeed } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import bs58 from 'bs58';
import { SecureBuffer } from './secureMemory';

/** Sel vide pour HKDF (pas de sel aléatoire car la seed est déjà à haute entropie). */
const EMPTY_SALT = new Uint8Array(32);

/** Longueur de clé de sortie en octets (256 bits). */
const KEY_LENGTH = 32;

/* ────────────────────────────────────────────────────────────────────────────
 * Mnemonic → Seed
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Convertit un mnémonique BIP39 en seed de 64 octets.
 *
 * @param mnemonic - Phrase mnémonique (12 ou 24 mots, séparés par des espaces).
 * @returns SecureBuffer contenant la seed de 64 octets.
 * @throws {Error} Si le mnémonique est invalide.
 */
export async function mnemonicToSeed(mnemonic: string): Promise<SecureBuffer> {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');

  // Validation basique du mnémonique
  const words = normalized.split(' ');
  if (words.length !== 12 && words.length !== 24) {
    throw new Error(
      `Mnémonique invalide: attendu 12 ou 24 mots, reçu ${words.length}`,
    );
  }

  // Vérifie que chaque mot est dans la wordlist
  for (const word of words) {
    if (!wordlist.includes(word)) {
      throw new Error(`Mot invalide dans le mnémonique: "${word}"`);
    }
  }

  // bip39ToSeed retourne un Uint8Array de 64 octets
  const rawSeed = await bip39ToSeed(normalized);
  return SecureBuffer.from(rawSeed);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Key Derivation Functions
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Effectue une dérivation HKDF-SHA256 à partir d'une seed.
 *
 * @param seed - Matériel de clé d'entrée (IKM).
 * @param info - Chaîne de contexte unique pour cette dérivation.
 * @param length - Longueur de sortie en octets (défaut: 32).
 * @returns SecureBuffer contenant la clé dérivée.
 * @internal
 */
function deriveWithHkdf(
  seed: SecureBuffer,
  info: string,
  length: number = KEY_LENGTH,
): SecureBuffer {
  const seedBytes = seed.expose();
  const infoBytes = new TextEncoder().encode(info);

  const derived = hkdf(sha256, seedBytes, EMPTY_SALT, infoBytes, length);
  return SecureBuffer.wrap(derived);
}

/**
 * Dérive la clé d'identité Ed25519 à partir de la seed maître.
 *
 * @param seed - Seed BIP39 (64 octets) dans un SecureBuffer.
 * @returns SecureBuffer de 32 octets pour la clé privée Ed25519.
 */
export function deriveIdentityKey(seed: SecureBuffer): SecureBuffer {
  return deriveWithHkdf(seed, 'zkmsg-identity-v1');
}

/**
 * Dérive la clé de chiffrement de la base SQLCipher.
 *
 * @param seed - Seed BIP39 (64 octets) dans un SecureBuffer.
 * @returns SecureBuffer de 32 octets pour SQLCipher.
 */
export function deriveDbKey(seed: SecureBuffer): SecureBuffer {
  return deriveWithHkdf(seed, 'zkmsg-sqlcipher-v1');
}

/**
 * Dérive la clé pour la signed prekey.
 *
 * @param seed - Seed BIP39 (64 octets) dans un SecureBuffer.
 * @returns SecureBuffer de 32 octets pour la signed prekey.
 */
export function deriveSignedPrekeyKey(seed: SecureBuffer): SecureBuffer {
  return deriveWithHkdf(seed, 'zkmsg-prekey-v1');
}

/**
 * Dérive un identifiant de compte unique (Base58) à partir de la clé d'identité.
 *
 * Le processus:
 * 1. HKDF(identityKey, info='zkmsg-account-id-v1') → 32 octets
 * 2. Encodage Base58 des 32 octets
 *
 * @param identityKey - Clé d'identité dérivée (SecureBuffer de 32 octets).
 * @returns Identifiant du compte encodé en Base58.
 */
export function deriveAccountId(identityKey: SecureBuffer): string {
  const accountIdBuffer = deriveWithHkdf(identityKey, 'zkmsg-account-id-v1');
  try {
    const bytes = accountIdBuffer.expose();
    return bs58.encode(bytes as Uint8Array);
  } finally {
    accountIdBuffer.zero();
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Mnemonic Generation
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Génère un nouveau mnémonique BIP39 de 12 mots.
 * Utilise `crypto.getRandomValues` pour l'entropie.
 *
 * @returns Phrase mnémonique de 12 mots.
 */
export async function generateMnemonic12(): Promise<string> {
  // 128 bits d'entropie → 12 mots
  const { generateMnemonic } = await import('@scure/bip39');
  return generateMnemonic(wordlist, 128);
}

/**
 * Génère un nouveau mnémonique BIP39 de 24 mots.
 * Utilise `crypto.getRandomValues` pour l'entropie.
 *
 * @returns Phrase mnémonique de 24 mots.
 */
export async function generateMnemonic24(): Promise<string> {
  const { generateMnemonic } = await import('@scure/bip39');
  return generateMnemonic(wordlist, 256);
}

/**
 * Valide un mnémonique BIP39 (checksum inclus).
 *
 * @param mnemonic - Phrase mnémonique à valider.
 * @returns `true` si le mnémonique est valide.
 */
export async function validateMnemonic(mnemonic: string): Promise<boolean> {
  const { validateMnemonic: validate } = await import('@scure/bip39');
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  return validate(normalized, wordlist);
}
