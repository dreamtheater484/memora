import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRONG_PASSWORD, createTestApp, type Client, type TestApp } from '../test/harness';
import { loadSecretKey, SecretKeyError } from './secretKey';
import { sealSecret, totpAt } from './totp';

let t: TestApp;
let admin: Client;

beforeEach(async () => {
  t = await createTestApp();
  admin = await t.setupAdmin('alex');
});
afterEach(() => t.close());

const SECOND = 1000;

/** Turns two-step verification on for a signed-in client; answers the secret and codes. */
async function turnOn(client: Client) {
  const setup = await client.post('/api/v1/auth/two-factor/setup', { password: STRONG_PASSWORD });
  expect(setup.statusCode).toBe(200);
  const { secret, uri } = setup.json() as { secret: string; uri: string };
  const enabled = await client.post('/api/v1/auth/two-factor/enable', {
    code: totpAt(secret, t.clock.time),
  });
  expect(enabled.statusCode).toBe(200);
  // The next code must come from a later step: each works once.
  t.clock.advance(30 * SECOND);
  return { secret, uri, codes: (enabled.json() as { codes: string[] }).codes };
}

/** A member with a password of their own, signed in. */
async function member(username = 'sam') {
  const created = await admin.post('/api/v1/admin/users', { username, displayName: 'Sam' });
  const client = t.client();
  await client.post('/api/v1/auth/login', {
    username,
    password: created.json().temporaryPassword,
  });
  await client.post('/api/v1/auth/password', {
    currentPassword: created.json().temporaryPassword,
    newPassword: STRONG_PASSWORD,
  });
  return { client, id: created.json().user.id as string };
}

function passwordStep(username = 'alex', password = STRONG_PASSWORD) {
  return t.client().post('/api/v1/auth/login', { username, password, remember: true });
}

