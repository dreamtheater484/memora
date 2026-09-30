import type { MeResponse } from '@memora/shared';
import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  FakeApi,
  MEMBER,
  NOW,
  PASSWORD,
  SETUP_CODE,
  TEMPORARY_PASSWORD,
  THEMES,
  expectNoA11yViolations,
  fontsReady,
  mockApi,
  setTheme,
  type Theme,
} from './helpers';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const SIGNED_OUT: Partial<MeResponse> = { user: null };
const SETUP: Partial<MeResponse> = { setupRequired: true, user: null };
const MUST_CHANGE: Partial<MeResponse> = { user: { ...MEMBER, mustChangePassword: true } };

/** A screen of the app, and a heading that shows once it has loaded. */
const SCREENS = {
  login: { path: '/login', me: SIGNED_OUT, ready: 'Welcome back' },
  setup: { path: '/setup', me: SETUP, ready: 'Set up Memora' },
  'change-password': { path: '/change-password', me: MUST_CHANGE, ready: 'Choose your password' },
  account: { path: '/settings/account', me: { user: ADMIN }, ready: 'Devices' },
  users: { path: '/settings/users', me: { user: ADMIN }, ready: 'Users' },
  audit: { path: '/settings/audit', me: { user: ADMIN }, ready: 'Audit log' },
} satisfies Record<string, { path: string; me: Partial<MeResponse>; ready: string }>;

type Screen = keyof typeof SCREENS;

async function open(page: Page, screen: Screen, theme: Theme = 'light') {
  const { path, me, ready } = SCREENS[screen];
  const api = await mockApi(page, new FakeApi(me));
  await page.clock.setFixedTime(NOW);
  await setTheme(page, theme);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: ready, exact: true })).toBeVisible();
  // Lists fill in after the heading; wait for their last row.
  if (screen === 'account') await expect(page.getByText('Firefox on Windows')).toBeVisible();
  if (screen === 'users') await expect(page.getByText('Jamie Chen')).toBeVisible();
  if (screen === 'audit') await expect(page.getByText('set up Memora')).toBeVisible();
  await fontsReady(page);
  return api;
}

// The settings pages scroll inside the layout, so a full-page shot needs a tall viewport.
const TALL_PHONE = { width: PHONE.width, height: 1400 };

const SHOTS: { screen: Screen; size: 'phone' | 'tall-phone' | 'desktop'; theme: Theme }[] = [
  { screen: 'login', size: 'desktop', theme: 'light' },
  { screen: 'login', size: 'desktop', theme: 'dark' },
  { screen: 'login', size: 'phone', theme: 'light' },
  { screen: 'setup', size: 'desktop', theme: 'light' },
  { screen: 'change-password', size: 'desktop', theme: 'dark' },
  { screen: 'account', size: 'desktop', theme: 'light' },
  { screen: 'account', size: 'tall-phone', theme: 'dark' },
  { screen: 'users', size: 'desktop', theme: 'light' },
  { screen: 'users', size: 'desktop', theme: 'dark' },
  { screen: 'audit', size: 'desktop', theme: 'light' },
];

