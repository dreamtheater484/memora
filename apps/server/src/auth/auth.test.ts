import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import {
  DAY,
  HOUR,
  STRONG_PASSWORD,
  createTestApp,
  setCookies,
  type TestApp,
} from '../test/harness';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const setupBody = (setupCode: unknown, extra: Record<string, unknown> = {}) => ({
  setupCode,
  username: 'Alex',
  displayName: 'Alex Doe',
  password: STRONG_PASSWORD,
  ...extra,
});

describe('first-run setup', () => {
  it('reports that setup is needed while there are no users', async () => {
    const res = await t.client().get('/api/v1/auth/me');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ setupRequired: true, user: null, csrfToken: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('cannot be skipped: the setup code is required and checked', async () => {
    const code = t.app.authService.startSetupIfNeeded();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const client = t.client();

    const missing = await client.post('/api/v1/auth/setup', { ...setupBody(''), setupCode: '' });
    expect(missing.statusCode).toBe(400);

    const wrong = await client.post('/api/v1/auth/setup', setupBody('AAAA-BBBB-CCCC'));
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('invalid_setup_code');
    expect(t.app.authService.isSetupRequired()).toBe(true);
  });

  it('has no code (and accepts none) before the server has printed one', async () => {
    const res = await t.client().post('/api/v1/auth/setup', setupBody('AAAA-BBBB-CCCC'));
    expect(res.statusCode).toBe(403);
  });

  it('creates the admin, signs them in and can only happen once', async () => {
    const code = t.app.authService.startSetupIfNeeded() ?? '';
    const client = t.client();
    // Typed in lowercase without dashes: still accepted.
    const res = await client.post(
      '/api/v1/auth/setup',
      setupBody(code.toLowerCase().replace(/-/g, ' ')),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toEqual({
      id: expect.any(String),
      username: 'alex',
      displayName: 'Alex Doe',
      role: 'admin',
      mustChangePassword: false,
      twoFactor: false,
      mustSetUpTwoFactor: false,
    });
    expect(res.json().csrfToken).toEqual(expect.any(String));

    const me = await client.get('/api/v1/auth/me');
    expect(me.json().user.username).toBe('alex');
    expect(t.app.authService.startSetupIfNeeded()).toBeNull();

    const again = await t.client().post('/api/v1/auth/setup', setupBody(code));
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('already_set_up');
  });

  it('rejects weak passwords with a reason', async () => {
    const code = t.app.authService.startSetupIfNeeded();
    const res = await t
      .client()
      .post('/api/v1/auth/setup', setupBody(code, { password: 'qwerty123456' })); // gitleaks:allow (a common password, on purpose)
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('weak_password');
    expect(res.json().error.details.fields.password).toMatch(/too common/);
  });

  it('slows down setup code guessing', async () => {
    t.app.authService.startSetupIfNeeded();
    const client = t.client();
    const codes = [];
    for (let i = 0; i < 7; i += 1) {
      codes.push((await client.post('/api/v1/auth/setup', setupBody('AAAA-BBBB-CCCC'))).statusCode);
    }
    expect(codes.slice(0, 6)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(codes[6]).toBe(429);
  });
});

describe('login and sessions', () => {
  beforeEach(async () => {
    await t.setupAdmin('alex');
  });

  it('sets a hardened session cookie', async () => {
    const client = t.client();
    const res = await client.login('alex');
    const cookie = setCookies(res).find((c) => c.startsWith('__Host-memora_session='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Max-Age'); // not remembered: ends with the browser session
  });

  it('keeps a remembered session for 30 days', async () => {
    const res = await t.client().login('alex', STRONG_PASSWORD, true);
    const cookie = setCookies(res).find((c) => c.startsWith('__Host-memora_session='));
    expect(cookie).toContain(`Max-Age=${30 * 24 * 3600}`);
  });

  it('answers wrong usernames and wrong passwords the same way', async () => {
    const client = t.client();
    const wrongPassword = await client.post('/api/v1/auth/login', {
      username: 'alex',
      password: 'not-the-password',
    });
    const unknownUser = await client.post('/api/v1/auth/login', {
      username: 'nobody',
      password: 'not-the-password',
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownUser.json());
  });

  it('slows down repeated failures, per username', async () => {
    const client = t.client();
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await client.post('/api/v1/auth/login', { username: 'alex', password: 'nope' });
      statuses.push(res.statusCode);
      if (res.statusCode === 429) {
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      }
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 429]);

    // Even the right password waits until the delay has passed…
    const blocked = await client.post('/api/v1/auth/login', {
      username: 'alex',
      password: STRONG_PASSWORD,
    });
    expect(blocked.statusCode).toBe(429);
    // …then works, and resets the counter.
    t.clock.advance(2000);
    expect((await client.login('alex')).statusCode).toBe(200);
  });

  it('counts parallel attempts before checking them', async () => {
    const client = t.client();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        client.post('/api/v1/auth/login', { username: 'alex', password: 'nope' }),
      ),
    );
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 401)).toHaveLength(6);
    expect(statuses.filter((s) => s === 429)).toHaveLength(6);
  });

  it('logs failed and successful logins in the audit log', async () => {
    const client = t.client();
    await client.post('/api/v1/auth/login', { username: 'alex', password: 'nope' });
    await client.login('alex');
    const rows = t.db.prepare('SELECT event, username FROM audit_log ORDER BY id').all();
    expect(rows).toEqual([
      { event: 'setup_completed', username: 'alex' },
      { event: 'login_failed', username: 'alex' },
      { event: 'login', username: 'alex' },
    ]);
  });

  it('expires idle sessions and renews active ones', async () => {
    const client = t.client();
    await client.login('alex');
    // Used every 6 hours: stays signed in past the 12-hour idle limit.
    for (let i = 0; i < 4; i += 1) {
      t.clock.advance(6 * HOUR);
      expect((await client.get('/api/v1/auth/me')).json().user?.username).toBe('alex');
    }
    t.clock.advance(12 * HOUR + 1);
    const res = await client.get('/api/v1/auth/me');
    expect(res.json().user).toBeNull();
    expect(client.cookies.size).toBe(0); // the stale cookie was cleared
  });

  it('ends even an active session after 90 days', async () => {
    const client = t.client();
    await client.login('alex', STRONG_PASSWORD, true);
    for (let day = 0; day < 89; day += 7) {
      t.clock.advance(7 * DAY);
      await client.get('/api/v1/auth/me');
    }
    t.clock.advance(7 * DAY);
    expect((await client.get('/api/v1/auth/me')).json().user).toBeNull();
  });

  it('writes the renewal at most every few minutes', async () => {
    const client = t.client();
    await client.login('alex');
    const lastSeen = () =>
      (t.db.prepare('SELECT MAX(last_seen_at) AS v FROM sessions').get() as { v: number }).v;
    const before = lastSeen();
    t.clock.advance(60_000);
    await client.get('/api/v1/auth/me');
    expect(lastSeen()).toBe(before);
    t.clock.advance(5 * 60_000);
    await client.get('/api/v1/auth/me');
    expect(lastSeen()).toBe(t.clock.time);
  });

  it('logs out: the session is deleted and the cookie cleared', async () => {
    const client = t.client();
    await client.login('alex');
    const res = await client.post('/api/v1/auth/logout');
    expect(res.statusCode).toBe(204);
    expect(client.cookies.size).toBe(0);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 }); // setup's
  });

  it('uses a plain cookie over plain HTTP, and warns about it in the docs', async () => {
    const client = t.client({ host: 'nas.lan:3000' });
    const res = await client.login('alex');
    const cookie = setCookies(res).find((c) => c.startsWith('memora_session='));
    expect(cookie).toBeDefined();
    expect(cookie).not.toContain('Secure');
    expect((await client.get('/api/v1/auth/me')).json().user.username).toBe('alex');
  });

  it('uses the secure cookie behind an HTTPS reverse proxy', async () => {
    const client = t.client({ host: 'nas.lan', 'x-forwarded-proto': 'https' });
    const res = await client.post(
      '/api/v1/auth/login',
      { username: 'alex', password: STRONG_PASSWORD },
      { headers: { origin: 'https://nas.lan' } },
    );
    expect(setCookies(res).some((c) => c.startsWith('__Host-memora_session='))).toBe(true);
  });
});

