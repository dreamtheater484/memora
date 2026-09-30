import { afterEach, describe, expect, it } from 'vitest';
import { BackupService } from '../backup/service';
import { ConfigError, loadConfig } from '../config';
import { createTestApp, DAY, type TestApp } from '../test/harness';

const TOKEN = 'a'.repeat(40);
const DESKTOP = { HOST: '127.0.0.1', MEMORA_DESKTOP_TOKEN: TOKEN, MEMORA_DESKTOP_NAME: 'Sam' };
/** The desktop app's window: it talks to Memora at 127.0.0.1 on the configured port. */
const HOST = { host: '127.0.0.1:3000' };

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('the desktop app (Phase 14)', () => {
  it('listens on this computer only', () => {
    expect(() => loadConfig({ ...DESKTOP, HOST: '0.0.0.0' })).toThrow(ConfigError);
    expect(loadConfig(DESKTOP).desktop).toEqual({ token: TOKEN, name: 'Sam' });
    expect(loadConfig({}).desktop).toBeNull();
  });

  it('needs no setup, and says it is the desktop app', async () => {
    t = await createTestApp(DESKTOP);
    const me = await t.client(HOST).get('/api/v1/auth/me');
    expect(me.json()).toMatchObject({ setupRequired: false, user: null, desktop: true });
    expect(t.app.authService.startSetupIfNeeded()).toBeNull();
  });

  it('signs the window in with the launch secret, as the owner', async () => {
    t = await createTestApp(DESKTOP);
    const window = t.client(HOST);
    const wrong = await window.get(`/api/v1/auth/desktop?token=${'b'.repeat(40)}`);
    expect(wrong.statusCode).toBe(403);

    const res = await window.get(`/api/v1/auth/desktop?token=${TOKEN}&next=/p/abc`);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/p/abc');
    const me = await window.get('/api/v1/auth/me');
    expect(me.json()).toMatchObject({ user: { displayName: 'Sam', role: 'admin' }, desktop: true });

    // The same owner every time, not a new account per launch.
    const again = t.client(HOST);
    await again.get(`/api/v1/auth/desktop?token=${TOKEN}`);
    expect((await again.get('/api/v1/auth/me')).json()).toMatchObject({
      user: { id: (me.json() as { user: { id: string } }).user.id },
    });
  });

  it('only sends the window on to a page of this app', async () => {
    t = await createTestApp(DESKTOP);
    for (const next of ['//example.com', '/\\example.com', 'https://example.com']) {
      const res = await t
        .client(HOST)
        .get(`/api/v1/auth/desktop?token=${TOKEN}&next=${encodeURIComponent(next)}`);
      expect(res.headers.location).toBe('/');
    }
  });

  it('has no passwords to log in or set up with', async () => {
    t = await createTestApp(DESKTOP);
    const client = t.client(HOST);
    expect(
      (await client.post('/api/v1/auth/login', { username: 'me', password: 'x' })).statusCode,
    ).toBe(404);
    expect((await client.post('/api/v1/auth/setup', {})).statusCode).toBe(404);
  });

  it('answers only when addressed as this computer (no DNS rebinding)', async () => {
    t = await createTestApp(DESKTOP);
    const elsewhere = await t.client({ host: 'attacker.example:3000' }).get('/api/v1/auth/me');
    expect(elsewhere.statusCode).toBe(421);
    expect((await t.client({ host: 'localhost:3000' }).get('/api/health')).statusCode).toBe(200);
  });

  it('has no service worker: its server is always there', async () => {
    t = await createTestApp(DESKTOP);
    for (const url of ['/sw.js', '/sw.js?v=2']) {
      const response = await t.client(HOST).get(url);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
    }
  });

  it('takes the backup it missed while closed, once a day at most', async () => {
    t = await createTestApp(DESKTOP);
    const quiet = { info: () => undefined, error: () => undefined };
    const backups = new BackupService(t.db, t.config, quiet, t.clock.now);
    expect(await backups.catchUp()).toMatchObject({ kind: 'scheduled' });
    t.clock.advance(DAY / 2);
    expect(await backups.catchUp()).toBeNull();
    t.clock.advance(DAY);
    expect(await backups.catchUp()).toMatchObject({ kind: 'scheduled' });
    expect(await backups.list()).toHaveLength(2);
  });

  it('leaves a server as it was', async () => {
    t = await createTestApp();
    expect((await t.client().get('/api/v1/auth/desktop?token=x')).statusCode).toBe(404);
    expect((await t.client().get('/api/v1/auth/me')).json()).not.toHaveProperty('desktop');
  });
});
