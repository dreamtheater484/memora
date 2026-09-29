// Inlines the Lucide icons that directions.html uses as an SVG sprite, so the
// mockup is self-contained. Re-run after using a new icon name:
//   node design/mockups/build-icons.mjs
// Needs the `lucide` package (ISC licence), e.g. `pnpm dlx` or a temp install;
// pass the path to its UMD build as the first argument.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, 'directions.html');
const lucidePath = process.argv[2];
if (!lucidePath) {
  console.error('Usage: node design/mockups/build-icons.mjs <path-to-lucide.min.js>');
  process.exit(1);
}

const { icons } = createRequire(import.meta.url)(lucidePath);
const html = readFileSync(htmlPath, 'utf8');

const pascal = (n) => n.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());

// Icon names are also passed around in data (e.g. `icon: 'cloud-off'`), so take
// every quoted kebab-case token in the script that is a Lucide icon, plus every
// literal ic('…') and #i-… reference (those must exist).
const script = html.slice(html.indexOf('<script>'));
const names = new Set();
for (const m of script.matchAll(/'([a-z][a-z0-9-]*)'/g)) if (icons[pascal(m[1])]) names.add(m[1]);
for (const m of html.matchAll(/\bic\(\s*'([a-z0-9-]+)'/g)) names.add(m[1]);
for (const m of html.matchAll(/#i-([a-z0-9-]+)/g)) names.add(m[1]);
const attr = (o) =>
  Object.entries(o)
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join('');

const missing = [];
const symbols = [...names].sort().map((name) => {
  const node = icons[pascal(name)];
  if (!node) {
    missing.push(name);
    return '';
  }
  const body = node.map(([tag, a]) => `<${tag}${attr(a)}/>`).join('');
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`;
});
if (missing.length) {
  console.error(`Unknown Lucide icons: ${missing.join(', ')}`);
  process.exit(1);
}

const sprite = `<!--icons:start--><svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true"><!-- Lucide icons, ISC licence --> ${symbols.join('')}</svg><!--icons:end-->`;
const out = html.replace(/<!--icons:start-->[\s\S]*?<!--icons:end-->/, sprite);
if (out === html && !html.includes(sprite)) {
  console.error('Marker <!--icons:start--><!--icons:end--> not found');
  process.exit(1);
}
writeFileSync(htmlPath, out);
console.log(`Inlined ${names.size} icons`);
