#!/usr/bin/env node
// Type-checks every workspace project with the root TypeScript install.
import { spawnSync } from 'node:child_process';

// The web app's second project covers the browser tests, the service worker and the configs.
const projects = ['packages/shared', 'apps/server', 'apps/web', 'apps/web/tsconfig.node.json'];
let failed = false;
for (const project of projects) {
  const result = spawnSync(
    process.execPath,
    ['scripts/run-bin.mjs', 'typescript:tsc', '-p', project],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
