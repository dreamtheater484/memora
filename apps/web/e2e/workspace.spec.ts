import { expect, test, type Page } from '@playwright/test';
import { FakeApi, NOW, expectNoA11yViolations, fontsReady } from './helpers';

/*
 * The workspace on wide screens (Phase 11, §9.12): panes beside the main one with tabs,
 * splitting, dragging tabs, resizing, layouts saved per device class and by name, and the
 * readable text width.
 */

const WIDE = { width: 1920, height: 1080 };
const ULTRA = { width: 5120, height: 1440 };

async function open(page: Page, path = '/p/q4', api = new FakeApi()) {
  await api.install(page);
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
  await fontsReady(page);
  await expect(page.getByRole('main')).not.toBeEmpty();
  return api;
}

const pane = (page: Page, n: number) =>
  page.getByRole('region', { name: `Pane ${n}`, exact: true });
const tabs = (page: Page, n: number) =>
  page.getByRole('tablist', { name: `Pane ${n} tabs` }).getByRole('tab');

test.describe('on an ultra-wide screen', () => {
  test.use({ viewport: ULTRA });

  test('starts with a board beside the notes, and an empty pane offering what to open', async ({
    page,
  }) => {
    await open(page);
    await expect(pane(page, 2).getByText('Open in this pane')).toBeVisible();
    await expect(tabs(page, 3)).toHaveText(['Website relaunch']);
    await expect(pane(page, 3).locator('[data-kb-board]')).toBeVisible();
    await expectNoA11yViolations(page);

    // A board card opens inside its pane, not in the address.
    await pane(page, 3)
      .getByRole('button', { name: /^WEB-2: / })
      .click();
    await expect(
      pane(page, 3).getByRole('region', { name: 'WEB-2: Pricing page layout' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/p\/q4$/);

    // The empty pane: a page from the picker, then search in another tab.
    await pane(page, 2).getByRole('button', { name: 'A page…' }).click();
    await page.getByRole('combobox').fill('Lisbon');
    await page.keyboard.press('Enter');
    await expect(tabs(page, 2)).toHaveText(['Lisbon trip']);
    await expect(
      pane(page, 2).getByRole('heading', { level: 2, name: 'Lisbon trip' }),
    ).toBeVisible();
    await pane(page, 2).getByRole('button', { name: 'Open in Pane 2' }).click();
    await page.getByRole('menuitem', { name: 'Search' }).click();
    await pane(page, 2).getByRole('textbox', { name: 'Search in this pane' }).fill('outbox');
    await expect(pane(page, 2).getByRole('list', { name: 'Pages found' })).toContainText(
      'Q4 roadmap',
    );
    await expect(tabs(page, 2)).toHaveText(['Lisbon trip', 'Search: outbox']);
    await pane(page, 2)
      .getByRole('list', { name: 'Pages found' })
      .getByRole('button', { name: /Offline mode/ })
      .click();
    await expect(page).toHaveURL(/\/p\/offline$/);

    // The panes are kept on this device for the next visit.
    await page.reload();
    await expect(tabs(page, 2)).toHaveText(['Lisbon trip', 'Search: outbox']);
    await expect(tabs(page, 2).nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('tabs move between panes, split off at an edge, and open in the main pane', async ({
    page,
  }) => {
    await open(page);
    const board = tabs(page, 3).first();
    // Onto pane 2's tab strip: moved there.
    const strip = page.getByRole('tablist', { name: 'Pane 2 tabs' });
    await drag(page, board, strip);
    await expect(tabs(page, 2)).toHaveText(['Website relaunch']);
    await expect(pane(page, 3)).toBeHidden();

    // Onto the right edge of pane 2 (with another tab there): a new pane.
    await pane(page, 2).getByRole('button', { name: 'Open in Pane 2' }).click();
    await page.getByRole('menuitem', { name: 'Backlinks of the main page' }).click();
    const backlinks = tabs(page, 2).nth(1);
    const box = (await pane(page, 2).boundingBox())!;
    await drag(page, backlinks, { x: box.x + box.width - 30, y: box.y + box.height / 2 });
    await expect(tabs(page, 2)).toHaveText(['Website relaunch']);
    await expect(tabs(page, 3)).toHaveText(['Backlinks: Q4 roadmap']);

    // Into the middle of the main pane: opened there.
    const main = (await page.getByRole('main').boundingBox())!;
    await drag(page, tabs(page, 2).first(), {
      x: main.x + main.width / 2,
      y: main.y + main.height / 2,
    });
    await expect(page).toHaveURL(/\/b\/relaunch$/);
    await expect(pane(page, 2).getByText('Open in this pane')).toBeVisible();
  });

  test('named layouts follow the user', async ({ page }) => {
    const api = await open(page);
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Save this layout…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save this layout' });
    await dialog.getByLabel('Layout name').fill('Planning');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect
      .poll(() => api.notes.settings.ui.layouts?.map((l) => l.name))
      .toEqual(['Planning']);

    // Change the panes, then go back to the layout.
    await pane(page, 3).getByRole('button', { name: 'Pane 3 options' }).click();
    await page.getByRole('menuitem', { name: 'Close pane' }).click();
    await expect(pane(page, 3)).toBeHidden();
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Planning' }).click();
    await expect(tabs(page, 3)).toHaveText(['Website relaunch']);
  });
});

test.describe('on a wide screen', () => {
  test.use({ viewport: WIDE });

  test('Ctrl+\\ opens the page in a new pane; one pane fits beside the main one', async ({
    page,
  }) => {
    await open(page);
    await expect(pane(page, 2)).toBeHidden();
    await page.keyboard.press('ControlOrMeta+Backslash');
    await expect(tabs(page, 2)).toHaveText(['Q4 roadmap']);
    await expect(
      pane(page, 2).getByRole('heading', { level: 2, name: 'Q4 roadmap' }),
    ).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Backslash');
    await expect(page.getByText('No room for another pane', { exact: true })).toBeVisible();

    // The divider moves with the arrow keys.
    const divider = page.getByRole('separator', { name: 'Resize the main pane' });
    const before = Number(await divider.getAttribute('aria-valuenow'));
    await divider.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect
      .poll(async () => Number(await divider.getAttribute('aria-valuenow')))
      .toBeLessThan(before);

    // Delete closes the focused tab; the pane stays, empty.
    await tabs(page, 2).first().focus();
    await page.keyboard.press('Delete');
    await expect(pane(page, 2).getByText('Open in this pane')).toBeVisible();
    await pane(page, 2).getByRole('button', { name: 'Pane 2 options' }).click();
    await page.getByRole('menuitem', { name: 'Close pane' }).click();
    await expect(pane(page, 2)).toBeHidden();
  });

  test('text keeps a readable width; a page can be full width', async ({ page }) => {
    const api = await open(page, '/p/comp');
    const text = page.getByRole('main').locator('.rich-sheet');
    const narrow = (await text.boundingBox())!.width;
    expect(narrow).toBeLessThan(900);
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Full width' }).click();
    await expect.poll(async () => (await text.boundingBox())!.width).toBeGreaterThan(narrow + 150);
    await expect.poll(() => api.notes.settings.ui.fullWidth).toEqual(['comp']);

    // The longest line is a setting.
    await page.goto('/settings/editing');
    await page.getByRole('combobox', { name: 'Longest line' }).click();
    await page.getByRole('option', { name: 'Narrow (70 characters)' }).click();
    await expect.poll(() => api.notes.settings.editor.lineLength).toBe(70);
  });
});

test('below the wide breakpoint there are no panes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expect(page.getByRole('button', { name: 'Layout', exact: true })).toBeHidden();
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(
    page.getByText('Panes side by side need a wider window.', { exact: true }),
  ).toBeVisible();
});

/** Drags with the mouse from an element to an element's centre or a point. */
async function drag(
  page: Page,
  from: import('@playwright/test').Locator,
  to: import('@playwright/test').Locator | { x: number; y: number },
) {
  const a = (await from.boundingBox())!;
  const target =
    'x' in to
      ? to
      : await (async () => {
          const b = (await to.boundingBox())!;
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        })();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
}
