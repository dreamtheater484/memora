import { expect, test } from '@playwright/test';
import { THEMES, expectNoA11yViolations, openShell } from './helpers';

// The three sizes from the mockups plus the wide breakpoint (§9.12).
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'ultra', width: 5120, height: 1440 },
] as const;

for (const size of SIZES) {
  for (const theme of THEMES) {
    test(`shell at ${size.name} (${size.width}×${size.height}), ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openShell(page, theme);
      await expect(page).toHaveScreenshot(`${size.name}-${theme}.png`);
    });
  }
}

test.describe('behaviour', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('section tabs switch the section and follow the arrow keys', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('tab', { name: 'Research' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Competitor notes');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Meetings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'No pages in Meetings yet' })).toBeVisible();
  });

  test('Ctrl K opens search, and a result opens its page', async ({ page }) => {
    await openShell(page, 'light');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('sourdough');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sourdough schedule');
    await expect(page.getByRole('tab', { name: 'Recipes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('the page list selects pages', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('treeitem', { name: /^Launch checklist/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Launch checklist');
  });

  test('the appearance menu switches theme', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('shows offline when the server does not answer', async ({ page }) => {
    await page.route('**/api/health', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByRole('banner').getByText('Offline', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('drawers open the navigation and the page list', async ({ page }) => {
    await openShell(page, 'light');
    await page.getByRole('button', { name: 'Notebooks' }).click();
    const nav = page.getByRole('dialog', { name: 'Navigation' });
    await expect(nav).toBeVisible();
    await nav.getByRole('treeitem', { name: /^Research/ }).click();
    await expect(nav).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Competitor notes');

    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'Pages' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Pages' })).toBeVisible();
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
