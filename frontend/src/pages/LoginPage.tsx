/**
 * @module pages/LoginPage
 * @description Page de connexion avec style Apple Cyber.
 *
 * Permet:
 * - La saisie d'une phrase de récupération (12/24 mots)
 * - La génération d'une nouvelle identité
 * - La confirmation de la phrase (3 mots aléatoires à ressaisir)
 * - L'affichage du spinner pendant la dérivation de clés
 *
 * Sécurité: le copier-coller est désactivé sur le champ de confirmation.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './LoginPage.css';

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */

interface ConfirmationChallenge {
  /** Indices des mots à confirmer (0-indexed). */
  indices: [number, number, number];
  /** Les mots attendus. */
  expectedWords: [string, string, string];
}

type PageView = 'main' | 'confirm' | 'loading';

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Sélectionne 3 indices aléatoires uniques parmi les mots d'un mnémonique.
 */
function pickRandomIndices(wordCount: number): [number, number, number] {
  const indices = new Set<number>();
  while (indices.size < 3) {
    const idx = Math.floor(Math.random() * wordCount);
    indices.add(idx);
  }
  const arr = Array.from(indices).sort((a, b) => a - b);
  return [arr[0], arr[1], arr[2]];
}

/**
 * Compte les mots dans un texte.
 */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Component
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Page de connexion / génération d'identité.
 *
 * Design: Apple Cyber — fond sombre, glassmorphism, accents neon.
 */
