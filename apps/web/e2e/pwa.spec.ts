import { expect, test } from '@playwright/test';
import { FakeApi, NOW, expectNoA11yViolations } from './helpers';

/*
 * The installed app (Phase 11): the manifest and its icons, the offline page, and keeping
 * every page on the device. (The prompt for a new version is tested in sync/worker.test.ts.)
 */

test.use({ viewport: { width: 1440, height: 900 } });

test('the manifest names the app and its icons, and every file is there', async ({ page }) => {
  const api = new FakeApi();
  await api.install(page);
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const manifest = (await (await page.request.get(href!)).json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ name: 'Memora', display: 'standalone', start_url: '/' });
  expect(manifest.icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  const files = [
    ...manifest.icons.map((i) => i.src),
    await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'),
    ...(await page
      .locator('link[rel="apple-touch-startup-image"]')
      .evaluateAll((links) => links.map((l) => l.getAttribute('href')))),
    '/offline.html',
  ];
  for (const file of files) {
    const response = await page.request.get(file!);
    expect(response.status(), file!).toBe(200);
  }
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
});

test('the offline page explains, and tries again', async ({ page }) => {
  await page.goto('/offline.html');
  await expect(page.getByRole('heading', { name: 'Memora can’t be reached' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('every page can be kept on this device', async ({ page }) => {
  const api = new FakeApi();
  await api.install(page);
  await page.clock.setFixedTime(NOW);
  // From the notes, which start keeping pages on the device.
  await page.goto('/p/q4');
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Account settings' }).click();
  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'This device' })
    .click();
  await expectNoA11yViolations(page);
  const total = api.notes.tree.pages.length;
  await page.getByRole('switch', { name: 'Keep every page on this device' }).click();
  await expect(page.getByText(`All ${total} pages are kept here.`)).toBeVisible({
    timeout: 15_000,
  });
  const fetched = new Set(
    api.requests
      .filter((r) => r.method === 'GET' && /^\/api\/v1\/pages\/[^/]+$/.test(r.path))
      .map((r) => r.path.split('/').pop()),
  );
  expect(fetched.size).toBe(total);
  // A device setting: still on after a reload.
  await page.goto('/settings/device');
  await expect(page.getByRole('switch', { name: 'Keep every page on this device' })).toBeChecked();
});
