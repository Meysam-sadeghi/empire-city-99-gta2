import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier2d-compat'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
