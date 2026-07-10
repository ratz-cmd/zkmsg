/**
 * @module contexts/AuthContext
 * @description Contexte React pour l'état d'authentification.
 *
 * Encapsule le SessionManager et fournit un hook `useAuth()` pour accéder
 * à l'état de verrouillage, déverrouiller, verrouiller et récupérer l'identité.
 * Gère automatiquement le timer d'inactivité via les événements DOM.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { SessionManager, type DecryptedIdentity } from '../crypto/sessionManager';

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */

/** Valeur exposée par le contexte Auth. */
export interface AuthContextValue {
  /** Indique si la session est verrouillée (clés zeroed). */
  isLocked: boolean;

  /** Identifiant du compte courant (Base58), ou null si verrouillé. */
  accountId: string | null;

  /** Identité publique complète, ou null si verrouillé. */
  identity: DecryptedIdentity | null;

  /** Indique si une opération de déverrouillage est en cours. */
  isLoading: boolean;

  /** Dernière erreur éventuelle (message). */
  error: string | null;

  /**
   * Déverrouille la session avec un mnémonique BIP39.
   * @param mnemonic - Phrase de 12 ou 24 mots.
   */
  unlock: (mnemonic: string) => Promise<void>;

  /** Verrouille la session (zero toutes les clés). */
  lock: () => void;

  /** Réinitialise le timer d'inactivité. */
  resetTimer: () => void;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Context
 * ──────────────────────────────────────────────────────────────────────────── */

const AuthContext = createContext<AuthContextValue | null>(null);

/* ────────────────────────────────────────────────────────────────────────────
 * Provider
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Props du AuthProvider.
 */
interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Fournisseur du contexte d'authentification.
 *
 * Encapsule un `SessionManager` et synchronise son état avec React.
 * Écoute les événements DOM (mousemove, keydown, click, touchstart)
 * pour réinitialiser le timer d'inactivité.
 *
 * @example
 * ```tsx
 * <AuthProvider>
 *   <App />
 * </AuthProvider>
 * ```
 */
export function AuthProvider({ children }: AuthProviderProps): React.JSX.Element {
  const [isLocked, setIsLocked] = useState(true);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<DecryptedIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SessionManager instancié une seule fois
  const sessionManagerRef = useRef<SessionManager | null>(null);

  // Initialiser le SessionManager avec le callback d'auto-lock
  if (sessionManagerRef.current === null) {
    sessionManagerRef.current = new SessionManager(() => {
      // Callback d'auto-verrouillage — mise à jour de l'état React
      setIsLocked(true);
      setAccountId(null);
      setIdentity(null);
      setError(null);
    });
  }

  const sm = sessionManagerRef.current;

  /**
   * Déverrouille la session.
   */
  const unlock = useCallback(
    async (mnemonic: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await sm.unlockSession(mnemonic);
        const id = sm.getIdentity();
        setIsLocked(false);
        setAccountId(id.accountId);
        setIdentity(id);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Erreur de déverrouillage';
        setError(message);
        sm.lockSession();
        setIsLocked(true);
        setAccountId(null);
        setIdentity(null);
      } finally {
        setIsLoading(false);
      }
    },
    [sm],
  );

  /**
   * Verrouille la session explicitement.
   */
  const lock = useCallback((): void => {
    sm.lockSession();
    setIsLocked(true);
    setAccountId(null);
    setIdentity(null);
    setError(null);
  }, [sm]);

  /**
   * Réinitialise le timer d'inactivité.
   */
  const resetTimer = useCallback((): void => {
    sm.resetInactivityTimer();
  }, [sm]);

  // Écouter les événements DOM pour réinitialiser le timer d'inactivité
  useEffect(() => {
    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'keydown',
      'click',
      'touchstart',
      'scroll',
    ];

    const handler = (): void => {
      if (!sm.isLocked()) {
        sm.resetInactivityTimer();
      }
    };

    for (const event of events) {
      window.addEventListener(event, handler, { passive: true });
    }

    return () => {
      for (const event of events) {
        window.removeEventListener(event, handler);
      }
    };
  }, [sm]);

  // Nettoyer le SessionManager au démontage
  useEffect(() => {
    return () => {
      sm.destroy();
    };
  }, [sm]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      isLocked,
      accountId,
      identity,
      isLoading,
      error,
      unlock,
      lock,
      resetTimer,
    }),
    [isLocked, accountId, identity, isLoading, error, unlock, lock, resetTimer],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Hook
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Hook pour accéder au contexte d'authentification.
 *
 * @returns Valeur du contexte Auth.
 * @throws {Error} Si utilisé en dehors d'un `<AuthProvider>`.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isLocked, unlock, lock, accountId } = useAuth();
 *   // ...
 * }
 * ```
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error(
      'useAuth doit être utilisé à l\'intérieur d\'un <AuthProvider>',
    );
  }
  return ctx;
}
