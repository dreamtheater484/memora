#!/usr/bin/env node
/**
 * Runs a dev tool installed at the repository root without needing pnpm/npx on the PATH.
 * Works the same on Windows and Linux, which keeps the git hooks portable.
 *
 *   node scripts/run-bin.mjs <package>[:<bin>] [args...]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [spec, ...args] = process.argv.slice(2);
if (!spec) {
  console.error('usage: node scripts/run-bin.mjs <package>[:<bin>] [args...]');
  process.exit(2);
}

const [packageName, binName = packageName.split('/').pop()] = spec.split(':');
const packageDir = path.join(root, 'node_modules', packageName);
let manifest;
try {
  manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
} catch {
  console.error(`run-bin: ${packageName} is not installed — run "pnpm install" first.`);
  process.exit(2);
}

const binPath = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
if (!binPath) {
  console.error(`run-bin: ${packageName} has no "${binName}" executable.`);
  process.exit(2);
}

const target = path.join(packageDir, binPath);
// Most tools ship a JavaScript entry point; lefthook ships a native binary behind a JS wrapper.
const result = spawnSync(process.execPath, [target, ...args], { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
