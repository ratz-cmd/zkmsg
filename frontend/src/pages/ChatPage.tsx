/**
 * @module pages/ChatPage
 * @description Page de chat placeholder (Phase 1 MVP).
 *
 * Affiche l'identité du compte connecté et un bouton de verrouillage.
 * Sera remplacée par l'implémentation complète en Phase 2.
 */

import React from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Page de chat — placeholder Phase 1.
 *
 * Affiche l'accountId, les clés publiques et un bouton de déconnexion.
 */
export function ChatPage(): React.JSX.Element {
  const { accountId, identity, lock } = useAuth();

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.statusDot} />
          <h1 style={styles.title}>ZKMsg</h1>
        </div>

        <div style={styles.identitySection}>
          <h2 style={styles.sectionTitle}>Identité active</h2>

          <div style={styles.field}>
            <span style={styles.label}>Account ID</span>
            <span style={styles.value}>
              {accountId
                ? `${accountId.slice(0, 8)}…${accountId.slice(-6)}`
                : '—'}
            </span>
          </div>

          {identity && (
            <>
              <div style={styles.field}>
                <span style={styles.label}>Ed25519 Public</span>
                <span style={styles.value}>
                  {bytesToHex(identity.identityPublicKey).slice(0, 16)}…
                </span>
              </div>
              <div style={styles.field}>
                <span style={styles.label}>X25519 Public</span>
                <span style={styles.value}>
                  {bytesToHex(identity.x25519PublicKey).slice(0, 16)}…
                </span>
              </div>
            </>
          )}
        </div>

        <div style={styles.placeholder}>
          <p style={styles.placeholderText}>
            💬 L'interface de messagerie sera disponible en Phase 2
          </p>
          <p style={styles.placeholderSubtext}>
            Les clés d'identité sont dérivées et prêtes.
            <br />
            Verrouillage automatique après 60s d'inactivité.
          </p>
        </div>

        <button
          type="button"
          style={styles.lockButton}
          onClick={lock}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.background =
              'rgba(239, 68, 68, 0.15)';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.background =
              'rgba(255, 255, 255, 0.04)';
          }}
        >
          🔒 Verrouiller la session
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Convertit un Uint8Array en chaîne hexadécimale.
 * @param bytes - Données à convertir.
 * @returns Chaîne hex (lowercase).
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ────────────────────────────────────────────────────────────────────────────
 * Inline Styles (Apple Cyber)
 * ──────────────────────────────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0a0a0a',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 440,
    margin: '0 20px',
    background: 'rgba(255, 255, 255, 0.04)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 24,
    padding: '36px 32px 28px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 120px rgba(163,112,240,0.08)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 28,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#22c55e',
    boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)',
  },
  title: {
    fontFamily: "'Poppins', sans-serif",
    fontSize: 22,
    fontWeight: 700,
    color: '#f4f4f5',
    margin: 0,
  },
  identitySection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: '#a1a1aa',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    margin: 0,
  },
  field: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.05)',
  },
  label: {
    fontSize: 12,
    color: '#71717a',
    fontWeight: 500,
  },
  value: {
    fontSize: 13,
    color: '#a370f0',
    fontFamily: "'Inter', monospace",
    fontWeight: 600,
  },
  placeholder: {
    textAlign: 'center' as const,
    padding: '24px 16px',
    background: 'rgba(163, 112, 240, 0.04)',
    borderRadius: 12,
    border: '1px solid rgba(163, 112, 240, 0.1)',
    marginBottom: 20,
  },
  placeholderText: {
    fontSize: 15,
    color: '#d4d4d8',
    margin: '0 0 8px',
  },
  placeholderSubtext: {
    fontSize: 12,
    color: '#71717a',
    margin: 0,
    lineHeight: 1.6,
  },
  lockButton: {
    width: '100%',
    padding: '12px 20px',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
};
