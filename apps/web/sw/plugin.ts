import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin, Rolldown } from 'vite';

type OutputBundle = Rolldown.OutputBundle;
type OutputChunk = Rolldown.OutputChunk;

/*
 * Builds the service worker (sw.js) with the list of files to keep: the app's page, its
 * scripts, styles and workers (lazy ones too, so the editor opens offline) and the Latin font
 * files. Other font subsets are fetched and kept when a page needs them. So are the optional
 * parts that load on first use (diagrams, maths, Shiki, and the languages for code blocks
 * in the editor), instead of every device downloading them up front.
 */

const source = fileURLToPath(new URL('./sw.js', import.meta.url));

/** Lazily loaded chunks, by the module they are loaded for. */
const OPTIONAL =
  /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:mermaid|@mermaid-js|cytoscape[^/]*|katex|shiki|@shikijs|@codemirror\/(?:lang-[^/]+|legacy-modes))\/|src\/markdown\/(?:pipeline|math|mermaid)\.ts$|src\/rich\/convert\.ts$/;

/** Files from public/ the installed app needs without a connection. */
const PUBLIC = [
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/apple-touch-icon.png',
];

const precachedAsset = (file: string) =>
  /\.(css|js)$/.test(file) || (/\.woff2$/.test(file) && /latin(?!-ext)/.test(file));

/**
 * Scripts reachable from the app without loading an optional part on demand. What a script
 * imports directly always comes with it (the rich editor draws formulas with KaTeX, say).
 */
function coreChunks(bundle: OutputBundle): Set<string> {
  const chunks = Object.values(bundle).filter((f): f is OutputChunk => f.type === 'chunk');
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const optional = (c: OutputChunk) => !c.isEntry && OPTIONAL.test(c.facadeModuleId ?? '');
  const core = new Set<string>();
  const visit = (chunk: OutputChunk | undefined, required: boolean) => {
    if (!chunk || core.has(chunk.fileName) || (!required && optional(chunk))) return;
    core.add(chunk.fileName);
    for (const name of chunk.imports) visit(byName.get(name), true);
    for (const name of chunk.dynamicImports) visit(byName.get(name), false);
  };
  for (const chunk of chunks) if (chunk.isEntry) visit(chunk, true);
  return core;
}

export function serviceWorker(): Plugin {
  return {
    name: 'memora-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const core = coreChunks(bundle);
      // Workers are emitted as assets; chunks count only when the app reaches them.
      const files = Object.entries(bundle)
        .filter(([file, output]) =>
          output.type === 'chunk' ? core.has(file) : precachedAsset(file),
        )
        .map(([file]) => file)
        .sort();
      const urls = ['/', ...PUBLIC, ...files.map((f) => `/${f}`)];
      const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12);
      const code = readFileSync(source, 'utf8').replace(
        'self.__MEMORA_PRECACHE__',
        JSON.stringify({ version, urls }),
      );
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}
