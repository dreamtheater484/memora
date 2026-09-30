import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

/** The app this system's build made (release/…), or an installed one (MEMORA_APP). */
function appPath(): string {
  if (process.env.MEMORA_APP) return process.env.MEMORA_APP;
  const release = path.join(__dirname, '..', 'release');
  const app =
    process.platform === 'win32'
      ? path.join(release, 'win-unpacked', 'Memora.exe')
      : process.platform === 'darwin'
        ? path.join(release, 'mac-universal', 'Memora.app', 'Contents', 'MacOS', 'Memora')
        : path.join(
            release,
            process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked',
            'memora',
          );
  if (!existsSync(app)) throw new Error(`No packaged app at ${app}: run \`pnpm app:dir\` first.`);
  return app;
}

const userData = mkdtempSync(path.join(tmpdir(), 'memora-desktop-'));
/** What the app printed, each launch in turn: kept with the test results when a test fails. */
let output = '';

test.afterEach(() => {
  const testInfo = test.info();
  if (testInfo.status === testInfo.expectedStatus) return;
  const logs = path.join(testInfo.outputDir, 'logs');
  mkdirSync(logs, { recursive: true });
  writeFileSync(path.join(logs, 'electron.log'), output);
  const serverLogs = path.join(userData, 'logs');
  if (existsSync(serverLogs)) cpSync(serverLogs, logs, { recursive: true });
});
test.afterAll(() => rmSync(userData, { recursive: true, force: true }));

async function launch() {
  output += `--- launch at ${new Date().toISOString()}\n`;
  const app = await electron.launch({
    executablePath: appPath(),
    // An unpacked Linux app has no set-up Chromium sandbox helper (the .deb sets it up).
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    env: { ...process.env, MEMORA_USER_DATA: userData, MEMORA_NO_UPDATES: '1' },
  });
  app.process().stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  app.process().stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  // The window opens once the server answers, which it may take up to a minute for.
  const page = await app.firstWindow({ timeout: 90_000 });
  const nav = page.getByRole('navigation', { name: 'Navigation' });
  await expect(nav).toBeVisible({ timeout: 90_000 });
  return { app, page, nav };
}

test('opens signed in, keeps the notes, and closes cleanly', async () => {
  let { app, page, nav } = await launch();
  // Its name, which also names the folder of the notes (…/Memora/Data).
  expect(await app.evaluate(({ app }) => app.getName())).toBe('Memora');

  // No setup code and no password: the window signed itself in, as the owner.
  const me = (await page.evaluate(async () => (await fetch('/api/v1/auth/me')).json())) as {
    desktop?: boolean;
    user: { role: string } | null;
    csrfToken: string;
  };
  expect(me).toMatchObject({ desktop: true, user: { role: 'admin' } });

  await page.evaluate(async (csrf) => {
    const response = await fetch('/api/v1/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ name: 'From the desktop', color: 'teal', icon: 'notebook' }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, me.csrfToken);
  await page.reload();
  await expect(nav.getByRole('treeitem', { name: 'From the desktop', exact: true })).toBeVisible();

  // The licence list: the app's, the server's, the desktop app's own and Electron's.
  const notices = await page.evaluate(async () =>
    (await fetch('/third-party-licenses.txt')).text(),
  );
  for (const part of ['\nreact ', '\nfastify ', '\nelectron-updater ', 'The runtime: Electron']) {
    expect(notices).toContain(part);
  }
  const origin = new URL(page.url()).origin;
  if (process.env.MEMORA_SHOT) await page.screenshot({ path: process.env.MEMORA_SHOT });
  await app.close();

  // Started again: the same notes, at the same address (the web app's offline copy stays).
  ({ app, page, nav } = await launch());
  await expect(nav.getByRole('treeitem', { name: 'From the desktop', exact: true })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(origin);
  await app.close();

  // Closed cleanly: the database is whole on disk, without a write-ahead log left over.
  expect(existsSync(path.join(userData, 'Data', 'memora.db'))).toBe(true);
  expect(existsSync(path.join(userData, 'Data', 'memora.db-wal'))).toBe(false);
});
