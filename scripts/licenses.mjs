#!/usr/bin/env node
/**
 * The open-source licences of everything Memora ships, so the notices travel with the copies:
 * every package whose code ends up in the web app or the server, with its licence text.
 *
 * Each build lists what it bundled: the `licenses` plugin in apps/web/vite.config.ts writes
 * the web app's list into apps/web/dist/third-party-licenses.txt, and apps/server/build.mjs
 * writes the server's into apps/server/dist/third-party-licenses.txt. Then
 *
 *   node scripts/licenses.mjs combine
 *
 * (the last step of `pnpm build`) adds the server's list and Node.js's own licence to the web
 * app's file, which Settings links to. The Docker image carries all three files.
 *
 * A build stops when a package's licence isn't one of ALLOWED: a new kind of licence gets a
 * look before it ships.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Licences that need nothing beyond shipping their notice: permissive ones, the fonts' SIL Open
 * Font License, and the Eclipse Public License of elkjs (Mermaid's layout engine, shipped
 * unchanged; the notice says where its source is).
 */
export const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'EPL-2.0',
  'ISC',
  'MIT',
  'MIT-0',
  'OFL-1.1',
  'Unlicense',
  'Zlib',
]);

/** Packages whose package.json doesn't say the licence their licence file has. */
const KNOWN = { khroma: 'MIT' };

/** A licence, or an SPDX expression of them, that may ship: one side of an OR, all of an AND. */
export function allowed(expression) {
  const inner = expression.trim().replace(/^\((.*)\)$/, '$1');
  if (/ OR /.test(inner)) return inner.split(/ OR /).some(allowed);
  if (/ AND /.test(inner)) return inner.split(/ AND /).every(allowed);
  return ALLOWED.has(inner);
}

/** The folder of the npm package a bundled file comes from, or null for the app's own code. */
export function packageDirOf(file) {
  const clean = file.replace(/^\0/, '').split('?')[0].replaceAll('\\', '/');
  const at = clean.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const floor = clean.slice(0, at + '/node_modules/'.length);
  for (let dir = path.posix.dirname(clean); dir.length >= floor.length;) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name && pkg.version) return dir;
    }
    const up = path.posix.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** A package and every package it depends on at runtime, as installed. */
export function withDependencies(dir, seen = new Set()) {
  const real = realpathSync(dir);
  if (seen.has(real)) return seen;
  seen.add(real);
  const pkg = JSON.parse(readFileSync(path.join(real, 'package.json'), 'utf8'));
  const names = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
  for (const name of names) {
    const found = installed(real, name);
    if (found) withDependencies(found, seen);
  }
  return seen;
}

/** Where `name` is installed as seen from `dir`, by Node's lookup, or null when it isn't. */
function installed(dir, name) {
  for (let at = dir; ;) {
    const modules = path.basename(at) === 'node_modules' ? at : path.join(at, 'node_modules');
    const candidate = path.join(modules, name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    const up = path.dirname(at);
    if (up === at) return null;
    at = up;
  }
}

function licenseOf(pkg) {
  if (KNOWN[pkg.name]) return KNOWN[pkg.name];
  const { license, licenses } = pkg;
  if (typeof license === 'string') return license;
  if (license?.type) return license.type;
  if (Array.isArray(licenses)) return licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function sourceOf(pkg) {
  let url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!url) return pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}`;
  url = url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://');
  url = url.replace(/^git@github\.com:/, 'https://github.com/');
  if (/^github:/.test(url)) return `https://github.com/${url.slice(7)}`;
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  return url;
}

