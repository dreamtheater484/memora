import { describe, expect, it } from 'vitest';
import { scanText } from './check-forbidden.mjs';
import { PATH_RULES, distinctive, isOwnFile } from './check-image.mjs';

describe('image privacy check', () => {
  it('treats what Memora builds as its own, not dependencies or the system', () => {
    expect(isOwnFile('app/apps/web/dist/assets/index.js')).toBe(true);
    expect(isOwnFile('app/apps/server/dist/index.mjs')).toBe(true);
    expect(isOwnFile('app/apps/server/node_modules/.pnpm/x/index.js')).toBe(false);
    expect(isOwnFile('usr/local/bin/node')).toBe(false);
  });

  it('keeps only personal entries long enough not to turn up by chance', () => {
    const list = ['# comment', 'al', 'alice', 'alice.example', 're:ali?ce', ''].join('\n');
    expect(distinctive(list, 5).split('\n')).toEqual([
      '# comment',
      'alice',
      'alice.example',
      're:ali?ce',
      '',
    ]);
  });

  it('finds build-machine paths', () => {
    const path = ['', 'home', 'alice', 'build'].join('/');
    expect(scanText(`at ${path}/x.js`, PATH_RULES).map((f) => f.rule)).toEqual(['unix-home-path']);
    expect(scanText('see /app/apps/web/dist', PATH_RULES)).toEqual([]);
  });
});
