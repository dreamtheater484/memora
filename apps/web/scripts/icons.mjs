#!/usr/bin/env node
// Draws the app's icons and iOS splash screens (PNG) from the logo, with Playwright's
// Chromium, into public/. Run it from apps/web after changing the logo:
//
//   node scripts/icons.mjs
//
// It needs a Playwright browser (the image `scripts/visual.mjs` uses has one). index.html
// lists the splash screens by size.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const INDIGO = '#4f46e5';
const LETTER = 'M16 46V18h6l10 14 10-14h6v28h-6V29l-10 13-10-13v17z';
const out = new URL('../public/', import.meta.url);

/** The logo on a square: rounded like the favicon, or full-bleed (iOS and Android mask it). */
const logo = (size, { rounded, inset }) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
    <rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="${INDIGO}"/>
    <g transform="translate(${32 - 32 * inset} ${32 - 32 * inset}) scale(${inset})">
      <path d="${LETTER}" fill="#fff"/>
    </g>
  </svg>`;

const ICONS = [
  { file: 'icon-192.png', size: 192, rounded: true, inset: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, inset: 1 },
  // Maskable: the letter within the middle 80 %, the colour to the edges.
  { file: 'icon-maskable-512.png', size: 512, rounded: false, inset: 0.78 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, inset: 0.86 },
];

// Portrait splash screens for common iPhones and iPads: [CSS width, height, pixel ratio].
const SPLASH = [
  [390, 844, 3],
  [393, 852, 3],
  [430, 932, 3],
  [375, 667, 2],
  [820, 1180, 2],
  [1024, 1366, 2],
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(`<body style="margin:0">${logo(icon.size, icon)}</body>`);
  writeFileSync(
    new URL(icon.file, out),
    await page.locator('svg').screenshot({ omitBackground: true }),
  );
  console.log(icon.file);
}

for (const [width, height, ratio] of SPLASH) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: ratio,
  });
  const splash = await context.newPage();
  await splash.setContent(`
    <body style="margin:0;height:100vh;display:grid;place-items:center;background:#f6f6fb">
      ${logo(112, { rounded: true, inset: 1 })}
    </body>`);
  const file = `splash-${width * ratio}x${height * ratio}.png`;
  writeFileSync(new URL(file, out), await splash.screenshot());
  console.log(file);
  await context.close();
}

await browser.close();
