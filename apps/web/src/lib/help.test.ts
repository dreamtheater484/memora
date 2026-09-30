import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, HELP } from './help';

/** The repository root, wherever the tests were started from. */
function findRoot(dir = process.cwd()): string {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
  const parent = dirname(dir);
  if (parent === dir) throw new Error('not inside the repository');
  return findRoot(parent);
}
const root = findRoot();

/** GitHub's heading anchors: lower case, spaces to dashes, most punctuation dropped. */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

describe('help links', () => {
  it('point at the guides of this version', () => {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(APP_VERSION).toBe(version);
    for (const url of Object.values(HELP)) expect(url).toContain(`/blob/v${version}/`);
  });

  it('land on files and headings that exist', () => {
    for (const url of Object.values(HELP)) {
      const [path, anchor] = url.split(/\/blob\/v[^/]+\//)[1]!.split('#') as [string, string?];
      const text = readFileSync(join(root, path), 'utf8');
      if (!anchor) continue;
      const anchors = text
        .split('\n')
        .filter((line) => /^#{1,6} /.test(line))
        .map((line) => slug(line.replace(/^#+ /, '')));
      expect(anchors, `${path}#${anchor}`).toContain(anchor);
    }
  });
});
