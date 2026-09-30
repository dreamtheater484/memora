import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { serviceWorker } from './sw/plugin';

/**
 * The Markdown parser runs in a worker, where there is no `document`; this one dependency
 * uses it in its browser build, so it gets its plain one (the same code the worker condition
 * picks) everywhere.
 */
function withoutDocument(): Plugin {
  return {
    name: 'memora-without-document',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (id !== 'decode-named-character-reference') return null;
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
      return resolved && { ...resolved, id: resolved.id.replace(/index\.dom\.js$/, 'index.js') };
    },
  };
}

/**
 * Paged.js's polyfill (the print preview loads it into its frame) isn't in the package's
 * exports, so it gets a name of its own.
 */
export const pagedPolyfill = [
  {
    find: /^pagedjs-polyfill(?=\?|$)/,
    replacement: fileURLToPath(
      new URL('./node_modules/pagedjs/dist/paged.polyfill.min.js', import.meta.url),
    ),
  },
];

// `--mode gallery` also builds the component gallery (gallery.html) into its own
// folder, for the visual tests. The production build only contains index.html;
// in development the gallery is always served at /gallery.html.
export default defineConfig(({ mode }) => {
  const gallery = mode === 'gallery';
  return {
    plugins: [withoutDocument(), react(), tailwindcss(), serviceWorker()],
    resolve: { alias: pagedPolyfill },
    worker: { plugins: () => [withoutDocument()] },
    server: {
      port: 5173,
      // During development the API runs separately (`pnpm dev` starts both).
      proxy: {
        '/api': { target: 'http://127.0.0.1:3000', ws: true },
      },
      // Test runs write and delete a lot here; the app doesn't use any of it.
      watch: {
        ignored: ['**/test-results/**', '**/playwright-report/**', '**/dist-gallery/**'],
      },
    },
    preview: { port: 4173 },
    build: {
      outDir: gallery ? 'dist-gallery' : 'dist',
      emptyOutDir: true,
      // No source maps in production: they would embed build-machine paths.
      sourcemap: false,
      rolldownOptions: gallery ? { input: ['index.html', 'gallery.html'] } : undefined,
    },
  };
});
