import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Waits until the self-hosted fonts are in, so text is measured and drawn final. */
export async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** The API is not running in these tests; answer the health check. */
export async function mockApi(page: Page) {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', version: '0.1.0' } }),
  );
}

/** Opens the shell with a fixed theme (stored like the real preference). */
export async function openShell(page: Page, theme: Theme) {
  await mockApi(page);
  await page.addInitScript((t) => {
    localStorage.setItem('memora.appearance', JSON.stringify({ theme: t, glass: 'auto' }));
  }, theme);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Saved', { exact: true })).toBeAttached();
  await fontsReady(page);
}

/** Fails with a readable list when axe finds WCAG A/AA problems. */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
  );
  expect(summary, summary.join('\n\n')).toEqual([]);
}
