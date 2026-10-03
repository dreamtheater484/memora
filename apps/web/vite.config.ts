import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from '../../packages/shared/src/security';
import { HEADER, packageDirOf, section } from '../../scripts/licenses.mjs';
import { serviceWorker } from './sw/plugin';

/**
 * The Markdown parser runs in a worker, where there is no `document`; this one dependency
 * uses it in its browser build, so it gets its plain one (the same code the worker condition
 * picks) everywhere. An alias, so that it also holds for the dependencies Vite bundles ahead
 * in development, which plugins don't see. Found from the package that brings it in (Node's
 * own resolution picks the plain build).
 */
function withoutDocument() {
  const from = (name: string, base: string) => createRequire(base).resolve(name);
  const remark = from('remark-parse', import.meta.url);
  const plain = from('decode-named-character-reference', from('mdast-util-from-markdown', remark));
  return { find: /^decode-named-character-reference$/, replacement: plain };
}

/**
 * Where the dev server sends `/api`: the API that `pnpm dev` starts, on the same `PORT` as it
 * (3000 when unset), or any other one in MEMORA_DEV_API (from the environment or `.env`).
 */
function devApi(mode: string): string {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  // The environment's value comes first.
  const target = loadEnv(mode, root, 'MEMORA_DEV_API').MEMORA_DEV_API?.trim();
  if (target) return target.replace(/\/+$/, '');
  return `http://127.0.0.1:${process.env.PORT?.trim() || 3000}`;
}

/**
 * Zod compiles validators with `new Function` where it may, and tries once at start to find
 * out. The app's content security policy forbids eval (§11), so the app's zod starts in the
 * mode that neither compiles nor tries (each try is reported as a policy violation).
 */
function zodWithoutEval(): Plugin {
  const from = '(_a.__zod_globalConfig = {})';
  return {
    name: 'memora-zod-without-eval',
    transform(code, id) {
      if (!/[\\/]zod[\\/]v4[\\/]core[\\/]core\.js$/.test(id)) return null;
      if (!code.includes(from)) this.error('zod changed: update zodWithoutEval in vite.config.ts');
      return code.replace(from, '(_a.__zod_globalConfig = { jitless: true })');
    },
  };
}

/** Where package `name` is installed, as seen from `from`. */
function installedDir(name: string, from: string) {
  const require = createRequire(from);
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    return packageDirOf(require.resolve(name))!;
  }
}

/**
 * Code that is in every build without being imported: Vite's and Rolldown's helpers (module
 * preloading, the runtime) and Tailwind's generated styles.
 */
function toolDirs() {
  const here = import.meta.url;
  const vite = installedDir('vite', here);
  return [
    vite,
    installedDir('rolldown', path.join(vite, 'package.json')),
    installedDir('tailwindcss', here),
  ];
}

/**
 * The open-source licences of every package bundled into the app (its workers included), in
 * third-party-licenses.txt: the notices travel with the app. `pnpm build` then adds the
 * server's (scripts/licenses.mjs). Stops the build on a licence that isn't on the list there.
 */
function licenses() {
  const files = new Set<string>();
  const collect = (ids: Iterable<string>) => {
    for (const id of ids) files.add(id);
  };
  const worker: Plugin = {
    name: 'memora-licenses-worker',
    apply: 'build',
    generateBundle() {
      collect(this.getModuleIds());
    },
  };
  const main: Plugin = {
    name: 'memora-licenses',
    apply: 'build',
    generateBundle(_, bundle) {
      collect(this.getModuleIds());
      // Files that come in through CSS (the fonts) are assets, not modules.
      for (const out of Object.values(bundle)) {
        if (out.type === 'asset') collect(out.originalFileNames);
      }
      const dirs = new Set<string>(toolDirs());
      for (const file of files) {
        const dir = packageDirOf(file);
        if (dir) dirs.add(dir);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-licenses.txt',
        source: `${HEADER}${section('The app in your browser', dirs)}`,
      });
    },
  };
  return { main, worker };
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
  const notices = licenses();
  return {
    plugins: [zodWithoutEval(), react(), tailwindcss(), serviceWorker(), notices.main],
    resolve: { alias: [withoutDocument(), ...pagedPolyfill] },
    worker: { plugins: () => [zodWithoutEval(), notices.worker] },
    server: {
      port: 5173,
      // During development the API runs separately (`pnpm dev` starts both).
      proxy: {
        '/api': { target: devApi(mode), ws: true },
      },
      // Test runs write and delete a lot here; the app doesn't use any of it.
      watch: {
        ignored: ['**/test-results/**', '**/playwright-report/**', '**/dist-gallery/**'],
      },
    },
    // The built app is tested under the server's security headers (the dev server can't be:
    // its hot reload runs inline scripts).
    preview: {
      port: 4173,
      headers: { ...SECURITY_HEADERS, 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
    },
    build: {
      outDir: gallery ? 'dist-gallery' : 'dist',
      emptyOutDir: true,
      // No source maps in production: they would embed build-machine paths.
      sourcemap: false,
      rolldownOptions: gallery ? { input: ['index.html', 'gallery.html'] } : undefined,
    },
  };
});
