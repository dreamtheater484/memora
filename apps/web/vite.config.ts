import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `--mode gallery` also builds the component gallery (gallery.html) into its own
// folder, for the visual tests. The production build only contains index.html;
// in development the gallery is always served at /gallery.html.
export default defineConfig(({ mode }) => {
  const gallery = mode === 'gallery';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // During development the API runs separately (`pnpm dev` starts both).
      proxy: {
        '/api': { target: 'http://127.0.0.1:3000', ws: true },
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
