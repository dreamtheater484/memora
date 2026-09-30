#!/usr/bin/env node
/**
 * Takes the documentation's screenshots (docs/images) from a real Memora:
 *
 *   node scripts/demo/screenshots.mjs [image]      (default memora:local)
 *
 * Starts the image on a Docker network of its own with an empty data folder, fills it with the
 * demo dataset (seed.mjs), photographs it with the pinned Playwright image (visual.mjs), and
 * removes everything again. Needs Docker on Linux, like the visual tests.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const image = process.argv[2] ?? 'memora:local';
const name = 'memora-docs';
const port = 3300;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const quiet = (...args) => spawnSync('docker', args, { stdio: 'ignore' });

const data = mkdtempSync(path.join(tmpdir(), 'memora-docs-'));
const password = `${randomBytes(12).toString('base64url')}-docs`;

function cleanup() {
  quiet('rm', '-f', name);
  quiet('network', 'rm', name);
  rmSync(data, { recursive: true, force: true });
}

try {
  cleanup();
  docker('network', 'create', name);
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--network',
    name,
    '-p',
    `127.0.0.1:${port}:3000`,
    '-e',
    `PUID=${process.getuid()}`,
    '-e',
    `PGID=${process.getgid()}`,
    '-e',
    'TZ=UTC',
    '-v',
    `${data}:/data`,
    image,
  );
  let code;
  for (let i = 0; i < 60 && !code; i += 1) {
    code = /setup code:\s*([A-Z0-9-]+)/.exec(docker('logs', name))?.[1];
    if (!code) spawnSync('sleep', ['1']);
  }
  if (!code) throw new Error('Memora printed no setup code');

  const env = { ...process.env, MEMORA_DEMO_PASSWORD: password };
  const seeded = spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts/demo/seed.mjs'),
      '--url',
      `http://127.0.0.1:${port}`,
      '--setup-code',
      code,
    ],
    { stdio: 'inherit', env },
  );
  if (seeded.status !== 0) throw new Error('seeding failed');

  const shot = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/visual.mjs'), '--config=playwright.docs.config.ts'],
    {
      stdio: 'inherit',
      env: {
        ...env,
        MEMORA_DOCS_URL: `http://${name}:3000`,
        VISUAL_DOCKER_ARGS: `--network ${name} -e MEMORA_DOCS_URL -e MEMORA_DEMO_PASSWORD`,
      },
    },
  );
  if (shot.status !== 0) throw new Error('taking the screenshots failed');
  console.log('Screenshots written to docs/images.');
} catch (error) {
  console.error(`screenshots: ${error.message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
