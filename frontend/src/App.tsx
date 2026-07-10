/**
 * @module App
 * @description Composant racine de ZKMsg.
 *
 * Route entre LoginPage et ChatPage en fonction de l'état d'authentification.
 * Lorsque la session est verrouillée, l'utilisateur voit la page de login.
 * Lorsqu'elle est déverrouillée, il voit la page de chat (placeholder Phase 1).
 */

import React from 'react';
import { useAuth } from './contexts/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';

/**
 * Composant racine — routage conditionnel basé sur l'état de la session.
 */
export function App(): React.JSX.Element {
  const { isLocked } = useAuth();

  if (isLocked) {
    return <LoginPage />;
  }

  return <ChatPage />;
}