export function LoginPage(): React.JSX.Element {
  const { unlock, isLoading, error } = useAuth();

  // Current view state
  const [view, setView] = useState<PageView>('main');

  // Seed phrase input
  const [seedPhrase, setSeedPhrase] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // Generated mnemonic (for new identity flow)
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(
    null,
  );

  // Confirmation challenge
  const [challenge, setChallenge] = useState<ConfirmationChallenge | null>(
    null,
  );
  const [confirmInputs, setConfirmInputs] = useState<
    [string, string, string]
  >(['', '', '']);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Word count for the seed phrase
  const wordCount = countWords(seedPhrase);
  const isValidWordCount = wordCount === 12 || wordCount === 24;

  /* ──────────────────── Generate New Identity ────────────────────────────── */

  const handleGenerateNew = useCallback(async () => {
    setLocalError(null);
    setView('loading');

    try {
      const { generateMnemonic12 } = await import(
        '../crypto/keyDerivation'
      );
      const mnemonic = await generateMnemonic12();
      setGeneratedMnemonic(mnemonic);
      setSeedPhrase(mnemonic);

      // Préparer le challenge de confirmation
      const words = mnemonic.split(' ');
      const indices = pickRandomIndices(words.length);
      setChallenge({
        indices,
        expectedWords: [words[indices[0]], words[indices[1]], words[indices[2]]],
      });
      setConfirmInputs(['', '', '']);
      setView('confirm');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Erreur de génération';
      setLocalError(message);
      setView('main');
    }
  }, []);

  /* ──────────────────── Restore Identity ─────────────────────────────────── */

  const handleRestore = useCallback(async () => {
    setLocalError(null);

    if (!isValidWordCount) {
      setLocalError('Veuillez entrer exactement 12 ou 24 mots.');
      return;
    }

    setView('loading');

    try {
      await unlock(seedPhrase);
      // Si unlock réussit, le contexte Auth met à jour isLocked → App affiche ChatPage
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Erreur de restauration';
      setLocalError(message);
      setView('main');
    }
  }, [seedPhrase, isValidWordCount, unlock]);

  /* ──────────────────── Confirm Seed Phrase ──────────────────────────────── */

  const handleConfirm = useCallback(async () => {
    if (challenge === null || generatedMnemonic === null) return;
    setLocalError(null);

    // Vérifier les 3 mots
    const allCorrect = challenge.expectedWords.every(
      (word, i) => confirmInputs[i].trim().toLowerCase() === word,
    );

    if (!allCorrect) {
      setLocalError(
        'Les mots de confirmation ne correspondent pas. Veuillez réessayer.',
      );
      return;
    }

    setView('loading');

    try {
      await unlock(generatedMnemonic);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Erreur de déverrouillage';
      setLocalError(message);
      setView('main');
    }
  }, [challenge, confirmInputs, generatedMnemonic, unlock]);

  /** Met à jour un des 3 champs de confirmation. */
  const updateConfirmInput = useCallback(
    (index: 0 | 1 | 2, value: string) => {
      setConfirmInputs((prev) => {
        const next: [string, string, string] = [...prev];
        next[index] = value;
        return next;
      });
    },
    [],
  );

  /** Bloque le collage sur les champs de confirmation. */
  const blockPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
    },
    [],
  );

  /** Retour à la vue principale. */
  const handleBack = useCallback(() => {
    setView('main');
    setGeneratedMnemonic(null);
    setChallenge(null);
    setConfirmInputs(['', '', '']);
    setLocalError(null);
  }, []);

  // Focus le textarea au montage
  useEffect(() => {
    if (view === 'main' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [view]);

  // Error display — merge context error and local error
  const displayError = error ?? localError;

  /* ──────────────────── Render ───────────────────────────────────────────── */

  return (
    <div className="login-page">
      {/* Fond avec particules animées */}
      <div className="login-bg">
        <div className="login-bg__orb login-bg__orb--1" />
        <div className="login-bg__orb login-bg__orb--2" />
        <div className="login-bg__orb login-bg__orb--3" />
      </div>

      {/* Carte principale en glassmorphism */}
      <div className="login-card">
        {/* Logo / Titre */}
        <div className="login-card__header">
          <div className="login-card__logo">
            <span className="login-card__logo-icon">🔐</span>
          </div>
          <h1 className="login-card__title">ZKMsg</h1>
          <p className="login-card__subtitle">
            Zero-Knowledge Messaging
          </p>
        </div>

        {/* ─── Vue principale ─────────────────────────────────────────── */}
        {view === 'main' && (
          <div className="login-card__body">
            <div className="login-card__field">
              <label className="login-card__label" htmlFor="seed-input">
                Phrase de récupération
              </label>
              <textarea
                ref={textareaRef}
                id="seed-input"
                className="login-card__textarea"
                rows={4}
                placeholder="Entrez vos 12 ou 24 mots séparés par des espaces…"
                value={seedPhrase}
                onChange={(e) => {
                  setSeedPhrase(e.target.value);
                  setLocalError(null);
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className="login-card__word-count">
                <span
                  className={
                    isValidWordCount
                      ? 'login-card__word-count--valid'
                      : wordCount > 0
                        ? 'login-card__word-count--invalid'
                        : ''
                  }
                >
                  {wordCount} mot{wordCount !== 1 ? 's' : ''}
                </span>
                <span className="login-card__word-count-target">
                  / 12 ou 24
                </span>
              </div>
            </div>

            {displayError && (
              <div className="login-card__error" role="alert">
                {displayError}
              </div>
            )}

            <div className="login-card__actions">
              <button
                className="login-card__btn login-card__btn--primary"
                onClick={handleRestore}
                disabled={!isValidWordCount || isLoading}
                type="button"
              >
                Restaurer l'identité
              </button>
              <button
                className="login-card__btn login-card__btn--secondary"
                onClick={handleGenerateNew}
                disabled={isLoading}
                type="button"
              >
                Générer une nouvelle identité
              </button>
            </div>
          </div>
        )}

        {/* ─── Vue confirmation ───────────────────────────────────────── */}
        {view === 'confirm' && challenge !== null && (
          <div className="login-card__body">
            <div className="login-card__confirm-header">
              <h2 className="login-card__confirm-title">
                Confirmez votre phrase
              </h2>
              <p className="login-card__confirm-desc">
                Votre phrase de récupération a été générée. Notez-la dans un
                endroit sûr, puis confirmez les 3 mots suivants :
              </p>
            </div>

            {/* Affichage de la phrase générée */}
            <div className="login-card__mnemonic-display">
              {generatedMnemonic?.split(' ').map((word, i) => (
                <span key={i} className="login-card__mnemonic-word">
                  <span className="login-card__mnemonic-index">{i + 1}.</span>
                  {word}
                </span>
              ))}
            </div>

            {/* Champs de confirmation */}
            <div className="login-card__confirm-fields">
              {challenge.indices.map((wordIndex, i) => (
                <div key={wordIndex} className="login-card__confirm-field">
                  <label
                    className="login-card__label"
                    htmlFor={`confirm-${i}`}
                  >
                    Mot #{wordIndex + 1}
                  </label>
                  <input
                    id={`confirm-${i}`}
                    className="login-card__input"
                    type="text"
                    value={confirmInputs[i as 0 | 1 | 2]}
                    onChange={(e) =>
                      updateConfirmInput(i as 0 | 1 | 2, e.target.value)
                    }
                    onPaste={blockPaste}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={`Mot #${wordIndex + 1}`}
                  />
                </div>
              ))}
            </div>

            {displayError && (
              <div className="login-card__error" role="alert">
                {displayError}
              </div>
            )}

            <div className="login-card__actions">
              <button
                className="login-card__btn login-card__btn--primary"
                onClick={handleConfirm}
                disabled={
                  isLoading ||
                  confirmInputs.some((v) => v.trim() === '')
                }
                type="button"
              >
                Confirmer et déverrouiller
              </button>
              <button
                className="login-card__btn login-card__btn--ghost"
                onClick={handleBack}
                disabled={isLoading}
                type="button"
              >
                ← Retour
              </button>
            </div>
          </div>
        )}

        {/* ─── Vue chargement ─────────────────────────────────────────── */}
        {(view === 'loading' || isLoading) && (
          <div className="login-card__body login-card__body--loading">
            <div className="login-card__spinner">
              <div className="login-card__spinner-ring" />
              <div className="login-card__spinner-ring login-card__spinner-ring--2" />
              <div className="login-card__spinner-ring login-card__spinner-ring--3" />
            </div>
            <p className="login-card__loading-text">
              Dérivation des clés en cours…
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="login-card__footer">
          <p className="login-card__footer-text">
            Chiffrement de bout en bout • Aucune donnée stockée sur le serveur
          </p>
        </div>
      </div>
    </div>
  );
}
