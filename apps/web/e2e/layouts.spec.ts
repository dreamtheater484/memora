import { expect, test, type Page } from '@playwright/test';
import { FakeApi, NOW, fontsReady, openShell } from './helpers';

/*
 * Every screen size and display scaling (Phase 11, §9.12): 5120×1440, 4K, 1440p, 1080p,
 * laptops, tablets and phones, at 100 % to 200 % (a 4K screen at 200 % lays out like 1080p at
 * twice the pixels). Each keeps to the window, with the columns its breakpoint promises.
 */

type Layout = 'phone' | 'tablet' | 'desktop' | 'wide' | 'ultra';

// Physical screens, and the CSS size each has at a given OS scaling.
const SCREENS: { name: string; width: number; height: number; scales: number[] }[] = [
  { name: 'DQHD 5120×1440', width: 5120, height: 1440, scales: [1, 1.25, 1.5, 2] },
  { name: '4K 3840×2160', width: 3840, height: 2160, scales: [1, 1.5, 2] },
  { name: '1440p', width: 2560, height: 1440, scales: [1, 1.25] },
  { name: '1080p', width: 1920, height: 1080, scales: [1, 1.25, 1.5] },
  { name: 'laptop 1366×768', width: 1366, height: 768, scales: [1] },
  { name: 'tablet 820×1180', width: 820, height: 1180, scales: [1] },
  { name: 'phone 390×844', width: 390, height: 844, scales: [1] },
];

function layoutFor(cssWidth: number): Layout {
  if (cssWidth >= 3200) return 'ultra';
  if (cssWidth >= 1920) return 'wide';
  if (cssWidth >= 1024) return 'desktop';
  if (cssWidth >= 640) return 'tablet';
  return 'phone';
}

async function expectLayout(page: Page, layout: Layout) {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const sidebar = page.getByRole('navigation', { name: 'Navigation' });
  const inspector = page.getByRole('complementary', { name: 'Page details' });
  await expect(page.getByRole('main')).toBeVisible();
  await expect(nav).toBeVisible({ visible: layout === 'phone' });
  await expect(sidebar).toBeVisible({ visible: layout !== 'phone' && layout !== 'tablet' });
  await expect(inspector).toBeVisible({ visible: layout === 'wide' || layout === 'ultra' });
  await expect(page.getByRole('region', { name: 'Pane 2', exact: true })).toBeVisible({
    visible: layout === 'ultra',
  });
  // Nothing wider than the window: no sideways scrolling of the page itself.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const screen of SCREENS) {
  for (const scale of screen.scales) {
    const width = Math.round(screen.width / scale);
    const height = Math.round(screen.height / scale);
    const layout = layoutFor(width);
    test(`${screen.name} at ${scale * 100} %: ${layout} (${width}×${height} CSS pixels)`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: scale,
        reducedMotion: 'reduce',
        locale: 'en-US',
        timezoneId: 'UTC',
        serviceWorkers: 'block',
        ...(layout === 'phone' ? { hasTouch: true, isMobile: true } : {}),
      });
      const page = await context.newPage();
      const api = new FakeApi();
      await api.install(page);
      await page.clock.setFixedTime(NOW);
      await page.goto('/p/q4');
      await fontsReady(page);
      await expectLayout(page, layout);
      await context.close();
    });
  }
}

test('browser zoom at 200 % on 1080p lays out like a laptop', async ({ page }) => {
  // Zooming in shrinks the CSS width the same way display scaling does.
  await page.setViewportSize({ width: 960, height: 540 });
  await openShell(page, 'light');
  await expectLayout(page, 'tablet');
});

// Screenshots of the breakpoints the shell tests don't already take.
test('shell on a tablet (820×1180), light', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openShell(page, 'light');
  await expect(page).toHaveScreenshot('tablet-light.png');
});

test('shell on 4K (3840×2160), dark', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await openShell(page, 'dark');
  await expect(page.getByRole('region', { name: 'Pane 3', exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('4k-dark.png');
});
