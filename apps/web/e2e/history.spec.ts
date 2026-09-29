import { expect, test, type Page } from '@playwright/test';
import { FakeApi, NOW, expectNoA11yViolations, fontsReady } from './helpers';

/*
 * Version history, the recycle bin and backups (Phase 7, §9.7, §9.14): reading, comparing,
 * naming and restoring versions; bringing deleted things back or deleting them for good;
 * backing up and restoring; and browsers dropping what they kept after a restore.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const FIRST = 'Ship the offline outbox first.\n\nBoards follow.';
const SECOND = 'Ship the offline outbox first, then polish search.\n\nBoards follow.';
const NOW_TEXT =
  'Ship the offline outbox first, then polish search.\n\nBoards follow once sync is solid.';

async function open(page: Page, path: string, api = new FakeApi()) {
  await api.install(page);
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
  await fontsReady(page);
  return api;
}

/** The editor's text; null while the page reloads. */
const editorText = (page: Page) =>
  page
    .evaluate(() =>
      Array.from(
        document.querySelectorAll('section[aria-label="Editor"] .cm-content .cm-line'),
        (line) => line.textContent ?? '',
      ).join('\n'),
    )
    .catch(() => null);

function withHistory(api = new FakeApi()) {
  api.notes.keep('q4', FIRST, 'manual', { name: 'First plan', ago: 2 * DAY });
  api.notes.keep('q4', SECOND, 'auto', { ago: 3 * HOUR });
  return api;
}

