import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The dev entry (src/*.ts) and the production bundle (dist/server.mjs) both sit one level below
// the package root, so these paths resolve the same way in both. The Docker image keeps that layout.
const here = dirname(fileURLToPath(import.meta.url));

export const packageRoot = resolve(here, '..');
export const migrationsDir = resolve(packageRoot, 'drizzle');
export const defaultWebDir = resolve(packageRoot, '../web/dist');
