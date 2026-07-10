/**
 * @module crypto/sessionManager
 * @description Gestionnaire de session avec verrouillage automatique.
 *
 * Le SessionManager maintient les clés déchiffrées en mémoire (SecureBuffer)
 * et les efface automatiquement après 60 secondes d'inactivité.
 * Toute interaction utilisateur doit appeler `resetInactivityTimer()`
 * pour repousser le verrouillage.
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { SecureBuffer } from './secureMemory';
import {
  mnemonicToSeed,
  deriveIdentityKey,
  deriveDbKey,
  deriveAccountId,
} from './keyDerivation';
import {
  generateIdentityKeyPair,
  generateX25519KeyPair,
} from './identity';

/** Délai d'inactivité avant verrouillage automatique (ms). */
const INACTIVITY_TIMEOUT_MS = 60_000; // 60 secondes

/** Identité déchiffrée en mémoire. */
export interface DecryptedIdentity {
  /** Identifiant du compte (Base58). */
  readonly accountId: string;
  /** Clé publique Ed25519 (32 bytes). */
  readonly identityPublicKey: Uint8Array;
  /** Clé publique X25519 (32 bytes). */
  readonly x25519PublicKey: Uint8Array;
}

/**
 * Gestionnaire de session avec auto-verrouillage.
 *
 * Responsabilités:
 * - Déverrouiller la session à partir d'un mnémonique BIP39
 * - Conserver les clés en mémoire dans des SecureBuffers
 * - Verrouiller la session (zero toutes les clés)
 * - Auto-verrouillage après 60s d'inactivité
 *
 * @example
 * ```ts
 * const sm = new SessionManager();
 * await sm.unlockSession('abandon abandon abandon ...');
 * const id = sm.getIdentity(); // { accountId, identityPublicKey, ... }
 * sm.resetInactivityTimer();    // sur chaque action utilisateur
 * sm.lockSession();             // verrouillage explicite
 * ```
 */
export class SessionManager {
  /** Seed maître déchiffrée. */
  private _seed: SecureBuffer | null = null;

  /** Clé privée d'identité Ed25519. */
  private _identitySecretKey: SecureBuffer | null = null;

  /** Clé privée X25519 pour l'échange de clés. */
  private _x25519SecretKey: SecureBuffer | null = null;

  /** Clé de chiffrement de la base de données. */
  private _dbKey: SecureBuffer | null = null;

  /** Identité publique (non sensible). */
  private _identity: DecryptedIdentity | null = null;

  /** État de verrouillage. */
  private _locked = true;

  /** Timer d'inactivité. */
  private _inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  /** Callback appelé lors du verrouillage automatique. */
  private _onAutoLock: (() => void) | null = null;

  /**
   * Crée un nouveau SessionManager.
   * @param onAutoLock - Callback optionnel appelé lors du verrouillage automatique.
   */
  constructor(onAutoLock?: () => void) {
    this._onAutoLock = onAutoLock ?? null;
  }

  /* ────────────────────────────── State ──────────────────────────────────── */

  /**
   * Indique si la session est verrouillée.
   * @returns `true` si les clés ne sont pas disponibles.
   */
  isLocked(): boolean {
    return this._locked;
  }

  /**
   * Renvoie l'identité publique du compte courant.
   *
   * @returns Identité déchiffrée contenant accountId et clés publiques.
   * @throws {Error} Si la session est verrouillée.
   */
  getIdentity(): DecryptedIdentity {
    if (this._locked || this._identity === null) {
      throw new Error(
        'SessionManager.getIdentity: session verrouillée — déverrouillez d\'abord',
      );
    }
    return this._identity;
  }

  /**
   * Renvoie la clé privée d'identité Ed25519.
   *
   * @returns SecureBuffer contenant la clé privée.
   * @throws {Error} Si la session est verrouillée.
   */
  getIdentitySecretKey(): SecureBuffer {
    if (this._locked || this._identitySecretKey === null) {
      throw new Error(
        'SessionManager.getIdentitySecretKey: session verrouillée',
      );
    }
    return this._identitySecretKey;
  }

  /**
   * Renvoie la clé privée X25519.
   *
   * @returns SecureBuffer contenant la clé privée X25519.
   * @throws {Error} Si la session est verrouillée.
   */
  getX25519SecretKey(): SecureBuffer {
    if (this._locked || this._x25519SecretKey === null) {
      throw new Error(
        'SessionManager.getX25519SecretKey: session verrouillée',
      );
    }
    return this._x25519SecretKey;
  }

