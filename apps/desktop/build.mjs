// Bundles the app's main process (src/main.ts, with electron-updater) into dist/main.cjs, and
// lists the packages it contains with their licences (scripts/licenses.mjs). The server and the
// web app come from their own builds: scripts/resources.mjs puts them beside the app.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { packageDirOf, section } from '../../scripts/licenses.mjs';

// Sync through Google Drive (ADR 0006): the app's OAuth client, from CI (docs/GOOGLE_DRIVE.md).
// Memora's server refuses to start with a client ID of another shape, so a slip in the CI
// settings (a space, the wrong value) fails the build here instead of the app.
const googleClientId = (process.env.MEMORA_GOOGLE_CLIENT_ID ?? '').trim();
const googleClientSecret = (process.env.MEMORA_GOOGLE_CLIENT_SECRET ?? '').trim();
if (googleClientId && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(googleClientId)) {
  throw new Error(
    'MEMORA_GOOGLE_CLIENT_ID isn’t a Google client ID (…apps.googleusercontent.com). Check the repository variable.',
  );
}
if (googleClientSecret.length > 200 || /\s/.test(googleClientSecret)) {
  throw new Error(
    'MEMORA_GOOGLE_CLIENT_SECRET isn’t a client secret. Check the repository secret.',
  );
}

const result = await build({
  entryPoints: { main: 'src/main.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  // Signed builds can update themselves on macOS too (src/updates.ts, docs/SIGNING.md).
  define: {
    __MEMORA_SIGNED__: JSON.stringify(Boolean(process.env.CSC_LINK)),
    // Google's clients for desktop apps can't keep a secret, and don't rely on it.
    __MEMORA_GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId),
    __MEMORA_GOOGLE_CLIENT_SECRET__: JSON.stringify(googleClientSecret),
  },
  sourcemap: false,
  legalComments: 'eof',
  metafile: true,
  logLevel: 'info',
});

const dirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const dir = packageDirOf(path.resolve(input));
  if (dir) dirs.add(dir);
}
writeFileSync('dist/third-party-licenses.txt', section('The desktop app', dirs));
