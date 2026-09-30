#!/usr/bin/env node
// Draws the desktop app's icons from the logo, with Playwright's Chromium, like
// apps/web/scripts/icons.mjs:
//
//   build-resources/icon.png      macOS: 1024 px, the logo inside the margin of Apple's icon
//                                 grid, so it lines up with the other apps in the Dock
//   build-resources/icon-win.png  Windows: 1024 px, a slim margin, as Windows icons have
//                                 (electron-builder makes the .ico from it)
//   build-resources/icons/        Linux: the sizes desktops look for (16 to 512 px), which
//                                 the .deb installs in the icon theme and the AppImage carries
//   build-resources/appx/         the Microsoft Store's tiles
//
//   node scripts/icon.mjs        (needs a Playwright browser, as in scripts/visual.mjs's image)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const INDIGO = '#4f46e5';
const LETTER = 'M16 46V18h6l10 14 10-14h6v28h-6V29l-10 13-10-13v17z';

/** The logo, `size` pixels square, `inset` pixels in from each edge. */
const logo = (size, inset) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <g transform="translate(${inset} ${inset}) scale(${(size - 2 * inset) / 64})">
      <rect width="64" height="64" rx="14" fill="${INDIGO}"/>
      <path d="${LETTER}" fill="#fff"/>
    </g>
  </svg>`;

/** Apple's icon grid: an 824 px shape on a 1024 px canvas. */
const MAC = logo(1024, 100);
/** Windows and Linux icons fill nearly all of their square. */
const slim = (size) => logo(size, Math.round(size * 0.04));
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

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
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
const draw = async (markup, file) => {
  await page.setContent(`<body style="margin:0">${markup}</body>`);
  writeFileSync(
    new URL(`../build-resources/${file}`, import.meta.url),
    await page.locator('svg').screenshot({ omitBackground: true }),
  );
  console.log(`build-resources/${file}`);
};
await draw(MAC, 'icon.png');
await draw(slim(1024), 'icon-win.png');
mkdirSync(new URL('../build-resources/icons/', import.meta.url), { recursive: true });
for (const size of LINUX_SIZES) await draw(slim(size), `icons/${size}x${size}.png`);
mkdirSync(new URL('../build-resources/appx/', import.meta.url), { recursive: true });
for (const [file, width, height] of TILES) await draw(tile(width, height), `appx/${file}`);
await browser.close();
