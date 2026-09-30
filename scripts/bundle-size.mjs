#!/usr/bin/env node
// Checks the web app's initial JavaScript against the budget of the plan (§14): what
// index.html loads before anything else (its script and the modules it preloads), gzipped.
// Run it after `pnpm build`:
//
//   node scripts/bundle-size.mjs
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 300;
const dist = new URL('../apps/web/dist/', import.meta.url);

let html;
try {
  html = readFileSync(new URL('index.html', dist), 'utf8');
} catch {
  console.error('apps/web/dist/index.html is missing: build the web app first (pnpm build).');
  process.exit(1);
}

const size = (file) => gzipSync(readFileSync(new URL(file, dist)), { level: 9 }).length;
const kb = (bytes) => (bytes / 1024).toFixed(1);

// Only what the page itself names is loaded up front; everything else comes on demand.
const files = [...new Set([...html.matchAll(/"\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
let total = 0;
for (const file of js) {
  const bytes = size(file);
  total += bytes;
  console.log(`${kb(bytes).padStart(8)} KB  ${file}`);
}
for (const file of css) console.log(`${kb(size(file)).padStart(8)} KB  ${file} (styles)`);
console.log(`Initial JavaScript: ${kb(total)} KB gzipped (budget ${BUDGET_KB} KB).`);
if (!js.length) {
  console.error('No scripts found in index.html.');
  process.exit(1);
}
if (total > BUDGET_KB * 1024) {
  console.error('Over budget: load more of it on demand (see §14 of the plan).');
  process.exit(1);
}
