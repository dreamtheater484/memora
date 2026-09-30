#!/usr/bin/env node
/**
 * Puts what the desktop app runs beside it, in build/memora (packaged as the app's resources):
 *
 *   server/dist/server.mjs      the server bundle, as in the Docker image
 *   server/drizzle/             its database migrations
 *   server/node_modules/        its packages that stay outside the bundle
 *   web/dist/                   the web app
 *
 * Run `pnpm build` (the server and the web app) and this package's build first. The layout is
 * the repository's, so the server finds its migrations and the web app as it does in Docker.
 *
 * Of the packages beside the server, Argon2 stays out: the desktop app has no passwords, and
 * the server loads it only for them. better-sqlite3 keeps its builds for this system only.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_TITLE, withDependencies } from '../../../scripts/licenses.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '../..');
const out = path.join(desktop, 'build', 'memora');
const server = path.join(root, 'apps', 'server');
const web = path.join(root, 'apps', 'web', 'dist');

const need = (file, what) => {
  if (!existsSync(file)) throw new Error(`${path.relative(root, file)} is missing: ${what}`);
};
need(path.join(server, 'dist', 'server.mjs'), 'run `pnpm build` first');
need(path.join(web, 'index.html'), 'run `pnpm build` first');
need(path.join(desktop, 'dist', 'third-party-licenses.txt'), 'run this package’s build first');

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'server', 'dist'), { recursive: true });
cpSync(path.join(server, 'dist', 'server.mjs'), path.join(out, 'server', 'dist', 'server.mjs'));
cpSync(path.join(server, 'drizzle'), path.join(out, 'server', 'drizzle'), { recursive: true });
cpSync(web, path.join(out, 'web', 'dist'), { recursive: true });

/** Which of better-sqlite3's builds this system's app needs (both processors: see macOS). */
const keepBuild = (file) => file.startsWith(`${process.platform}-`) && file.endsWith('.node');

const { dependencies } = JSON.parse(readFileSync(path.join(server, 'package.json'), 'utf8'));
const packages = new Set();
for (const name of Object.keys(dependencies)) {
  if (name === '@node-rs/argon2') continue;
  for (const dir of withDependencies(path.join(server, 'node_modules', name))) packages.add(dir);
}
/** Only needed to compile better-sqlite3, which comes built: C++ headers. */
const BUILD_ONLY = new Set(['node-addon-api']);
for (const dir of packages) {
  const { name } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (BUILD_ONLY.has(name)) {
    packages.delete(dir);
    continue;
  }
  const target = path.join(out, 'server', 'node_modules', name);
  cpSync(dir, target, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(dir, source);
      if (relative === '') return true;
      if (name !== 'better-sqlite3') return !relative.startsWith('node_modules');
      // Its C sources and build files aren't needed: only the code and this system's builds.
      const [top, file] = relative.split(path.sep);
      if (top === 'prebuilds') return file === undefined || keepBuild(file);
      return ['package.json', 'lib', 'LICENSE', 'README.md'].includes(top);
    },
  });
}

// The licence list: the app's and the server's (from `pnpm build`), then the desktop app's
// own packages. The runtime is Electron here, not the Node.js the build ran on.
const notices = path.join(out, 'web', 'dist', 'third-party-licenses.txt');
const rule = '='.repeat(78);
const combined = readFileSync(notices, 'utf8');
const cut = combined.indexOf(`${rule}\nThe runtime:`);
const electron = JSON.parse(
  readFileSync(path.join(desktop, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;
writeFileSync(
  notices,
  [
    (cut < 0 ? combined : combined.slice(0, cut)).trimEnd(),
    readFileSync(path.join(desktop, 'dist', 'third-party-licenses.txt'), 'utf8').trim(),
    `${rule}\nThe runtime: Electron ${electron}\n${rule}\n\n` +
      'The app runs in Electron (MIT licence), which includes Chromium and Node.js. Their\n' +
      'licences come with the app, in its folder: LICENSE.electron.txt and\n' +
      'LICENSES.chromium.html. Source: https://github.com/electron/electron\n',
  ].join('\n\n'),
);
if (!combined.includes(SERVER_TITLE)) {
  console.warn('resources: the licence list has no server section; run `pnpm build` first');
}
console.log(`resources: ${path.relative(root, out)} (${packages.size} packages beside the server)`);
