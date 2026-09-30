import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { allowed, combine, packageDirOf, section, SERVER_TITLE } from './licenses.mjs';

const work = mkdtempSync(path.join(tmpdir(), 'memora-licenses-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A package in a fake node_modules, with a licence file unless `text` is null. */
function pkg(name, license, text = `${license} licence text of ${name}`, extra = {}) {
  const dir = path.join(work, 'node_modules', name);
  mkdirSync(path.join(dir, 'lib'), { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', license, ...extra }),
  );
  // A nested package.json without a name, as some packages have for their module type.
  writeFileSync(path.join(dir, 'lib', 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(dir, 'lib', 'index.js'), '');
  if (text !== null) writeFileSync(path.join(dir, 'LICENSE'), text);
  return dir;
}

describe('licences', () => {
  it('accepts permissive licences, and expressions with one', () => {
    expect(allowed('MIT')).toBe(true);
    expect(allowed('(MIT OR GPL-3.0-or-later)')).toBe(true);
    expect(allowed('(MIT AND Zlib)')).toBe(true);
    expect(allowed('GPL-3.0-only')).toBe(false);
    expect(allowed('(MIT AND GPL-3.0-only)')).toBe(false);
    expect(allowed('UNKNOWN')).toBe(false);
  });

  it('finds the package a bundled file comes from', () => {
    const dir = pkg('@scope/thing', 'MIT');
    expect(packageDirOf(path.join(dir, 'lib', 'index.js'))).toBe(dir);
    expect(packageDirOf(`\0${path.join(dir, 'lib', 'index.js')}?commonjs-proxy`)).toBe(dir);
    expect(packageDirOf(path.join(work, 'src', 'app.ts'))).toBeNull();
  });

  it('lists each package once, with its licence text and source', () => {
    const a = pkg('alpha', 'MIT', 'Copyright (c) Alpha', { repository: 'github:someone/alpha' });
    const b = pkg('beta', 'ISC', null, { author: 'Beta Author <beta@example.com>' });
    const text = section('The app', [b, a, a]);
    expect(text).toContain('The app (2 packages)');
    expect(text.indexOf('alpha 1.0.0')).toBeLessThan(text.indexOf('beta 1.0.0'));
    expect(text).toContain('Source: https://github.com/someone/alpha');
    expect(text).toContain('Copyright (c) Alpha');
    // No licence file: the standard text of the licence it names, with its author.
    expect(text).toContain('ISC License\n\nCopyright (c) Beta Author');
    expect(text).toContain('ships no licence file');
    expect(text).not.toContain('beta@example.com');
  });

  it('notes where Shiki’s grammars come from', () => {
    const langs = pkg('@shikijs/langs', 'MIT');
    expect(section('The app', [langs])).toContain('NOTE: The language grammars');
  });

  it('stops at a licence that is not on the list', () => {
    const c = pkg('gamma', 'GPL-3.0-only');
    expect(() => section('The app', [c])).toThrow(/gamma@1\.0\.0 \(GPL-3\.0-only\)/);
  });

  it('combines the lists, the same when run again', () => {
    const web = path.join(work, 'web.txt');
    const server = path.join(work, 'server.txt');
    writeFileSync(web, 'header\n\nweb list\n');
    writeFileSync(server, `${'='.repeat(78)}\n${SERVER_TITLE} (1 packages)\n\nserver list\n`);
    combine(web, server, 'Debian test');
    combine(web, server, 'Debian test');
    const text = readFileSync(web, 'utf8');
    expect(text.match(/server list/g)).toHaveLength(1);
    expect(text.match(/The base system: Debian test/g)).toHaveLength(1);
    expect(text).toMatch(/^header\n\nweb list\n\n=+\nThe server/);
    expect(text).toContain('The runtime: Node.js');
  });
});
