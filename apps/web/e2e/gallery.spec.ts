import { expect, test } from '@playwright/test';
import { THEMES, expectNoA11yViolations, fontsReady } from './helpers';

const DEMOS = [
  'colors',
  'type',
  'buttons',
  'fields',
  'tabs',
  'tree',
  'status',
  'empty',
  'skeleton',
  'split',
];

test.use({ viewport: { width: 1280, height: 900 } });

for (const theme of THEMES) {
  test.describe(`gallery, ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      await fontsReady(page);
    });

    test('components match the baseline', async ({ page }) => {
      for (const id of DEMOS) {
        await expect(page.getByTestId(`demo-${id}`), id).toHaveScreenshot(`${id}-${theme}.png`);
      }
    });

    test('menu', async ({ page }) => {
      await page.getByRole('button', { name: 'Page menu' }).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveScreenshot(`menu-${theme}.png`);
    });

    test('dialog', async ({ page }) => {
      await page.getByRole('button', { name: 'Dialog', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page).toHaveScreenshot(`dialog-${theme}.png`);
    });

    test('command palette', async ({ page }) => {
      await page.getByRole('button', { name: /command palette/i }).click();
      await page.getByRole('combobox').fill('road');
      await expect(page.getByRole('option', { name: /Q4 roadmap/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page).toHaveScreenshot(`palette-${theme}.png`);
    });

    test('has no accessibility violations', async ({ page }) => {
      await expectNoA11yViolations(page);
    });
  });
}

test('solid panels when glass is off', async ({ page }) => {
  await page.goto('/gallery.html?theme=light&glass=off');
  await fontsReady(page);
  await expect(page.getByTestId('demo-buttons')).toHaveScreenshot('buttons-solid.png');
  await expect(page.getByTestId('demo-status')).toHaveScreenshot('status-solid.png');
});
