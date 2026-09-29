import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/*
 * Builds the service worker (sw.js) with the list of files to keep: the app's page, its
 * scripts and styles (lazy ones too, so the editor opens offline) and the Latin font files.
 * Other font subsets are fetched and kept when a page needs them.
 */

const source = fileURLToPath(new URL('./sw.js', import.meta.url));

const precached = (file: string) =>
  /\.(js|css)$/.test(file) || (/\.woff2$/.test(file) && /latin(?!-ext)/.test(file));

export function serviceWorker(): Plugin {
  return {
    name: 'memora-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter(precached).sort();
      const urls = ['/', ...files.map((f) => `/${f}`)];
      const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12);
      const code = readFileSync(source, 'utf8').replace(
        'self.__MEMORA_PRECACHE__',
        JSON.stringify({ version, urls }),
      );
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}