describe('two-step verification', () => {
  it('is set up with the password and a first code, and keeps the secret sealed', async () => {
    expect((await admin.get('/api/v1/auth/two-factor')).json()).toEqual({
      enabled: false,
      recoveryCodesLeft: 0,
      required: false,
    });
    const wrong = await admin.post('/api/v1/auth/two-factor/setup', { password: 'not-it-at-all' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('wrong_password');

    const setup = await admin.post('/api/v1/auth/two-factor/setup', {
      password: STRONG_PASSWORD,
    });
    const { secret, uri } = setup.json();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(uri).toBe(
      `otpauth://totp/Memora%3Aalex?secret=${secret}&issuer=Memora&algorithm=SHA1&digits=6&period=30`,
    );
    const bad = await admin.post('/api/v1/auth/two-factor/enable', { code: '000000' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_code');

    const enabled = await admin.post('/api/v1/auth/two-factor/enable', {
      code: totpAt(secret, t.clock.time),
    });
    const { codes } = enabled.json();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);

    const row = t.db
      .prepare('SELECT totp_secret_enc AS sealed FROM users WHERE username = ?')
      .get('alex') as { sealed: string };
    expect(row.sealed).toMatch(/^v1:/);
    expect(row.sealed).not.toContain(secret);
    const hashes = t.db.prepare('SELECT code_hash FROM recovery_codes').all() as {
      code_hash: string;
    }[];
    expect(hashes).toHaveLength(10);
    for (const { code_hash } of hashes) expect(codes).not.toContain(code_hash);

    expect((await admin.get('/api/v1/auth/two-factor')).json()).toEqual({
      enabled: true,
      recoveryCodesLeft: 10,
      required: false,
    });
    expect((await admin.get('/api/v1/auth/me')).json().user.twoFactor).toBe(true);
    const again = await admin.post('/api/v1/auth/two-factor/setup', {
      password: STRONG_PASSWORD,
    });
    expect(again.json().error.code).toBe('two_factor_on');
  });

  it('signs out other devices when it is turned on', async () => {
    const phone = t.client();
    await phone.login('alex');
    await turnOn(admin);
    expect((await phone.get('/api/v1/auth/me')).json().user).toBeNull();
    expect((await admin.get('/api/v1/auth/me')).json().user.username).toBe('alex');
  });

  it('asks for a code after the password, and a code works once', async () => {
    const { secret } = await turnOn(admin);
    const first = await passwordStep();
    expect(first.statusCode).toBe(200);
    const challenge = first.json();
    expect(challenge).toEqual({ twoFactorRequired: true, ticket: expect.any(String) });
    // No session yet: the password alone signs nobody in.
    expect(first.headers['set-cookie']).toBeUndefined();

    const browser = t.client();
    const wrong = await browser.post('/api/v1/auth/login/two-factor', {
      ticket: challenge.ticket,
      code: '123456',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('invalid_code');

    const code = totpAt(secret, t.clock.time);
    const right = await browser.post('/api/v1/auth/login/two-factor', {
      ticket: challenge.ticket,
      code: `${code.slice(0, 3)} ${code.slice(3)}`,
    });
    expect(right.statusCode).toBe(200);
    expect(right.json().user.username).toBe('alex');
    expect((await browser.get('/api/v1/auth/me')).json().user.username).toBe('alex');

    // The ticket is spent, and the same code doesn't work for another login.
    const reused = await t
      .client()
      .post('/api/v1/auth/login/two-factor', { ticket: challenge.ticket, code });
    expect(reused.json().error.code).toBe('login_expired');
    const next = (await passwordStep()).json();
    const replay = await t
      .client()
      .post('/api/v1/auth/login/two-factor', { ticket: next.ticket, code });
    expect(replay.json().error.code).toBe('invalid_code');

    const audit = (await admin.get('/api/v1/admin/audit')).json().entries;
    expect(audit.find((e: { event: string }) => e.event === 'login').meta.twoFactor).toBe('app');
    expect(
      audit.some(
        (e: { event: string; meta: { reason?: string } }) =>
          e.event === 'login_failed' && e.meta.reason === 'wrong_code',
      ),
    ).toBe(true);
  });

  it('lets a recovery code in once, and counts what is left', async () => {
    const { codes } = await turnOn(admin);
    const login = async (code: string) => {
      const { ticket } = (await passwordStep()).json();
      return t.client().post('/api/v1/auth/login/two-factor', { ticket, code });
    };
    const [code] = codes as [string];
    expect((await login(code.toUpperCase().replace(/-/g, ' '))).statusCode).toBe(200);
    expect((await login(code)).json().error.code).toBe('invalid_code');
    expect((await admin.get('/api/v1/auth/two-factor')).json().recoveryCodesLeft).toBe(9);
    const audit = (await admin.get('/api/v1/admin/audit')).json().entries;
    expect(audit.map((e: { event: string }) => e.event)).toContain('recovery_code_used');

    // New codes replace the old ones.
    const fresh = await admin.post('/api/v1/auth/two-factor/recovery-codes', {
      password: STRONG_PASSWORD,
    });
    expect(fresh.json().codes).toHaveLength(10);
    expect((await login(codes[1]!)).json().error.code).toBe('invalid_code');
    expect((await login(fresh.json().codes[0])).statusCode).toBe(200);
  });

  it('gives a login five minutes and a few tries, and slows down guessing', async () => {
    const { secret } = await turnOn(admin);
    const { ticket } = (await passwordStep()).json();
    t.clock.advance(5 * 60 * SECOND + 1);
    const late = await t.client().post('/api/v1/auth/login/two-factor', {
      ticket,
      code: totpAt(secret, t.clock.time),
    });
    expect(late.statusCode).toBe(401);
    expect(late.json().error.code).toBe('login_expired');

    // Five wrong codes end a login; after that the account waits longer between guesses,
    // even with the right password.
    const fresh = (await passwordStep()).json().ticket;
    for (let i = 0; i < 5; i += 1) {
      const res = await t
        .client()
        .post('/api/v1/auth/login/two-factor', { ticket: fresh, code: '000000' });
      expect(res.json().error.code).toBe('invalid_code');
    }
    const spent = await t
      .client()
      .post('/api/v1/auth/login/two-factor', { ticket: fresh, code: totpAt(secret, t.clock.time) });
    expect(spent.json().error.code).toBe('login_expired');
    const another = (await passwordStep()).json().ticket;
    await t.client().post('/api/v1/auth/login/two-factor', { ticket: another, code: '000000' });
    const blocked = await passwordStep();
    expect(blocked.statusCode).toBe(429);
    t.clock.advance(60 * SECOND);
    const later = (await passwordStep()).json().ticket;
    const ok = await t
      .client()
      .post('/api/v1/auth/login/two-factor', { ticket: later, code: totpAt(secret, t.clock.time) });
    expect(ok.statusCode).toBe(200);
  });

  it('is turned off with the password', async () => {
    await turnOn(admin);
    const wrong = await admin.post('/api/v1/auth/two-factor/disable', {
      password: 'nope-nope-nope',
    });
    expect(wrong.json().error.code).toBe('wrong_password');
    expect(
      (await admin.post('/api/v1/auth/two-factor/disable', { password: STRONG_PASSWORD }))
        .statusCode,
    ).toBe(204);
    expect((await admin.get('/api/v1/auth/two-factor')).json().enabled).toBe(false);
    expect(t.db.prepare('SELECT count(*) AS n FROM recovery_codes').get()).toEqual({ n: 0 });
    // Back to the password alone.
    expect((await passwordStep()).json().user.username).toBe('alex');
    const again = await admin.post('/api/v1/auth/two-factor/disable', {
      password: STRONG_PASSWORD,
    });
    expect(again.json().error.code).toBe('two_factor_off');
  });

  it('leaves recovery codes working when the secret key is lost', async () => {
    const { secret, codes } = await turnOn(admin);
    // As after a restore on a new machine without data/secret.key: sealed with another key.
    t.db
      .prepare('UPDATE users SET totp_secret_enc = ? WHERE username = ?')
      .run(sealSecret(randomBytes(32), secret), 'alex');
    const login = async (code: string) => {
      const { ticket } = (await passwordStep()).json();
      return t.client().post('/api/v1/auth/login/two-factor', { ticket, code });
    };
    expect((await login(totpAt(secret, t.clock.time))).json().error.code).toBe('invalid_code');
    const rescued = t.client();
    const { ticket } = (await passwordStep()).json();
    const res = await rescued.post('/api/v1/auth/login/two-factor', { ticket, code: codes[0] });
    expect(res.statusCode).toBe(200);
    // Signed in, the app can be set up again.
    await rescued.post('/api/v1/auth/two-factor/disable', { password: STRONG_PASSWORD });
    const again = await turnOn(rescued);
    expect(again.codes).toHaveLength(10);
  });
});

describe('the secret key', () => {
  it('is made once, private to Memora, and refused when damaged', () => {
    const file = `${t.config.dataDir}/key-test/secret.key`;
    const key = loadSecretKey(file);
    expect(key).toHaveLength(32);
    expect(loadSecretKey(file)).toEqual(key);
    writeFileSync(file, 'not a key');
    expect(() => loadSecretKey(file)).toThrow(SecretKeyError);
    writeFileSync(file, `${randomBytes(32).toString('hex').toUpperCase()}\r\n`);
    expect(loadSecretKey(file)).toHaveLength(32);
  });
});

describe('requiring two-step verification', () => {
  it('needs the admin to use it first', async () => {
    const refused = await admin.patch('/api/v1/admin/security', { requireTwoFactor: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('two_factor_off');
    await turnOn(admin);
    const on = await admin.patch('/api/v1/admin/security', { requireTwoFactor: true });
    expect(on.json()).toEqual({ requireTwoFactor: true });
    expect((await admin.get('/api/v1/admin/security')).json()).toEqual({ requireTwoFactor: true });
    const audit = (await admin.get('/api/v1/admin/audit')).json().entries;
    expect(audit[0]).toMatchObject({ event: 'security_changed', meta: { requireTwoFactor: true } });
  });

  it('holds everyone else at the set-up until they have done it', async () => {
    const sam = await member();
    await turnOn(admin);
    await admin.patch('/api/v1/admin/security', { requireTwoFactor: true });

    const me = (await sam.client.get('/api/v1/auth/me')).json();
    expect(me.user.mustSetUpTwoFactor).toBe(true);
    const blocked = await sam.client.get('/api/v1/tree');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('two_factor_required');
    // The event channel is refused too.
    await expect(sam.client.events()).rejects.toThrow();

    expect((await sam.client.get('/api/v1/auth/two-factor')).json().required).toBe(true);
    await turnOn(sam.client);
    expect((await sam.client.get('/api/v1/tree')).statusCode).toBe(200);
    expect((await sam.client.get('/api/v1/auth/me')).json().user.mustSetUpTwoFactor).toBe(false);
  });

  it('lets an admin turn it off for someone who lost their phone', async () => {
    const sam = await member();
    await turnOn(sam.client);
    const self = await admin.post(
      `/api/v1/admin/users/${(await admin.get('/api/v1/auth/me')).json().user.id}/two-factor/reset`,
    );
    expect(self.statusCode).toBe(409);

    const users = (await admin.get('/api/v1/admin/users')).json();
    expect(users.find((u: { username: string }) => u.username === 'sam').twoFactor).toBe(true);
    const reset = await admin.post(`/api/v1/admin/users/${sam.id}/two-factor/reset`);
    expect(reset.statusCode).toBe(200);
    expect(reset.json().twoFactor).toBe(false);
    // Signed out everywhere; the password alone signs in again.
    expect((await sam.client.get('/api/v1/auth/me')).json().user).toBeNull();
    expect((await passwordStep('sam')).json().user.username).toBe('sam');
    const audit = (await admin.get('/api/v1/admin/audit')).json().entries;
    expect(audit.find((e: { event: string }) => e.event === 'two_factor_reset').meta.target).toBe(
      'sam',
    );
  });
});
