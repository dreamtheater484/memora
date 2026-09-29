import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // During development the API runs separately (`pnpm dev` starts both).
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // No source maps in production: they would embed build-machine paths.
    sourcemap: false,
  },
});
