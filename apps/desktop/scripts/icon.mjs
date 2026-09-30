#!/usr/bin/env node
// Draws the desktop app's icon (build-resources/icon.png, 1024 px) from the logo, with
// Playwright's Chromium, like apps/web/scripts/icons.mjs. electron-builder makes the Windows,
// macOS and Linux icons from it. The logo sits inside the margin macOS icons have, so it
// lines up with the other apps in the Dock. Also the Microsoft Store's tiles (appx/).
//
//   node scripts/icon.mjs        (needs a Playwright browser, as in scripts/visual.mjs's image)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const INDIGO = '#4f46e5';
const LETTER = 'M16 46V18h6l10 14 10-14h6v28h-6V29l-10 13-10-13v17z';
const SIZE = 1024;
const INSET = 100; // Apple's icon grid: an 824 px shape on a 1024 px canvas

const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
    <g transform="translate(${INSET} ${INSET}) scale(${(SIZE - 2 * INSET) / 64})">
      <rect width="64" height="64" rx="14" fill="${INDIGO}"/>
      <path d="${LETTER}" fill="#fff"/>
    </g>
  </svg>`;

/** The Microsoft Store's tiles (build-resources/appx): the letter on the brand colour. */
const TILES = [
  ['StoreLogo.png', 50, 50],
  ['Square44x44Logo.png', 44, 44],
  ['Square150x150Logo.png', 150, 150],
  ['Wide310x150Logo.png', 310, 150],
];
const tile = (width, height) => {
  const letter = Math.min(width, height) * 0.7;
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="${INDIGO}"/>
    <g transform="translate(${(width - letter) / 2} ${(height - letter) / 2}) scale(${letter / 64})">
      <path d="${LETTER}" fill="#fff"/>
    </g>
  </svg>`;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
const draw = async (markup, file) => {
  await page.setContent(`<body style="margin:0">${markup}</body>`);
  writeFileSync(
    new URL(`../build-resources/${file}`, import.meta.url),
    await page.locator('svg').screenshot({ omitBackground: true }),
  );
  console.log(`build-resources/${file}`);
};
await draw(svg, 'icon.png');
mkdirSync(new URL('../build-resources/appx/', import.meta.url), { recursive: true });
for (const [file, width, height] of TILES) await draw(tile(width, height), `appx/${file}`);
await browser.close();
