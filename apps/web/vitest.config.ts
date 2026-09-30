import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';
import { pagedPolyfill } from './vite.config';

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: [
      ...pagedPolyfill,
      // The app gets mammoth's browser build (its `browser` field); so do the tests.
      {
        find: /^mammoth$/,
        replacement: fileURLToPath(
          new URL('./node_modules/mammoth/mammoth.browser.js', import.meta.url),
        ),
      },
    ],
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