describe('request protection', () => {
  let admin: Awaited<ReturnType<TestApp['setupAdmin']>>;

  beforeEach(async () => {
    admin = await t.setupAdmin('alex');
  });

  it('requires the CSRF token on requests that change data', async () => {
    const without = await admin.patch('/api/v1/auth/me', { displayName: 'A' }, { csrf: false });
    expect(without.statusCode).toBe(403);
    expect(without.json().error.code).toBe('csrf_failed');

    const wrong = await admin.patch(
      '/api/v1/auth/me',
      { displayName: 'A' },
      { csrf: false, headers: { 'x-csrf-token': 'forged' } },
    );
    expect(wrong.statusCode).toBe(403);

    const ok = await admin.patch('/api/v1/auth/me', { displayName: 'Alex D.' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().displayName).toBe('Alex D.');
  });

  it('refuses requests from other sites', async () => {
    const other = await admin.patch(
      '/api/v1/auth/me',
      { displayName: 'Hacked' },
      { headers: { origin: 'https://evil.example' } },
    );
    expect(other.statusCode).toBe(403);
    expect(other.json().error.code).toBe('forbidden');

    const fetchSite = await t
      .client()
      .post(
        '/api/v1/auth/login',
        { username: 'alex', password: STRONG_PASSWORD },
        { headers: { origin: '', 'sec-fetch-site': 'cross-site' } },
      );
    expect(fetchSite.statusCode).toBe(403);
  });

  it('accepts the configured base URL as origin', async () => {
    await t.close();
    t = await createTestApp({ MEMORA_BASE_URL: 'https://notes.example.com' });
    t.app.authService.startSetupIfNeeded();
    const res = await t
      .client({ host: 'internal:3000' })
      .post(
        '/api/v1/auth/login',
        { username: 'x', password: 'y' },
        { headers: { origin: 'https://notes.example.com' } },
      );
    expect(res.statusCode).toBe(401); // got past the origin check
  });

  it('asks anonymous callers to log in', async () => {
    const res = await t.client().get('/api/v1/auth/sessions');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthenticated');
  });

  it('rejects malformed input with field messages', async () => {
    const res = await admin.patch('/api/v1/auth/me', { displayName: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({
      code: 'invalid_request',
      message: 'Some fields are not valid.',
      details: { fields: { displayName: 'Enter a name.' } },
    });
  });

  it('returns JSON errors for bad JSON', async () => {
    const res = await admin.request('POST', '/api/v1/auth/login', '{nope', {
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });
});

describe('password changes', () => {
  let admin: Awaited<ReturnType<TestApp['setupAdmin']>>;

  beforeEach(async () => {
    admin = await t.setupAdmin('alex');
  });

  it('needs the current password', async () => {
    const res = await admin.post('/api/v1/auth/password', {
      currentPassword: 'wrong-password',
      newPassword: 'marble-orchid-compass',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('wrong_password');
  });

  it('checks the new password and reports it on its own field', async () => {
    const res = await admin.post('/api/v1/auth/password', {
      currentPassword: STRONG_PASSWORD,
      newPassword: 'alex-alex-alex-1',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fields.newPassword).toMatch(/username/);
  });

  it('signs out other devices and rotates the current session', async () => {
    const laptop = t.client();
    await laptop.login('alex');
    const oldCookie = admin.cookieHeader;

    const res = await admin.post('/api/v1/auth/password', {
      currentPassword: STRONG_PASSWORD,
      newPassword: 'marble-orchid-compass',
    });
    expect(res.statusCode).toBe(200);
    expect(admin.cookieHeader).not.toBe(oldCookie);

    expect((await admin.get('/api/v1/auth/me')).json().user.username).toBe('alex');
    expect((await laptop.get('/api/v1/auth/me')).json().user).toBeNull();
    const stale = await t.client().get('/api/v1/auth/me', { headers: { cookie: oldCookie } });
    expect(stale.json().user).toBeNull();

    await expect(t.client().login('alex', 'marble-orchid-compass')).resolves.toBeDefined();
  });
});

describe('sessions list', () => {
  it('lists and revokes the user’s own sessions', async () => {
    const admin = await t.setupAdmin('alex');
    const phone = t.client({
      'user-agent':
        'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
    });
    await phone.login('alex');

    const list = (await admin.get('/api/v1/auth/sessions')).json();
    expect(list).toHaveLength(2);
    const other = list.find((s: { current: boolean }) => !s.current);
    expect(other.deviceLabel).toBe('Chrome on Android');

    expect((await admin.delete(`/api/v1/auth/sessions/${other.id}`)).statusCode).toBe(204);
    expect((await phone.get('/api/v1/auth/me')).json().user).toBeNull();
    expect((await admin.delete(`/api/v1/auth/sessions/${other.id}`)).statusCode).toBe(404);
  });
});

describe('route declarations', () => {
  it('refuses to start with an API route that has no access policy', async () => {
    const app = await buildApp({
      config: loadConfig({ MEMORA_WEB_DIR: '/nonexistent' }),
      db: t.db,
      version: 'test',
      logger: false,
    });
    expect(() => app.get('/api/v1/oops', async () => 'hi')).toThrow(/must declare config.access/);
    expect(() =>
      app.get('/api/v1/fine', { config: { access: 'user' } }, async () => 'hi'),
    ).not.toThrow();
  });
});
