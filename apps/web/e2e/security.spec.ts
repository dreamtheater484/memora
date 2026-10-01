import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  APP_CODE,
  FakeApi,
  MEMBER,
  NOW,
  PASSWORD,
  RECOVERY_CODES,
  THEMES,
  TOTP_KEY,
  expectNoA11yViolations,
  fontsReady,
} from './helpers';

/*
 * Security (Phase 12, §11): two-step verification (logging in with a code, setting it up,
 * recovery codes, an administrator's rules) and the content security policy the app runs
 * under.
 */

test.use({ viewport: { width: 1280, height: 860 } });

async function logIn(page: Page) {
  await page.getByLabel('Username').fill('alex');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test.describe('logging in', () => {
  test('asks for the code from the app after the password', async ({ page }) => {
    const api = new FakeApi({ user: null });
    api.twoFactor.enabled = true;
    await api.install(page);
    await page.goto('/login');
    await logIn(page);

    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    const code = page.getByLabel('Code from the app');
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expectNoA11yViolations(page);

    await code.fill('111111');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('That code is not right.')).toBeVisible();
    await expect(code).toHaveValue('');

    await code.fill(`${APP_CODE.slice(0, 3)} ${APP_CODE.slice(3)}`);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/$/);
    const sent = api.requests.filter((r) => r.path === '/api/v1/auth/login/two-factor');
    expect(sent.at(-1)?.body).toEqual({ ticket: 't-1', code: APP_CODE });
  });

  test('takes a recovery code when the phone is lost', async ({ page }) => {
    const api = new FakeApi({ user: null });
    api.twoFactor = { enabled: true, recoveryCodesLeft: 10, required: false };
    await api.install(page);
    await page.goto('/login');
    await logIn(page);
    await page.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
    const code = page.getByLabel('Recovery code');
    await expect(code).toBeFocused();
    await code.fill(RECOVERY_CODES[3]!);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(api.twoFactor.recoveryCodesLeft).toBe(9);
  });

  for (const theme of THEMES) {
    test(`the code step looks right (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      const api = new FakeApi({ user: null });
      api.twoFactor.enabled = true;
      await api.install(page);
      await page.goto('/login');
      await logIn(page);
      await expect(page.getByLabel('Code from the app')).toBeFocused();
      await fontsReady(page);
      await expect(page).toHaveScreenshot(`login-code-${theme}.png`);
    });
  }
});

test.describe('setting it up', () => {
  test('from the Account page: password, QR code, first code, recovery codes', async ({ page }) => {
    const api = new FakeApi();
    await api.install(page);
    await page.clock.setFixedTime(NOW);
    await page.goto('/settings/account');
    const section = page.getByRole('region', { name: 'Two-step verification' });
    await expect(section).toContainText('Off');
    await section.getByRole('button', { name: 'Set up' }).click();

    const dialog = page.getByRole('dialog', { name: 'Set up two-step verification' });
    await dialog.getByLabel('Your password').fill('not-my-password');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('That password is not right.')).toBeVisible();
    await dialog.getByLabel('Your password').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Continue' }).click();

    await expect(
      dialog.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeVisible();
    await expect(dialog.locator('code')).toHaveText(TOTP_KEY.replace(/(.{4})(?=.)/g, '$1 '));
    await expectNoA11yViolations(page);
    await fontsReady(page);
    await expect(dialog).toHaveScreenshot('set-up-scan.png');

    await dialog.getByLabel('Code from the app').fill('000000');
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    await expect(dialog.getByText('That code is not right.')).toBeVisible();
    await dialog.getByLabel('Code from the app').fill(APP_CODE);
    await dialog.getByRole('button', { name: 'Turn on' }).click();

    const codes = dialog.getByRole('list', { name: 'Recovery codes' });
    await expect(codes.getByRole('listitem')).toHaveCount(10);
    await expect(codes).toContainText(RECOVERY_CODES[0]!);
    const done = dialog.getByRole('button', { name: 'Done' });
    await expect(done).toBeDisabled();
    // Shown once: a click beside the dialog doesn't close it.
    await page.mouse.click(10, 10);
    await expect(dialog).toBeVisible();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download' }).click();
    expect((await download).suggestedFilename()).toBe('memora-recovery-codes.txt');
    await dialog.getByRole('checkbox').click();
    await done.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Two-step verification is on.', { exact: true })).toBeVisible();
    await expect(section).toContainText('On');
    await expect(section).toContainText('10 recovery codes left');
  });

  test('new recovery codes and turning it off ask for the password', async ({ page }) => {
    const api = new FakeApi({ user: { ...ADMIN, twoFactor: true } });
    api.twoFactor = { enabled: true, recoveryCodesLeft: 2, required: false };
    await api.install(page);
    await page.goto('/settings/account');
    const section = page.getByRole('region', { name: 'Two-step verification' });
    await expect(section).toContainText('2 recovery codes left: make new ones soon');

    await section.getByRole('button', { name: 'New recovery codes' }).click();
    const fresh = page.getByRole('dialog', { name: 'New recovery codes' });
    await fresh.getByLabel('Your password').fill(PASSWORD);
    await fresh.getByRole('button', { name: 'Make new codes' }).click();
    await expect(fresh.getByRole('listitem')).toHaveCount(10);
    await fresh.getByRole('checkbox').click();
    await fresh.getByRole('button', { name: 'Done' }).click();
    await expect(section).toContainText('10 recovery codes left');

    await section.getByRole('button', { name: 'Turn off' }).click();
    const off = page.getByRole('dialog', { name: 'Turn off two-step verification?' });
    await off.getByLabel('Your password').fill(PASSWORD);
    await off.getByRole('button', { name: 'Turn off' }).click();
    await expect(off).toBeHidden();
    await expect(section).toContainText('Anyone with your password can log in.');
  });

  test('is required before anything else when an administrator asks for it', async ({ page }) => {
    const api = new FakeApi({ user: { ...MEMBER, mustSetUpTwoFactor: true } });
    api.twoFactor.required = true;
    await api.install(page);
    await page.goto('/p/q4');
    await expect(page).toHaveURL(/\/set-up-two-factor$/);
    await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByLabel('Your password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Code from the app').fill(APP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Continue to Memora' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible();
  });
});

test('a new password shows how strong it looks', async ({ page }) => {
  const api = new FakeApi();
  await api.install(page);
  await page.goto('/settings/account');
  const field = page.getByLabel('New password', { exact: true });
  await expect(page.getByText('At least 12 characters.', { exact: false })).toBeVisible();
  const meter = page.getByRole('meter', { name: 'Password strength' });
  await field.fill('alex-password-1');
  await expect(meter).toHaveAttribute('aria-valuetext', 'Weak: it contains your username');
  await field.fill('violet-harbour-lantern');
  await expect(meter).toHaveAttribute('aria-valuetext', 'Strong');
  await expect(meter).toHaveAttribute('aria-valuenow', '4');
  await expectNoA11yViolations(page);
});

test('required while signed in: the set-up comes first, without logging out', async ({ page }) => {
  const api = new FakeApi({ user: MEMBER });
  await api.install(page);
  await page.goto('/p/q4');
  await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible();
  await expect.poll(() => api.requests.some((r) => r.path === '/api/v1/tree')).toBe(true);

  // An administrator requires it: the server closes the live channel.
  api.twoFactor.required = true;
  api.me = { ...api.me, user: { ...MEMBER, mustSetUpTwoFactor: true } };
  api.closeChannels(4401);
  await expect(page).toHaveURL(/\/set-up-two-factor$/);

  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Code from the app').fill(APP_CODE);
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Continue to Memora' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible();
});

test.describe('administrators', () => {
  test('require it for everyone, and turn it off for someone who lost their phone', async ({
    page,
  }) => {
    const api = new FakeApi({ user: { ...ADMIN, twoFactor: true } });
    api.users[1]!.twoFactor = true;
    await api.install(page);
    await page.clock.setFixedTime(NOW);
    await page.goto('/settings/users');

    const require = page.getByRole('switch', { name: 'Require two-step verification' });
    await expect(require).not.toBeChecked();
    await require.click();
    await expect(require).toBeChecked();
    expect(api.twoFactor.required).toBe(true);

    const sam = page.getByRole('listitem').filter({ hasText: 'Sam Lake' });
    await expect(sam.getByText('Two-step', { exact: true })).toBeVisible();
    await sam.getByRole('button', { name: 'Actions for Sam Lake' }).click();
    await page.getByRole('menuitem', { name: 'Turn off two-step verification…' }).click();
    const confirm = page.getByRole('dialog', {
      name: 'Turn off two-step verification for Sam Lake?',
    });
    await confirm.getByRole('button', { name: 'Turn off' }).click();
    await expect(confirm).toBeHidden();
    await expect(sam.getByText('Two-step', { exact: true })).toBeHidden();
    await expectNoA11yViolations(page);
  });

  test('can’t require it before using it themselves', async ({ page }) => {
    const api = new FakeApi();
    await api.install(page);
    await page.goto('/settings/users');
    await expect(
      page.getByRole('switch', { name: 'Require two-step verification' }),
    ).toBeDisabled();
    await expect(page.getByText('Set it up for your own account first')).toBeVisible();
  });
});

test.describe('content security policy', () => {
  // Wide enough for the Markdown preview beside the source.
  test.use({ viewport: { width: 1440, height: 900 } });

  test('pages run under it, and nothing they do is refused', async ({ page }) => {
    const violations: string[] = [];
    await page.exposeFunction('reportViolation', (text: string) => violations.push(text));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) =>
        (window as unknown as { reportViolation: (t: string) => void }).reportViolation(
          `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber} ${event.sample}`,
        ),
      );
    });
    const api = new FakeApi();
    api.notes.content.set(
      'q4',
      [
        '# Plan',
        '',
        '$$',
        'e^{i\\pi} + 1 = 0',
        '$$',
        '',
        '```mermaid',
        'flowchart LR',
        '  A --> B',
        '```',
        '',
        '```js',
        'const a = 1;',
        '```',
      ].join('\n'),
    );
    await api.install(page);
    const response = await page.goto('/p/q4');
    const policy = response?.headers()['content-security-policy'] ?? '';
    expect(policy).toContain("script-src 'self'");
    expect(response?.headers()['x-frame-options']).toBe('DENY');

    const body = page.locator('[data-preview] .markdown-body');
    await expect(body.locator('.katex-display')).toBeVisible();
    await expect(body.locator('.mermaid-diagram .diagram-drawing > svg')).toBeVisible({
      timeout: 15_000,
    });
    await expect(body.locator('.shiki span[style*="--shiki"]').first()).toBeAttached();

    // Inline script can't run, even if some ever got into the page.
    const ran = await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.inlineRan = true';
      document.body.append(script);
      return (window as { inlineRan?: boolean }).inlineRan ?? false;
    });
    expect(ran).toBe(false);
    await expect.poll(() => violations.length).toBeGreaterThan(0);
    expect(violations).toEqual([expect.stringMatching(/^script-src-elem inline/)]);
  });
});
