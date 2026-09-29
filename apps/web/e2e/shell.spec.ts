import { expect, test, type Page } from '@playwright/test';
import { FakeApi, NOW, THEMES, expectNoA11yViolations, openShell } from './helpers';
import { FakeNotes } from './notes';

// The three sizes from the mockups plus the wide breakpoint (§9.12).
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'ultra', width: 5120, height: 1440 },
] as const;

const title = (page: Page) => page.getByRole('heading', { level: 1 });
const pageList = (page: Page) => page.getByRole('tree', { name: /^Pages in / });

for (const size of SIZES) {
  for (const theme of THEMES) {
    test(`shell at ${size.name} (${size.width}×${size.height}), ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openShell(page, theme);
      await expect(page).toHaveScreenshot(`${size.name}-${theme}.png`);
    });
  }
}

test('first run: an empty home invites a first notebook', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const api = new FakeApi();
  api.notes = new FakeNotes(NOW, 'empty');
  await openShell(page, 'light', api);
  await expect(page).toHaveScreenshot('welcome-light.png');
});

test.describe('behaviour', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('section tabs switch the section and follow the arrow keys', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('tab', { name: 'Research' }).click();
    await expect(title(page)).toHaveText('Competitor notes');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Meetings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'No pages in Meetings yet' })).toBeVisible();
  });

  test('a section group tab lists its sections', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('button', { name: 'Admin, section group' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(
      page.getByRole('button', { name: 'Admin, section group, showing Archive' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/s\/archive$/);
  });

  test('Ctrl K opens search, and a result opens its page', async ({ page }) => {
    await openShell(page, 'light');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('sourdough');
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveText('Sourdough schedule');
    await expect(page.getByRole('tab', { name: 'Recipes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('the page list opens pages, and Tab makes a subpage', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('treeitem', { name: /^Launch checklist/ }).click();
    await expect(title(page)).toHaveText('Launch checklist');

    const openq = page.getByRole('treeitem', { name: /^Open questions/ });
    await openq.click();
    await page.keyboard.press('Tab');
    await expect(openq).toHaveAttribute('aria-level', '2');
    await expect(openq).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(openq).toHaveAttribute('aria-level', '1');
  });

  test('a new page starts with its title field, and lands in the list', async ({ page }) => {
    await openShell(page, 'light');
    await page.keyboard.press('Alt+n');
    await page.getByRole('textbox', { name: 'Page title' }).fill('Sprint goals');
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveText('Sprint goals');
    await expect(pageList(page).getByRole('treeitem', { name: /^Sprint goals/ })).toBeVisible();
  });

  test('deleted pages go to the recycle bin, and Undo brings them back', async ({ page }) => {
    const api = new FakeApi();
    await openShell(page, 'light', api);
    await page.getByRole('treeitem', { name: /^Pricing experiments/ }).click();
    await page.getByRole('treeitem', { name: /^Open questions/ }).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Delete');
    await expect(page.getByText('Moved 2 pages to the recycle bin', { exact: true })).toBeVisible();
    await expect(pageList(page).getByRole('treeitem', { name: /^Open questions/ })).toHaveCount(0);
    expect(api.requests.some((r) => r.path === '/api/v1/pages/delete')).toBe(true);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(pageList(page).getByRole('treeitem', { name: /^Open questions/ })).toBeVisible();
    await expect(pageList(page).getByRole('treeitem', { name: /^Pricing/ })).toBeVisible();
  });

  test('pages move to another section from the Move dialog', async ({ page }) => {
    const api = new FakeApi();
    await openShell(page, 'light', api);
    await page.getByRole('treeitem', { name: /^Open questions/ }).click();
    await page.keyboard.press('Control+Alt+m');
    const dialog = page.getByRole('dialog', { name: 'Move or copy “Open questions”' });
    await dialog.getByRole('textbox', { name: 'Search destinations' }).fill('ideas');
    await dialog.getByText('Ideas', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(pageList(page).getByRole('treeitem', { name: /^Open questions/ })).toHaveCount(0);
    await expect
      .poll(() => api.notes.tree.pages.find((p) => p.id === 'openq')?.sectionId)
      .toBe('ideas');
  });

  test('a new section is named in its tab', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('button', { name: 'New section', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Section name' });
    await expect(name).toBeFocused();
    await name.fill('Hiring');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'Hiring' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('a quick note goes to the Inbox', async ({ page }) => {
    await openShell(page, 'light');
    await page.keyboard.press('Control+Alt+n');
    const dialog = page.getByRole('dialog', { name: 'Quick note' });
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Book the dentist');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('textbox', { name: 'Note' })).toBeFocused();
    await page.keyboard.type('Before the end of October.');
    await page.keyboard.press('Control+Enter');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(title(page)).toHaveText('Book the dentist');
    await expect(page.getByRole('main').getByText('Before the end of October.')).toBeVisible();
  });

  test('? shows the keyboard shortcuts', async ({ page }) => {
    await openShell(page, 'light');
    await page.keyboard.press('Shift+?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });

  test('the appearance menu switches theme', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('a section with 1,000 pages opens in under 300 ms', async ({ page }) => {
    const api = new FakeApi();
    api.notes.addPages('meetings', 1000);
    await openShell(page, 'light', api);
    // From the click until the section's list is in and drawn; the middle of three tries, so
    // one slow moment on a busy machine doesn't decide it.
    const times = await page.evaluate(async () => {
      const tab = (name: string) =>
        [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
          (t) => t.textContent === name,
        )!;
      const shows = (name: string) =>
        document.querySelector(`[role="tree"][aria-label="Pages in ${name}"] [role="treeitem"]`);
      const until = (done: () => boolean) =>
        new Promise<void>((resolve) => {
          const check = () => (done() ? resolve() : requestAnimationFrame(check));
          check();
        });
      const result: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const started = performance.now();
        tab('Meetings').click();
        await until(() => !!shows('Meetings'));
        // …and drawn: a task queued in the next frame runs after that frame is painted.
        await new Promise((painted) => requestAnimationFrame(() => setTimeout(painted)));
        result.push(performance.now() - started);
        tab('Roadmap').click();
        await until(() => !!shows('Roadmap'));
      }
      return result.sort((a, b) => a - b);
    });
    expect(times[1]).toBeLessThan(300);
  });

  test('a long page list builds its rows as they come into view', async ({ page }) => {
    const api = new FakeApi();
    api.notes.addPages('meetings', 1000);
    await openShell(page, 'light', api);
    await page.getByRole('tab', { name: 'Meetings' }).click();
    const rows = pageList(page).getByRole('treeitem');
    await expect(rows.first()).toHaveAttribute('aria-setsize', '1000');
    expect(await rows.count()).toBeLessThan(100);

    // End reaches the last page, though it wasn't built yet.
    await rows.first().click();
    await page.keyboard.press('End');
    const last = pageList(page).getByRole('treeitem', { name: /^Note 1000/ });
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-posinset', '1000');
  });

  test('scrolling to the end of a long page list builds the rest', async ({ page }) => {
    const api = new FakeApi();
    api.notes.addPages('meetings', 1000);
    await openShell(page, 'light', api);
    await page.getByRole('tab', { name: 'Meetings' }).click();
    const rows = pageList(page).getByRole('treeitem');
    await expect(rows.first()).toBeVisible();
    // Like dragging the scrollbar to the bottom, again while the rows come in.
    await expect
      .poll(async () => {
        await page.locator('[data-page-list]').evaluate((el) => el.scrollTo(0, el.scrollHeight));
        return rows.count();
      })
      .toBe(1000);
    await expect(pageList(page).getByRole('treeitem', { name: /^Note 1000/ })).toBeInViewport();
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('drills down from notebooks to a page, and back', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('button', { name: /^Work/ }).click();
    await page.getByRole('button', { name: /^Research/ }).click();
    await pageList(page)
      .getByRole('treeitem', { name: /^Interview synthesis/ })
      .click();
    await expect(title(page)).toHaveText('Interview synthesis');
    await expect(page).toHaveURL(/\/p\/interview$/);

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/s\/research$/);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/n\/work$/);
    await expect(page.getByRole('button', { name: /^Admin/ })).toBeVisible();
  });

  test('the Inbox is one tap away', async ({ page }) => {
    await openShell(page, 'light');
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'Inbox' })
      .click();
    await expect(pageList(page).getByRole('treeitem', { name: /^Call the plumber/ })).toBeVisible();
  });

  test('no horizontal scrolling', async ({ page }) => {
    await openShell(page, 'light');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

for (const size of [SIZES[0], SIZES[1]]) {
  for (const theme of THEMES) {
    test(`no accessibility violations at ${size.name}, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openShell(page, theme);
      await expectNoA11yViolations(page);
    });
  }
}