for (const { screen, size, theme } of SHOTS) {
  test(`${screen} at ${size}, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ phone: PHONE, 'tall-phone': TALL_PHONE, desktop: DESKTOP }[size]);
    await open(page, screen, theme);
    await expect(page).toHaveScreenshot(`${screen}-${size}-${theme}.png`);
  });
}

test.describe('behaviour', () => {
  test.use({ viewport: DESKTOP });

  test('signed out, the app asks to log in and then returns to the page', async ({ page }) => {
    await mockApi(page, new FakeApi(SIGNED_OUT));
    await page.goto('/settings/account');
    await expect(page).toHaveURL('/login?redirect=%2Fsettings%2Faccount');

    await page.getByLabel('Username').fill('alex');
    await page.getByLabel('Password', { exact: true }).fill('not-it-at-all');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong username or password.');
    await expect(page.getByLabel('Username')).toHaveValue('alex');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');

    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL('/settings/account');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  });

  test('a redirect to another site is ignored', async ({ page }) => {
    await mockApi(page, new FakeApi(SIGNED_OUT));
    await page.goto('/login?redirect=//example.com');
    await page.getByLabel('Username').fill('alex');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL('/');
  });

  test('first run: every page leads to setup, which needs the code', async ({ page }) => {
    await mockApi(page, new FakeApi(SETUP));
    await page.goto('/settings/users');
    await expect(page).toHaveURL('/setup');

    await page.getByLabel('Setup code').fill('AAAA-BBBB-CCCC');
    await page.getByLabel('Your name').fill('Robin Vale');
    await page.getByLabel('Username').fill('robin');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('That code is not right.')).toBeVisible();
    await expect(page.getByLabel('Setup code')).toHaveAttribute('aria-invalid', 'true');

    await page.getByLabel('Setup code').fill(SETUP_CODE);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Welcome to Memora, Robin Vale.', { exact: true })).toBeVisible();
  });

  test('a one-time password leads to choosing a new one first', async ({ page }) => {
    await mockApi(page, new FakeApi(MUST_CHANGE));
    await page.goto('/settings/account');
    await expect(page).toHaveURL('/change-password');

    await page.getByLabel('One-time password').fill(TEMPORARY_PASSWORD);
    await page.getByLabel('New password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Set password and continue' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Your new password is set.', { exact: true })).toBeVisible();
  });

  test('regular users don’t see the admin pages', async ({ page }) => {
    await mockApi(page, new FakeApi({ user: MEMBER }));
    await page.goto('/settings/users');
    await expect(page).toHaveURL('/settings/account');
    const nav = page.getByRole('navigation', { name: 'Settings' });
    await expect(nav.getByRole('link')).toHaveText([
      'Account',
      'Editing',
      'Import & export',
      'This device',
    ]);

    await page.goto('/');
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('menuitem', { name: 'Account settings' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Users' })).toHaveCount(0);
  });

  test('adding a user shows their one-time password until dismissed', async ({ page }) => {
    const api = await open(page, 'users');
    await page.getByRole('button', { name: 'Add user' }).click();
    const form = page.getByRole('dialog', { name: 'Add a user' });
    await form.getByLabel('Username').fill('rowan');
    await form.getByLabel('Name', { exact: true }).fill('Rowan Ellis');
    await form.getByRole('button', { name: 'Add user' }).click();

    const added = page.getByRole('dialog', { name: 'Rowan Ellis was added' });
    await expect(added.getByLabel('One-time password')).toHaveText(TEMPORARY_PASSWORD);
    // A stray click beside it doesn't lose the password.
    await page.mouse.click(20, 450);
    await expect(added).toBeVisible();
    await added.getByRole('button', { name: 'Done' }).click();
    await expect(added).toBeHidden();
    await expect(page.getByText('Rowan Ellis')).toBeVisible();

    // Changes carry the session's CSRF token.
    const create = api.requests.find((r) => r.method === 'POST' && r.path.endsWith('/users'));
    expect(create?.headers['x-csrf-token']).toBe('csrf-1');
    expect(create?.body).toEqual({ username: 'rowan', displayName: 'Rowan Ellis', role: 'user' });
  });

  test('logging out shows the login page, with no way back', async ({ page }) => {
    await open(page, 'account');
    await page.getByRole('button', { name: 'Log out on this device' }).click();
    await expect(page).toHaveURL('/login');
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('phone', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  for (const screen of ['login', 'account', 'users'] as const) {
    test(`${screen}: no horizontal scrolling`, async ({ page }) => {
      await open(page, screen);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('accessibility', () => {
  test.use({ viewport: DESKTOP });

  for (const screen of Object.keys(SCREENS) as Screen[]) {
    for (const theme of THEMES) {
      test(`no violations on ${screen}, ${theme}`, async ({ page }) => {
        await open(page, screen, theme);
        await expectNoA11yViolations(page);
      });
    }
  }

  test('no violations in the add-user dialog', async ({ page }) => {
    await open(page, 'users');
    await page.getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByRole('dialog', { name: 'Add a user' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
