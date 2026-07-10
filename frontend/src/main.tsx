/**
 * @module main
 * @description Point d'entrée React de ZKMsg.
 *
 * Monte le composant App dans le DOM avec le AuthProvider.
 * StrictMode est activé pour détecter les problèmes en développement.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './contexts/AuthContext';
import { App } from './App';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Élément #root introuvable dans le DOM');
}

const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
