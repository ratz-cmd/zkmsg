/**
 * @module crypto/secureMemory
 * @description Gestion sécurisée de la mémoire pour les clés cryptographiques.
 *
 * SecureBuffer encapsule un Uint8Array et garantit le zeroing explicite
 * des données sensibles lorsqu'elles ne sont plus nécessaires.
 * Implémente le pattern Disposable (Symbol.dispose) pour l'utilisation
 * avec `using` en TypeScript 5.2+.
 */

/**
 * Tampon mémoire sécurisé avec zeroing automatique.
 *
 * Toutes les clés cryptographiques DOIVENT être stockées dans un SecureBuffer.
 * L'appel à `.zero()` ou `[Symbol.dispose]()` remplit le buffer de zéros
 * et empêche tout accès ultérieur via `.expose()`.
 *
 * @example
 * ```ts
 * const key = SecureBuffer.alloc(32);
 * // ... utilisation de key.expose() ...
 * key.zero(); // effacement définitif
 * ```
 */
export class SecureBuffer {
  /** Données internes — **jamais** exposées directement. */
  private readonly _buffer: Uint8Array;

  /** Indicateur d'effacement. */
  private _zeroed: boolean;

  /**
   * Constructeur privé — utiliser les factory methods `alloc` ou `from`.
   * @param buffer - Buffer source (la propriété est prise, pas copiée).
   */
  private constructor(buffer: Uint8Array) {
    this._buffer = buffer;
    this._zeroed = false;
  }

  /* ──────────────────────────── Factory methods ──────────────────────────── */

  /**
   * Alloue un nouveau SecureBuffer rempli de zéros.
   * @param size - Taille en octets.
   * @returns Un nouveau SecureBuffer de la taille demandée.
   */
  static alloc(size: number): SecureBuffer {
    if (size <= 0 || !Number.isInteger(size)) {
      throw new RangeError(`SecureBuffer.alloc: taille invalide (${size})`);
    }
    return new SecureBuffer(new Uint8Array(size));
  }

  /**
   * Crée un SecureBuffer à partir de données existantes.
   * Les données source sont **copiées** puis **effacées** (zeroed).
   *
   * @param data - Données source (sera zeroed après copie).
   * @returns Un nouveau SecureBuffer contenant une copie des données.
   */
  static from(data: Uint8Array): SecureBuffer {
    if (data.length === 0) {
      throw new RangeError('SecureBuffer.from: données vides');
    }
    const copy = new Uint8Array(data.length);
    copy.set(data);
    // Zero la source immédiatement
    data.fill(0);
    return new SecureBuffer(copy);
  }

  /**
   * Crée un SecureBuffer en prenant possession du buffer sans copie ni zeroing
   * de la source. Utilisé en interne quand la source est déjà un buffer frais.
   *
   * @param data - Données à envelopper (ownership transféré).
   * @returns Un nouveau SecureBuffer.
   * @internal
   */
  static wrap(data: Uint8Array): SecureBuffer {
    if (data.length === 0) {
      throw new RangeError('SecureBuffer.wrap: données vides');
    }
    return new SecureBuffer(data);
  }

  /* ────────────────────────────── Accessors ──────────────────────────────── */

  /** `true` si le buffer a été effacé. */
  get isZeroed(): boolean {
    return this._zeroed;
  }

  /** Longueur du buffer en octets. */
  get length(): number {
    return this._buffer.length;
  }

  /* ─────────────────────────────── Methods ───────────────────────────────── */

  /**
   * Renvoie une vue **en lecture seule** des données.
   * Lance une erreur si le buffer a déjà été effacé.
   *
   * @returns Vue Uint8Array (readonly via le type — le runtime ne le force pas).
   * @throws {Error} Si le buffer est zeroed.
   */
  expose(): Readonly<Uint8Array> {
    if (this._zeroed) {
      throw new Error(
        'SecureBuffer.expose: tentative d\'accès à un buffer effacé',
      );
    }
    return this._buffer;
  }

  /**
   * Efface le contenu du buffer en le remplissant de zéros.
   * Après appel, `.expose()` lancera une erreur.
   * Peut être appelé plusieurs fois sans effet supplémentaire.
   */
  zero(): void {
    if (!this._zeroed) {
      this._buffer.fill(0);
      this._zeroed = true;
    }
  }

  /**
   * Crée une copie indépendante de ce SecureBuffer.
   * @returns Un nouveau SecureBuffer contenant les mêmes données.
   * @throws {Error} Si le buffer source est zeroed.
   */
  clone(): SecureBuffer {
    if (this._zeroed) {
      throw new Error(
        'SecureBuffer.clone: impossible de cloner un buffer effacé',
      );
    }
    const copy = new Uint8Array(this._buffer.length);
    copy.set(this._buffer);
    return new SecureBuffer(copy);
  }

  /* ──────────────────────────── Disposable ───────────────────────────────── */

  /**
   * Implémente le pattern Disposable.
   * Permet l'utilisation avec `using`:
   * ```ts
   * {
   *   using key = SecureBuffer.alloc(32);
   *   // key.zero() sera appelé automatiquement à la sortie du bloc
   * }
   * ```
   */
  [Symbol.dispose](): void {
    this.zero();
  }
}
