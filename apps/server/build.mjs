// Bundles the server (including @memora/shared and all pure-JS dependencies) into dist/server.mjs,
// and the memora-admin command-line tool into dist/admin.mjs.
// Only native modules stay external; they are listed under `dependencies` in package.json and are
// the only packages installed in the Docker runtime image.
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/index.ts', admin: 'src/admin-cli.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Native modules: loaded from node_modules at runtime (see `dependencies`).
  external: ['better-sqlite3', '@node-rs/argon2'],
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
});