async function openHistory(page: Page) {
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'History' }).click();
  const dialog = page.getByRole('dialog', { name: 'Version history' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('version history', () => {
  test('lists versions by day, shows what changed and restores one', async ({ page }) => {
    const api = await open(page, '/p/q4', withHistory());
    await expect.poll(() => editorText(page)).toBe(NOW_TEXT);
    const dialog = await openHistory(page);
    const versions = dialog.getByRole('navigation', { name: 'Versions' });
    await expect(versions.getByRole('heading')).toHaveText(['Today', 'Sunday, September 27, 2026']);
    await expect(versions.getByRole('button')).toHaveCount(2);

    // The newest is open: what changed since the one before.
    await expect(dialog.getByRole('heading', { name: 'Edited' })).toBeVisible();
    const changes = dialog.getByRole('list', { name: 'Changes' });
    await expect(changes.locator('ins')).toHaveText([', then polish search']);
    await expect(changes.locator('del')).toHaveCount(0);
    await expect(dialog).toHaveScreenshot('history-dialog.png');

    // Compared with the page now: the last line changed since.
    await dialog.getByRole('radio', { name: 'Compare with now' }).click();
    await expect(changes.locator('ins')).toHaveText([' once sync is solid']);

    // The page as the version has it.
    await dialog.getByRole('radio', { name: 'Version', exact: true }).click();
    await expect(dialog.locator('.version-view')).toContainText('then polish search');

    // Restore the named one; the page as it was is kept first.
    await versions.getByRole('button', { name: /First plan/ }).click();
    await expect(dialog.getByRole('heading', { name: 'First plan' })).toBeVisible();
    await expectNoA11yViolations(page);
    await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText('Version restored', { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect.poll(() => editorText(page)).toBe(FIRST);
    expect(api.notes.content.get('q4')).toBe(FIRST);
    expect(api.notes.versions.at(-1)).toMatchObject({ reason: 'restore', content: NOW_TEXT });

    // …so the restore can be undone from the history.
    const again = await openHistory(page);
    await expect(
      again.getByRole('navigation', { name: 'Versions' }).getByRole('button').first(),
    ).toContainText('Before restoring');
  });

  test('saves a named version, renames it and restores it as a copy', async ({ page }) => {
    const api = await open(page, '/p/q4');
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: 'Save version…' }).click();
    const save = page.getByRole('dialog', { name: 'Save version' });
    await save.getByLabel('Name (optional)').fill('Before the review');
    await save.getByRole('button', { name: 'Save version' }).click();
    await expect(page.getByText('Version saved', { exact: true })).toBeVisible();
    expect(api.notes.versions).toEqual([
      expect.objectContaining({ pageId: 'q4', name: 'Before the review', content: NOW_TEXT }),
    ]);

    const dialog = await openHistory(page);
    await expect(dialog.getByRole('heading', { name: 'Before the review' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Rename' }).click();
    await dialog.getByLabel('Version name').fill('Sent to the team');
    await dialog.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog.getByRole('heading', { name: 'Sent to the team' })).toBeVisible();
    expect(api.notes.versions[0]!.name).toBe('Sent to the team');

    await dialog.getByRole('button', { name: 'Restore as copy' }).click();
    await expect(page.getByText('Restored as a new page', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Q4 roadmap (2026-09-29 16:00)',
    );
    await expect.poll(() => editorText(page)).toBe(NOW_TEXT);
  });

  test('the inspector shows the latest versions and opens one', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, '/p/q4', withHistory());
    const inspector = page.getByRole('complementary', { name: 'Page details' });
    await expect(inspector.getByRole('button', { name: /First plan/ })).toBeVisible();
    await inspector.getByRole('button', { name: /First plan/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Version history' });
    await expect(dialog.getByRole('heading', { name: 'First plan' })).toBeVisible();
  });
});

test.describe('the recycle bin', () => {
  test('restores, restores elsewhere, deletes for good and empties', async ({ page }) => {
    const api = new FakeApi();
    // A page deleted from a section that went afterwards, and a page on its own.
    api.notes.respond('POST', '/api/v1/pages/delete', { ids: ['comp'] });
    api.notes.respond('DELETE', '/api/v1/sections/research', {});
    api.notes.respond('POST', '/api/v1/pages/delete', { ids: ['openq'] });
    await open(page, '/p/q4', api);

    await page.getByRole('navigation', { name: 'Navigation' }).getByText('Recycle bin').click();
    await expect(page).toHaveURL(/\/trash$/);
    const list = page.getByRole('list', { name: 'Deleted items' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list.getByRole('listitem').first()).toContainText(
      'Open questions in Work › Roadmap',
    );
    await expect(page.getByRole('main')).toHaveScreenshot('recycle-bin.png');
    await expectNoA11yViolations(page);

    // Back where it was.
    const openq = list.getByRole('listitem').filter({ hasText: 'Open questions' });
    await openq.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Restored “Open questions”', { exact: true })).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    expect(api.notes.tree.pages.some((p) => p.id === 'openq')).toBe(true);

    // Its section is gone too: restore it to another one.
    const comp = list.getByRole('listitem').filter({ hasText: 'Competitor notes' });
    await expect(comp).toContainText('in Work › Research');
    await comp.getByRole('button', { name: 'Restore to…' }).click();
    const to = page.getByRole('dialog', { name: 'Restore “Competitor notes” to…' });
    await to.getByText('Inbox', { exact: true }).click();
    await to.getByRole('button', { name: 'Restore here' }).click();
    await expect(
      page.getByText('Restored “Competitor notes” to Inbox', { exact: true }),
    ).toBeVisible();
    expect(api.notes.tree.pages.find((p) => p.id === 'comp')?.sectionId).toBe('inbox');

    // Filter, then delete the section for good.
    await page.getByRole('radio', { name: 'Sections' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await list.getByRole('button', { name: 'More for “Research”' }).click();
    await page.getByRole('menuitem', { name: 'Delete for good' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete for good?' });
    await confirm.getByRole('button', { name: 'Delete for good' }).click();
    await expect(page.getByRole('heading', { name: 'The recycle bin is empty' })).toBeVisible();
    expect(api.notes.trash).toEqual([]);
  });

  test('empties the bin after asking', async ({ page }) => {
    const api = new FakeApi();
    api.notes.respond('POST', '/api/v1/pages/delete', { ids: ['openq', 'retro'] });
    await open(page, '/trash', api);
    await expect(
      page.getByRole('list', { name: 'Deleted items' }).getByRole('listitem'),
    ).toHaveCount(2);
    await page.getByRole('button', { name: 'Empty recycle bin' }).click();
    await page
      .getByRole('dialog', { name: 'Empty the recycle bin?' })
      .getByRole('button', { name: 'Empty the recycle bin' })
      .click();
    await expect(page.getByRole('heading', { name: 'The recycle bin is empty' })).toBeVisible();
  });
});

test.describe('backups', () => {
  test('shows the schedule, backs up now and restores, then reloads', async ({ page }) => {
    const api = await open(page, '/settings/backups');
    await expect(page.getByRole('region', { name: 'Backups', exact: true })).toContainText(
      '0 3 * * *',
    );
    const list = page.getByRole('list', { name: 'Backups' });
    await expect(list.getByRole('listitem')).toHaveCount(5);
    await expectNoA11yViolations(page);

    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByText('Backup made', { exact: true })).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(6);
    await expect(list.getByRole('listitem').first()).toContainText('Made by hand');

    await list.getByRole('listitem').nth(2).getByRole('button', { name: 'Restore…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Restore this backup?' });
    await expect(dialog).toContainText('backed up first');
    await dialog.getByRole('button', { name: 'Restore and restart' }).click();
    await expect(page.getByText('Memora is restarting…')).toBeVisible();
    expect(api.requests.some((r) => r.method === 'POST' && r.path.endsWith('/restore'))).toBe(true);
    // When Memora answers again, the app starts afresh.
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Editor' })).toBeVisible();
  });

  test('deletes a backup', async ({ page }) => {
    await open(page, '/settings/backups');
    const list = page.getByRole('list', { name: 'Backups' });
    await expect(list.getByRole('listitem')).toHaveCount(5);
    await list.getByRole('button', { name: 'More' }).last().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete this backup?' })
      .getByRole('button', { name: 'Delete backup' })
      .click();
    await expect(list.getByRole('listitem')).toHaveCount(4);
  });
});

test('after a restore, browsers show the restored pages, not what they kept', async ({ page }) => {
  const api = await open(page, '/p/drn');
  await expect.poll(() => editorText(page)).toBe('Offline badge stays until the outbox is empty.');
  // The server goes back to a backup: same revision, older text, and new data.
  api.notes.content.set('drn', 'The text from the backup.');
  api.restored('data-2');
  await expect.poll(() => editorText(page), { timeout: 15_000 }).toBe('The text from the backup.');
});
