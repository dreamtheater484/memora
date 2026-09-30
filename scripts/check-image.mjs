#!/usr/bin/env node
/**
 * Privacy check of a built Docker image (plan §6.3), before a release and in CI:
 *
 *   node scripts/check-image.mjs memora:local
 *
 * - The image's history (the build commands) and its labels and environment: every rule.
 * - Memora's own files in the image (`/app` outside `node_modules`): the path rules, so a
 *   build-machine path baked in by the bundler is caught everywhere, CI included.
 * - Every file in the image, binaries included: the personal strings of
 *   `.forbidden-strings.local`, when that file exists (it never does in CI). Third-party code
 *   legitimately holds example addresses and authors' emails, so only personal strings count.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  GENERIC_RULES,
  PERSONAL_LIST_FILE,
  parsePersonalList,
  scanText,
} from './check-forbidden.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Personal entries shorter than this are left out: an image holds megabytes of binaries,
 * fonts and minified code, where a few letters of a first name turn up by chance.
 * The leaks that matter (paths, an email address, a full name, an address) are longer, and the
 * path rules catch a home directory whatever its user name.
 */
export const MIN_PERSONAL_LENGTH = Number(process.env.MEMORA_IMAGE_MIN_PERSONAL ?? 5);

/** The personal list without its short plain entries (regular expressions always count). */
export const distinctive = (list, min = MIN_PERSONAL_LENGTH) =>
  list
    .split(/\r?\n/)
    .filter((line) => {
      const entry = line.trim();
      return !entry || entry.startsWith('#') || entry.startsWith('re:') || entry.length >= min;
    })
    .join('\n');

/** Rules for absolute paths of a build machine. */
export const PATH_RULES = GENERIC_RULES.filter((rule) =>
  ['unix-home-path', 'windows-user-path', 'wsl-user-path', 'removable-media-path'].includes(
    rule.id,
  ),
);

/** Memora's own files: what we build and copy, not dependencies or the operating system. */
export const isOwnFile = (relative) =>
  relative.startsWith('app/') && !relative.split('/').includes('node_modules');

function* walk(dir, base = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, base);
    else if (entry.isFile()) yield path.relative(base, full).split(path.sep).join('/');
  }
}

const docker = (args) =>
  execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function main(argv) {
  const image = argv[0];
  if (!image) {
    console.error('Usage: node scripts/check-image.mjs <image>');
    return 2;
  }
  const personalFile = path.join(root, PERSONAL_LIST_FILE);
  const personal = existsSync(personalFile)
    ? parsePersonalList(distinctive(readFileSync(personalFile, 'utf8')))
    : [];
  const problems = [];
  const report = (where, findings) => {
    for (const f of findings) problems.push({ where, ...f });
  };

  // What the image says about how it was built.
  const history = docker(['history', '--no-trunc', '--format', '{{.CreatedBy}}', image]);
  report('image history', scanText(history, [...GENERIC_RULES, ...personal]));
  const config = docker([
    'image',
    'inspect',
    '--format',
    '{{json .Config.Labels}} {{json .Config.Env}}',
    image,
  ]);
  report('image labels and environment', scanText(config, [...PATH_RULES, ...personal]));

  // Every file in it.
  const dir = mkdtempSync(path.join(tmpdir(), 'memora-image-'));
  const container = docker(['create', image]).trim();
  let files = 0;
  try {
    const exported = spawnSync(
      'sh',
      [
        '-c',
        'docker export "$1" | tar -x -C "$2" --no-same-owner --no-same-permissions --exclude=dev/* --exclude=proc/* --exclude=sys/*',
        'export',
        container,
        dir,
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    if (exported.status !== 0) throw new Error('could not export the image');
    for (const relative of walk(dir)) {
      const full = path.join(dir, relative);
      if (lstatSync(full).size === 0) continue;
      files += 1;
      const rules = [...(isOwnFile(relative) ? PATH_RULES : []), ...personal];
      if (rules.length === 0) continue;
      // latin1 keeps every byte, so strings inside binaries are found too.
      const text = readFileSync(full).toString('latin1');
      report(relative, scanText(relative, rules));
      report(relative, scanText(text, rules));
    }
  } finally {
    docker(['rm', container]);
    rmSync(dir, { recursive: true, force: true });
  }

  if (problems.length) {
    console.error(`\n✖ ${image} holds personal information or build-machine paths:\n`);
    for (const p of problems) {
      const shown = process.env.CI ? `${p.match.slice(0, 2)}…` : p.match;
      console.error(`  ${p.where}:${p.line}  ${p.rule}: ${p.description}  →  "${shown}"`);
    }
    return 1;
  }
  console.log(
    `image privacy check: ${image} is clean (${files} files${personal.length ? ', personal strings included' : `; no ${PERSONAL_LIST_FILE}, so personal strings were not checked`}).`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
