/**
 * @module types/crypto
 * @description Core cryptographic type definitions for ZKMsg.
 *
 * Toutes les clés sont représentées en Uint8Array — jamais en string.
 * Les interfaces suivent le protocole Signal (Double Ratchet / X3DH).
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Account & Identity
 * ──────────────────────────────────────────────────────────────────────────── */

/** Représente un compte utilisateur local. */
export interface Account {
  /** Identifiant unique du compte, dérivé par HKDF puis encodé Base58. */
  readonly accountId: string;

  /** Clé publique Ed25519 d'identité (32 bytes). */
  readonly identityPublicKey: Uint8Array;

  /** Clé publique X25519 pour l'échange de clés (32 bytes). */
  readonly x25519PublicKey: Uint8Array;

  /** Horodatage de création (ms epoch). */
  readonly createdAt: number;
}

/** Paire de clés avec la clé secrète protégée par SecureBuffer. */
export interface KeyPair {
  /** Clé publique brute (32 bytes). */
  readonly publicKey: Uint8Array;

  /**
   * Clé secrète enveloppée dans un SecureBuffer.
   * Doit être zeroed dès qu'elle n'est plus nécessaire.
   */
  readonly secretKey: Uint8Array;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pre-Keys (X3DH)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Une pré-clé one-time ou signed. */
export interface PreKey {
  /** Identifiant séquentiel de la pré-clé. */
  readonly id: number;

  /** Clé publique X25519 (32 bytes). */
  readonly publicKey: Uint8Array;

  /** Clé secrète X25519 (32 bytes). */
  readonly secretKey: Uint8Array;
}

/** Bundle de pré-clés publié sur le serveur pour X3DH. */
export interface PreKeyBundle {
  /** Identifiant du compte propriétaire (Base58). */
  readonly accountId: string;

  /** Clé publique Ed25519 d'identité (32 bytes). */
  readonly identityPublicKey: Uint8Array;

  /** Clé publique X25519 signée (32 bytes). */
  readonly signedPreKeyPublic: Uint8Array;

  /** Signature Ed25519 de la signedPreKey (64 bytes). */
  readonly signedPreKeySignature: Uint8Array;

  /** Identifiant de la signedPreKey. */
  readonly signedPreKeyId: number;

  /** Liste de pré-clés one-time (clés publiques uniquement). */
  readonly oneTimePreKeys: ReadonlyArray<{
    readonly id: number;
    readonly publicKey: Uint8Array;
  }>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Session & Ratchet
 * ──────────────────────────────────────────────────────────────────────────── */

/** État du Double Ratchet pour une session pair-à-pair. */
export interface RatchetState {
  /** Clé racine courante (32 bytes). */
  readonly rootKey: Uint8Array;

  /** Clé de chaîne d'envoi (32 bytes). */
  readonly sendChainKey: Uint8Array;

  /** Clé de chaîne de réception (32 bytes). */
  readonly recvChainKey: Uint8Array;

  /** Clé publique DH courante de l'expéditeur (32 bytes). */
  readonly senderRatchetPublic: Uint8Array;

  /** Clé secrète DH courante de l'expéditeur (32 bytes). */
  readonly senderRatchetSecret: Uint8Array;

  /** Compteur de messages envoyés dans la chaîne courante. */
  readonly sendMessageNumber: number;

  /** Compteur de messages reçus dans la chaîne courante. */
  readonly recvMessageNumber: number;

  /** Compteur du nombre de ratchets DH précédents. */
  readonly previousSendCount: number;
}

/** Session chiffrée entre deux pairs. */
export interface Session {
  /** Identifiant unique de la session. */
  readonly sessionId: string;

  /** Identifiant du compte distant. */
  readonly remoteAccountId: string;

  /** Clé publique d'identité distante (32 bytes). */
  readonly remoteIdentityKey: Uint8Array;

  /** État courant du ratchet. */
  readonly ratchetState: RatchetState;

  /** Horodatage de la dernière activité (ms epoch). */
  readonly lastActivity: number;

  /** Indique si la session a été initialisée (X3DH terminé). */
  readonly established: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Messages & Envelopes
 * ──────────────────────────────────────────────────────────────────────────── */

/** Enveloppe de message chiffré prête pour le transport. */
export interface Envelope {
  /** Version du protocole (actuellement 1). */
  readonly version: number;

  /** Identifiant du compte expéditeur (Base58). */
  readonly senderAccountId: string;

  /** Identifiant du compte destinataire (Base58). */
  readonly recipientAccountId: string;

  /** Clé publique éphémère DH de l'expéditeur (32 bytes). */
  readonly ephemeralPublicKey: Uint8Array;

  /** Compteur de la chaîne d'envoi. */
  readonly messageNumber: number;

  /** Compteur du ratchet précédent. */
  readonly previousChainLength: number;

  /** Corps chiffré du message (AEAD ciphertext). */
  readonly ciphertext: Uint8Array;

  /** Nonce utilisé pour le chiffrement (24 bytes pour XChaCha20-Poly1305). */
  readonly nonce: Uint8Array;

  /** Horodatage d'envoi (ms epoch). */
  readonly timestamp: number;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tauri IPC Bridge
 * ──────────────────────────────────────────────────────────────────────────── */

/** Commandes Tauri exposées au frontend. */
export interface TauriCommands {
  /** Stocke un blob chiffré dans la base SQLCipher. */
  store_encrypted_blob: (args: {
    key: string;
    value: Uint8Array;
  }) => Promise<void>;

  /** Récupère un blob chiffré depuis la base SQLCipher. */
  get_encrypted_blob: (args: {
    key: string;
  }) => Promise<Uint8Array | null>;

  /** Supprime un blob de la base. */
  delete_blob: (args: { key: string }) => Promise<void>;

  /** Envoie un message chiffré via le relay WebSocket. */
  send_message: (args: { envelope: Uint8Array }) => Promise<void>;

  /** Publie un PreKeyBundle sur le serveur de clés. */
  publish_prekey_bundle: (args: {
    bundle: Uint8Array;
  }) => Promise<void>;

  /** Récupère le PreKeyBundle d'un pair distant. */
  fetch_prekey_bundle: (args: {
    accountId: string;
  }) => Promise<Uint8Array | null>;
}

/** Événements Tauri émis vers le frontend. */
export interface TauriEvents {
  /** Nouveau message reçu du relay. */
  'zkmsg://message-received': { envelope: Uint8Array };

  /** Connexion WebSocket perdue. */
  'zkmsg://connection-lost': { reason: string };

  /** Connexion WebSocket rétablie. */
  'zkmsg://connection-restored': Record<string, never>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Auth State
 * ──────────────────────────────────────────────────────────────────────────── */

/** État d'authentification exposé par le contexte React. */
export interface AuthState {
  /** Indique si la session est verrouillée (clés zeroed). */
  readonly isLocked: boolean;

  /** Identifiant du compte (Base58), null si pas encore déverrouillé. */
  readonly accountId: string | null;

  /** Indique si une opération de déverrouillage est en cours. */
  readonly isLoading: boolean;

  /** Dernière erreur éventuelle. */
  readonly error: string | null;
}
