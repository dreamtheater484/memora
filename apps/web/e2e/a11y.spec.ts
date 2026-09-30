import { expect, test, type Page } from '@playwright/test';
import { FakeApi, NOW, expectNoA11yViolations, fontsReady, setTheme } from './helpers';

/*
 * The accessibility audit (Phase 11, §9.13): the keyboard reaches everything with a visible
 * name and no traps, a skip link leads past the bars, motion follows the system setting, and
 * axe finds nothing on the screens not covered elsewhere.
 */

test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, path: string, api = new FakeApi()) {
  await api.install(page);
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
  await fontsReady(page);
  return api;
}

/** Focus back at the start of the page, as when it has just loaded. */
async function fromTheTop(page: Page) {
  await page.evaluate(() => {
    // Where Tab starts from follows focus: a focused probe at the top, gone again.
    const probe = document.createElement('button');
    document.body.prepend(probe);
    probe.focus();
    probe.remove();
  });
}

test('the first Tab offers a way past the bars to the content', async ({ page }) => {
  await open(page, '/p/q4');
  await expect(page.getByRole('main')).not.toBeEmpty();
  await fromTheTop(page);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to the content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  // The next Tab is inside the content.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#main-content'))).toBe(true);
});

test('Tab walks every region with visible, named stops and no trap', async ({ page }) => {
  await open(page, '/p/q4');
  await expect(page.getByRole('main')).not.toBeEmpty();
  await fromTheTop(page);
  const seen: { name: string; region: string }[] = [];
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const rect = el.getBoundingClientRect();
      const labelled = el.getAttribute('aria-labelledby');
      const name = (
        el.getAttribute('aria-label') ??
        (labelled ? document.getElementById(labelled)?.textContent : null) ??
        (el as HTMLInputElement).labels?.[0]?.textContent ??
        el.getAttribute('title') ??
        el.textContent ??
        ''
      ).trim();
      const region = el.closest('header, nav, main, aside, section[aria-label]');
      return {
        name,
        visible: rect.width > 0 && rect.height > 0,
        region: region?.getAttribute('aria-label') ?? region?.tagName.toLowerCase() ?? '',
        editor: !!el.closest('.cm-editor, .ProseMirror'),
      };
    });
    // Past the last stop, focus leaves the page for the browser: the walk is done.
    if (!stop) break;
    // Inside an editor, Tab is text: leave it the way the shortcut sheet says.
    if (stop.editor) {
      await page.keyboard.press('Escape');
      continue;
    }
    expect(stop.visible, `stop ${i + 1} (${stop.name}) is invisible`).toBe(true);
    expect(stop.name, `stop ${i + 1} in ${stop.region} has no name`).not.toBe('');
    seen.push({ name: stop.name, region: stop.region });
  }
  const regions = new Set(seen.map((s) => s.region));
  expect(seen.length).toBeGreaterThan(20);
  for (const region of ['header', 'Navigation', 'Editor', 'Pages']) {
    expect([...regions], `the keyboard never reached ${region}`).toContain(region);
  }
});

test('motion follows the system: short when reduced, animated otherwise', async ({ page }) => {
  await open(page, '/p/q4');
  const duration = () =>
    page
      .getByRole('button', { name: 'Page actions' })
      .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(await duration()).toBe('0.001s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await duration()).not.toBe('0.001s');
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds nothing on the settings, search and recycle bin, ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await open(page, '/settings/device');
    await expect(
      page.getByRole('switch', { name: 'Keep every page on this device' }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto('/settings/editing');
    await expect(page.getByRole('combobox', { name: 'Longest line' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto('/search?q=outbox');
    await expect(page.getByRole('main').getByText('Q4 roadmap').first()).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto('/trash');
    await expect(page.getByRole('main')).not.toBeEmpty();
    await expectNoA11yViolations(page);
  });
}

test('axe finds nothing on a phone’s board and card sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/b/relaunch');
  await page
    .locator('[data-kb-board]')
    .getByRole('button', { name: /^WEB-1: / })
    .click();
  await expect(page.getByRole('dialog', { name: 'Card' })).toBeVisible();
  await expectNoA11yViolations(page);
});