function authorOf(pkg) {
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  return author?.replace(/\s*[<(].*$/, '').trim() || null;
}

/** Name, version, licence, source and the texts of its licence and notice files. */
export function describe(dir) {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const files = readdirSync(dir).sort();
  const read = (pattern) =>
    files
      .filter((f) => pattern.test(f))
      .map((f) => readFileSync(path.join(dir, f), 'utf8').trim())
      .filter(Boolean);
  return {
    name: pkg.name,
    version: pkg.version,
    license: licenseOf(pkg),
    source: sourceOf(pkg),
    author: authorOf(pkg),
    texts: read(/^(licen[cs]e|copying)([.-]|$)/i),
    notices: read(/^notice([.-]|$)/i),
  };
}

const RULE = '-'.repeat(78);

/**
 * One section of the notices file: `title`, then each package in `dirs` once, by name.
 * Throws, naming them, when packages have licences that aren't ALLOWED.
 */
export function section(title, dirs) {
  const byKey = new Map();
  for (const dir of dirs) {
    const p = describe(dir);
    if (!/^@memora\//.test(p.name)) byKey.set(`${p.name}@${p.version}`, p);
  }
  const packages = [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const refused = packages.filter((p) => !allowed(p.license));
  if (refused.length) {
    throw new Error(
      `licences not on the list in scripts/licenses.mjs: ${refused
        .map((p) => `${p.name}@${p.version} (${p.license})`)
        .join(', ')}`,
    );
  }
  const entries = packages.map((p) => {
    const text = p.texts.length
      ? p.texts.join('\n\n')
      : `Licensed under ${p.license}${p.author ? ` by ${p.author}` : ''}. The package has no ` +
        `licence file; the licence's text is at https://spdx.org/licenses/${p.license}.html`;
    const notices = p.notices.map((n) => `\n\nNOTICE:\n${n}`).join('');
    return `${RULE}\n${p.name} ${p.version}\nLicence: ${p.license}\nSource: ${p.source}\n\n${text}${notices}\n`;
  });
  return `${'='.repeat(78)}\n${title} (${packages.length} packages)\n${'='.repeat(78)}\n\n${entries.join('\n')}`;
}

export const HEADER = `Memora includes open-source software. Thank you to everyone who made it.
Memora itself is released under the MIT licence: https://github.com/dreamtheater484/memora

Below is every package whose code is part of Memora, with its licence. The source of each is
at the address given.

`;

/** Marks where the server's part of the combined file starts. */
export const SERVER_TITLE = 'The server';

const WEB_FILE = path.join(root, 'apps/web/dist/third-party-licenses.txt');
const SERVER_FILE = path.join(root, 'apps/server/dist/third-party-licenses.txt');

/** Node.js's licence, from beside the running binary (the Docker build has it), or a pointer. */
function nodeSection() {
  const file = path.join(path.dirname(process.execPath), '..', 'LICENSE');
  const text =
    existsSync(file) && /Node\.js/.test(readFileSync(file, 'utf8').slice(0, 200))
      ? readFileSync(file, 'utf8').trim()
      : 'Node.js is released under the MIT licence; its full licence, including the software ' +
        'it bundles, is at https://github.com/nodejs/node/blob/main/LICENSE';
  return `${'='.repeat(78)}\nThe runtime: Node.js ${process.version}\n${'='.repeat(78)}\n\n${text}\n`;
}

/** Adds the server's list and Node.js's licence to the web app's file (again, if run twice). */
export function combine(web = WEB_FILE, server = SERVER_FILE) {
  if (!existsSync(web))
    throw new Error(`${path.relative(root, web)} is missing: build the web app`);
  if (!existsSync(server)) {
    throw new Error(`${path.relative(root, server)} is missing: build the server`);
  }
  const current = readFileSync(web, 'utf8');
  const cut = current.indexOf(`${'='.repeat(78)}\n${SERVER_TITLE}`);
  const base = (cut < 0 ? current : current.slice(0, cut)).trimEnd();
  writeFileSync(web, `${base}\n\n${readFileSync(server, 'utf8').trim()}\n\n${nodeSection()}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (process.argv[2] !== 'combine') throw new Error('usage: node scripts/licenses.mjs combine');
    combine();
    console.log(`licenses: ${path.relative(root, WEB_FILE)} lists the web app, server and runtime`);
  } catch (error) {
    console.error(`licenses: ${error.message}`);
    process.exitCode = 1;
  }
}
