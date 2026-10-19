#!/usr/bin/env node
/**
 * Release notes for one version, taken from CHANGELOG.md, and the checks a release needs.
 *
 *   node scripts/release-notes.mjs 0.9.0            print the notes of 0.9.0
 *   node scripts/release-notes.mjs v0.9.0 --check   also check the version is the packages'
 *
 * Fails when the version has no section, when the section is empty or undated, or (with
 * --check) when a package.json says another version: a tag must release what it names. With
 * --check, it also fails when the Android app can't number the version (androidVersionCode).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = [
  'package.json',
  'apps/server/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'packages/shared/package.json',
];

const REPO = process.env.GITHUB_REPOSITORY || 'dreamtheater484/memora';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** `v1.2.3` or `1.2.3` → `1.2.3`; throws on anything else. */
export function parseVersion(input) {
  const version = String(input).replace(/^v/, '');
  if (!SEMVER.test(version)) throw new Error(`"${input}" is not a version like 1.2.3`);
  return version;
}

export const isPrerelease = (version) => SEMVER.exec(version)?.[4] !== undefined;

/**
 * The Android app's versionCode for a version: MAJOR × 10,000,000 + MINOR × 10,000 + PATCH × 10,
 * plus 9 for a release, or N − 1 for its candidate `-rc.N`. Android installs an APK over another
 * only with a higher code, so it rises with every version, and a release comes after its
 * candidates (docs/RELEASING.md). apps/android/app/build.gradle.kts has the same rule; the
 * Android workflow checks the APKs agree with this one.
 */
export function androidVersionCode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.([1-9]))?$/.exec(version);
  if (!match) {
    throw new Error(`Android can't number ${version}: a pre-release must be -rc.1 to -rc.9`);
  }
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (major > 209 || minor > 999 || patch > 999) {
    throw new Error(`Android can't number ${version}: at most 209.999.999`);
  }
  return major * 10_000_000 + minor * 10_000 + patch * 10 + (match[4] ? Number(match[4]) - 1 : 9);
}

/** The image tags a version gets: 1.2.3 and 1.2, plus `latest` unless it is a pre-release. */
export function imageTags(version) {
  const [, major, minor] = SEMVER.exec(version) ?? [];
  return isPrerelease(version) ? [version] : [version, `${major}.${minor}`, 'latest'];
}

/**
 * Relative links (into the repository, as CHANGELOG.md has them) made absolute at the
 * release's tag: on a release page they would lead nowhere.
 */
export function absoluteLinks(markdown, version, repo = REPO) {
  return markdown.replace(
    /\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)\)/gi,
    (_, target) => `](https://github.com/${repo}/blob/v${version}/${target.replace(/^\.\//, '')})`,
  );
}

/** The body of `## [version] - date`, up to the next `## ` heading or the link list. */
export function notesFor(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`);
  if (!/^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}$/.test(lines[start])) {
    throw new Error(
      `CHANGELOG.md: the ${version} heading needs a date: "## [${version}] - YYYY-MM-DD"`,
    );
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## ') || /^\[[^\]]+\]: /.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md: the ${version} section is empty`);
  return `${absoluteLinks(body, version)}\n`;
}

/** Package files whose version isn't `version`. */
export function mismatchedPackages(
  version,
  read = (file) => readFileSync(path.join(root, file), 'utf8'),
) {
  return PACKAGES.filter((file) => JSON.parse(read(file)).version !== version);
}

function main(argv) {
  const [input, ...flags] = argv;
  if (!input) {
    console.error('Usage: node scripts/release-notes.mjs <version> [--check]');
    return 2;
  }
  try {
    const version = parseVersion(input);
    if (flags.includes('--check')) {
      const wrong = mismatchedPackages(version);
      if (wrong.length) throw new Error(`not version ${version}: ${wrong.join(', ')}`);
      androidVersionCode(version);
    }
    process.stdout.write(notesFor(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version));
    return 0;
  } catch (error) {
    console.error(`release-notes: ${error.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
