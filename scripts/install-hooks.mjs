#!/usr/bin/env node
// Installs the git hooks (lefthook) after `pnpm install` — only in a git checkout, never in CI or Docker builds.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.CI || !existsSync('.git')) {
  process.exit(0);
}

const result = spawnSync(process.execPath, ['scripts/run-bin.mjs', 'lefthook', 'install'], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
