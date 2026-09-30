#!/usr/bin/env node
// Runs the Playwright tests (visual snapshots and accessibility) inside the
// pinned Playwright image, so screenshots match CI pixel for pixel.
//
//   node scripts/visual.mjs                      run all tests
//   node scripts/visual.mjs --update-snapshots   accept new or changed screenshots
//   node scripts/visual.mjs -g "gallery"         any other Playwright arguments
//
// VISUAL_DOCKER_ARGS adds arguments for `docker run` (the documentation's screenshots use it
// to join the network of the Memora they photograph: scripts/demo/screenshots.mjs).
//
// Needs Docker on a Linux host (or WSL). The repository is mounted at the same
// path inside the container, so node_modules installed on the host work as is.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');

const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
const version = pkg.devDependencies['@playwright/test'];
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`@playwright/test must be pinned to an exact version (found "${version}").`);
  process.exit(1);
}
const image = `mcr.microsoft.com/playwright:v${version}-noble`;

if (process.platform !== 'linux') {
  console.error(
    'The visual tests run in Docker on Linux (or WSL). On other systems, let CI run them.',
  );
  process.exit(1);
}

const args = [
  'run',
  '--rm',
  '--init',
  '--ipc=host',
  '--user',
  `${process.getuid()}:${process.getgid()}`,
  '-e',
  'HOME=/tmp',
  '-v',
  `${root}:${root}`,
  '-w',
  web,
  ...(process.env.VISUAL_DOCKER_ARGS ?? '').split(' ').filter(Boolean),
  image,
  'sh',
  '-c',
  'PATH="$PWD/node_modules/.bin:$PATH" exec playwright test "$@"',
  'playwright',
  ...process.argv.slice(2),
];

console.log(`Running Playwright ${version} in ${image}`);
const result = spawnSync('docker', args, { stdio: 'inherit' });
if (result.error) {
  console.error(`Could not start Docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