  /**
   * Renvoie la clé de chiffrement de la base de données.
   *
   * @returns SecureBuffer contenant la clé SQLCipher.
   * @throws {Error} Si la session est verrouillée.
   */
  getDbKey(): SecureBuffer {
    if (this._locked || this._dbKey === null) {
      throw new Error('SessionManager.getDbKey: session verrouillée');
    }
    return this._dbKey;
  }

  /* ──────────────────────────── Lock / Unlock ────────────────────────────── */

  /**
   * Déverrouille la session à partir d'un mnémonique BIP39.
   *
   * Processus:
   * 1. Convertir le mnémonique en seed (64 octets)
   * 2. Dériver la clé d'identité via HKDF
   * 3. Générer les paires de clés Ed25519 et X25519
   * 4. Dériver la clé de base de données
   * 5. Calculer l'accountId (Base58)
   * 6. Démarrer le timer d'inactivité
   *
   * @param mnemonic - Phrase mnémonique BIP39 (12 ou 24 mots).
   * @throws {Error} Si le mnémonique est invalide.
   */
  async unlockSession(mnemonic: string): Promise<void> {
    // Verrouiller d'abord si déjà déverrouillé
    if (!this._locked) {
      this.lockSession();
    }

    // 1. Mnémonique → Seed
    this._seed = await mnemonicToSeed(mnemonic);

    // 2. Seed → Clé d'identité
    const identityKeyMaterial = deriveIdentityKey(this._seed);

    // 3. Clé d'identité → Ed25519 keypair
    const edKeyPair = generateIdentityKeyPair(identityKeyMaterial);
    this._identitySecretKey = edKeyPair.secretKey;

    // 4. Clé d'identité → X25519 keypair (dérivation séparée pour isolation)
    const x25519Seed = deriveX25519Seed(this._seed);
    const xKeyPair = generateX25519KeyPair(x25519Seed);
    this._x25519SecretKey = xKeyPair.secretKey;
    x25519Seed.zero();

    // 5. Seed → Clé DB
    this._dbKey = deriveDbKey(this._seed);

    // 6. Calculer l'accountId
    const accountId = deriveAccountId(identityKeyMaterial);
    identityKeyMaterial.zero();

    // 7. Stocker l'identité publique
    this._identity = {
      accountId,
      identityPublicKey: edKeyPair.publicKey,
      x25519PublicKey: xKeyPair.publicKey,
    };

    this._locked = false;

    // 8. Démarrer le timer d'inactivité
    this.resetInactivityTimer();
  }

  /**
   * Verrouille la session : efface (zero) toutes les clés en mémoire.
   * Peut être appelé plusieurs fois sans effet supplémentaire.
   */
  lockSession(): void {
    this._clearInactivityTimer();

    // Zero tous les SecureBuffers
    this._seed?.zero();
    this._identitySecretKey?.zero();
    this._x25519SecretKey?.zero();
    this._dbKey?.zero();

    // Libérer les références
    this._seed = null;
    this._identitySecretKey = null;
    this._x25519SecretKey = null;
    this._dbKey = null;
    this._identity = null;

    this._locked = true;
  }

  /* ──────────────────────────── Inactivity Timer ─────────────────────────── */

  /**
   * Réinitialise le timer d'inactivité.
   * Doit être appelé à chaque action utilisateur (clic, frappe, etc.).
   */
  resetInactivityTimer(): void {
    this._clearInactivityTimer();

    if (this._locked) {
      return;
    }

    this._inactivityTimer = setTimeout(() => {
      this.lockSession();
      this._onAutoLock?.();
    }, INACTIVITY_TIMEOUT_MS);
  }

  /**
   * Supprime le timer d'inactivité en cours.
   * @internal
   */
  private _clearInactivityTimer(): void {
    if (this._inactivityTimer !== null) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }
  }

  /**
   * Nettoie le SessionManager (verrouille et supprime les timers).
   * À appeler lors du démontage du composant React.
   */
  destroy(): void {
    this.lockSession();
    this._onAutoLock = null;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Internal Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Dérive une seed séparée pour X25519 afin d'isoler les clés DH
 * des clés de signature.
 *
 * @param masterSeed - Seed maître (64 octets).
 * @returns SecureBuffer de 32 octets pour la seed X25519.
 * @internal
 */
function deriveX25519Seed(masterSeed: SecureBuffer): SecureBuffer {
  const seedBytes = masterSeed.expose() as Uint8Array;
  const info = new TextEncoder().encode('zkmsg-x25519-v1');
  const derived = hkdf(sha256, seedBytes, new Uint8Array(32), info, 32);
  return SecureBuffer.from(derived);
}
