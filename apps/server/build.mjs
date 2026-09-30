// Bundles the server (including @memora/shared and all pure-JS dependencies) into dist/server.mjs,
// and the memora-admin command-line tool into dist/admin.mjs.
// Only native modules stay external; they are listed under `dependencies` in package.json and are
// the only packages installed in the Docker runtime image.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { packageDirOf, section, SERVER_TITLE, withDependencies } from '../../scripts/licenses.mjs';

const result = await build({
  entryPoints: { server: 'src/index.ts', admin: 'src/admin-cli.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Native modules: loaded from node_modules at runtime (see `dependencies`). `ws` tries two
  // optional native speed-ups and does without them; they are not installed.
  external: ['better-sqlite3', '@node-rs/argon2', 'bufferutil', 'utf-8-validate'],
  // No source maps in production output: they would embed build-machine paths.
  sourcemap: false,
  legalComments: 'eof',
  // Bundled CommonJS dependencies expect require/__dirname, which ES modules do not provide.
  banner: {
    js: [
      "import { createRequire as __memoraCreateRequire } from 'node:module';",
      "import { fileURLToPath as __memoraFileURLToPath } from 'node:url';",
      "import { dirname as __memoraDirname } from 'node:path';",
      'const require = __memoraCreateRequire(import.meta.url);',
      'const __filename = __memoraFileURLToPath(import.meta.url);',
      'const __dirname = __memoraDirname(__filename);',
    ].join('\n'),
  },
  logLevel: 'info',
  metafile: true,
});

// The open-source licences of what the server ships: every package bundled in, and the
// native ones beside it with their dependencies (scripts/licenses.mjs).
const dirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const dir = packageDirOf(path.resolve(input));
  if (dir) dirs.add(dir);
}
const { dependencies } = JSON.parse(readFileSync('package.json', 'utf8'));
for (const name of Object.keys(dependencies)) {
  for (const dir of withDependencies(path.join('node_modules', name))) dirs.add(dir);
}
writeFileSync('dist/third-party-licenses.txt', section(SERVER_TITLE, dirs));
