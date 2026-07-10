import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  // Tauri expects a fixed port in dev mode
  server: {
    port: 1420,
    strictPort: true,
  },
  // Tauri CLI expects the build output in ../dist
  build: {
    target: 'es2022',
    outDir: 'dist',
    minify: 'esbuild',
    sourcemap: false,
  },
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
});
