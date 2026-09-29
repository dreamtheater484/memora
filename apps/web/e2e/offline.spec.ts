import { expect, test, type Page } from '@playwright/test';
import { FakeApi } from './helpers';

/*
 * Starting without a connection (§9.6): the service worker has the app, IndexedDB the pages
 * and what waits to be sent. Chromium only, where the fake server's routes still see the
 * requests the service worker leaves alone.
 */

test.use({ serviceWorkers: 'allow', viewport: { width: 1440, height: 900 } });

const editor = (page: Page) => page.getByRole('textbox', { name: 'Page content', exact: true });
const pageState = (page: Page) =>
  page.getByRole('region', { name: 'Editor' }).locator('[data-save-state]');

test('the app starts offline, with the page and the changes not sent yet', async ({
  page,
  context,
}) => {
  const api = new FakeApi();
  await api.install(page);
  await page.goto('/p/q4');
  await expect(editor(page)).toContainText('Boards follow once sync is solid.');
  // The app is kept once the service worker is running.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  api.goDown();
  await context.setOffline(true);
  await page.reload();
  await expect(editor(page)).toContainText('Boards follow once sync is solid.');
  await expect(page.getByRole('status').filter({ hasText: 'You’re offline' })).toBeVisible();

  await editor(page).locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Written offline.');
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'local');
  // Closed and opened again, still offline: the change is still there, and still waiting.
  await page.reload();
  await expect(editor(page)).toContainText('solid. Written offline.');
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'local');

  api.comeBack();
  await context.setOffline(false);
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', { timeout: 20_000 });
  expect(api.notes.content.get('q4')).toBe(
    'Ship the offline outbox first, then polish search.\n\nBoards follow once sync is solid. Written offline.',
  );
});
