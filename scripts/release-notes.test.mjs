import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  absoluteLinks,
  imageTags,
  isPrerelease,
  mismatchedPackages,
  notesFor,
  parseVersion,
} from './release-notes.mjs';

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.1.0] - 2027-01-02

### Added

- Something new.

## [1.0.0] - 2026-12-01

- First.

## [0.5.0]

- No date.

[Unreleased]: https://example.com/compare
[1.1.0]: https://example.com/1.1.0
`;

describe('release notes', () => {
  it('takes one version’s section', () => {
    expect(notesFor(CHANGELOG, '1.1.0')).toBe('### Added\n\n- Something new.\n');
    expect(notesFor(CHANGELOG, '1.0.0')).toBe('- First.\n');
  });

  it('refuses a missing, undated or empty section', () => {
    expect(() => notesFor(CHANGELOG, '2.0.0')).toThrow(/no section/);
    expect(() => notesFor(CHANGELOG, '0.5.0')).toThrow(/needs a date/);
    expect(() =>
      notesFor('## [3.0.0] - 2027-01-01\n\n## [2.0.0] - 2026-01-01\n- x', '3.0.0'),
    ).toThrow(/empty/);
  });

  it('makes links into the repository absolute, at the tag', () => {
    expect(
      absoluteLinks(
        '[plan](docs/PLAN.md), [a](./a.md#b), [web](https://x.org), [top](#top)',
        '1.2.3',
        'o/r',
      ),
    ).toBe(
      '[plan](https://github.com/o/r/blob/v1.2.3/docs/PLAN.md), [a](https://github.com/o/r/blob/v1.2.3/a.md#b), [web](https://x.org), [top](#top)',
    );
    expect(notesFor('## [1.0.0] - 2026-12-01\n\nSee [the plan](docs/PLAN.md).', '1.0.0')).toMatch(
      /\(https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/v1\.0\.0\/docs\/PLAN\.md\)/,
    );
  });

  it('has a section for the version the packages say', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(notesFor(readFileSync('CHANGELOG.md', 'utf8'), version).length).toBeGreaterThan(100);
    expect(mismatchedPackages(version)).toEqual([]);
    expect(mismatchedPackages('99.0.0')).toHaveLength(5);
  });
});

describe('versions', () => {
  it('reads tags and plain versions', () => {
    expect(parseVersion('v0.9.0')).toBe('0.9.0');
    expect(parseVersion('1.0.0-rc.1')).toBe('1.0.0-rc.1');
    expect(() => parseVersion('v1.0')).toThrow();
    expect(() => parseVersion('latest')).toThrow();
  });

  it('tags releases with the minor version and latest, pre-releases alone', () => {
    expect(imageTags('0.9.0')).toEqual(['0.9.0', '0.9', 'latest']);
    expect(imageTags('1.2.3')).toEqual(['1.2.3', '1.2', 'latest']);
    expect(isPrerelease('1.0.0-rc.1')).toBe(true);
    expect(imageTags('1.0.0-rc.1')).toEqual(['1.0.0-rc.1']);
  });
});
