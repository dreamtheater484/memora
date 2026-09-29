import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRONG_PASSWORD, createTestApp, type Client, type TestApp } from '../test/harness';

let t: TestApp;
let admin: Client;

beforeEach(async () => {
  t = await createTestApp();
  admin = await t.setupAdmin('alex');
});
afterEach(async () => {
  await t.close();
});

async function createUser(username: string, role: 'admin' | 'user' = 'user') {
  const res = await admin.post('/api/v1/admin/users', { username, displayName: username, role });
  expect(res.statusCode).toBe(201);
  return res.json() as { user: { id: string }; temporaryPassword: string };
}

/** Logs in with the temporary password and replaces it, like a new user would. */
async function activate(username: string, temporaryPassword: string): Promise<Client> {
  const client = t.client();
  await client.login(username, temporaryPassword);
  const res = await client.post('/api/v1/auth/password', {
    currentPassword: temporaryPassword,
    newPassword: STRONG_PASSWORD,
  });
  expect(res.statusCode).toBe(200);
  return client;
}

describe('creating users', () => {
  it('creates a user with a one-time password that must be replaced', async () => {
    const { user, temporaryPassword } = await createUser('Sam');
    expect(temporaryPassword).toMatch(/^[0-9a-z]{4}(-[0-9a-z]{4}){3}$/);
    expect(user).toMatchObject({ username: 'sam', role: 'user', mustChangePassword: true });

    const sam = t.client();
    const login = await sam.login('sam', temporaryPassword);
    expect(login.json().user.mustChangePassword).toBe(true);

    // Nothing else works until the password is replaced…
    const blocked = await sam.get('/api/v1/auth/sessions');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('password_change_required');

    // …then everything does.
    await sam.post('/api/v1/auth/password', {
      currentPassword: temporaryPassword,
      newPassword: STRONG_PASSWORD,
    });
    expect((await sam.get('/api/v1/auth/sessions')).statusCode).toBe(200);
    expect((await sam.get('/api/v1/auth/me')).json().user.mustChangePassword).toBe(false);
  });

  it('refuses a taken username, whatever its case', async () => {
    await createUser('sam');
    const res = await admin.post('/api/v1/admin/users', { username: 'SAM', displayName: 'Sam 2' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('username_taken');
  });

  it('lists users with their activity', async () => {
    await createUser('sam');
    const list = (await admin.get('/api/v1/admin/users')).json();
    expect(list.map((u: { username: string }) => u.username)).toEqual(['alex', 'sam']);
    expect(list[0]).toMatchObject({ role: 'admin', sessionCount: 1, disabled: false });
    expect(list[1]).toMatchObject({ role: 'user', sessionCount: 0, lastSeenAt: null });
  });
});

describe('changing users', () => {
  it('disabling signs the user out and blocks logins; enabling restores access', async () => {
    const { user, temporaryPassword } = await createUser('sam');
    const sam = await activate('sam', temporaryPassword);

    const off = await admin.patch(`/api/v1/admin/users/${user.id}`, { disabled: true });
    expect(off.json()).toMatchObject({ disabled: true, sessionCount: 0 });
    expect((await sam.get('/api/v1/auth/me')).json().user).toBeNull();
    const login = await t.client().post('/api/v1/auth/login', {
      username: 'sam',
      password: STRONG_PASSWORD,
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('account_disabled');

    await admin.patch(`/api/v1/admin/users/${user.id}`, { disabled: false });
    await expect(t.client().login('sam')).resolves.toBeDefined();
  });

  it('changes names and roles', async () => {
    const { user } = await createUser('sam');
    const res = await admin.patch(`/api/v1/admin/users/${user.id}`, {
      displayName: 'Samantha',
      role: 'admin',
    });
    expect(res.json()).toMatchObject({ displayName: 'Samantha', role: 'admin' });
  });

  it('never removes the last active admin, nor lets admins lock themselves out', async () => {
    const me = (await admin.get('/api/v1/auth/me')).json().user;
    const demoteSelf = await admin.patch(`/api/v1/admin/users/${me.id}`, { role: 'user' });
    expect(demoteSelf.statusCode).toBe(409);
    const disableSelf = await admin.patch(`/api/v1/admin/users/${me.id}`, { disabled: true });
    expect(disableSelf.statusCode).toBe(409);
    const deleteSelf = await admin.delete(`/api/v1/admin/users/${me.id}`);
    expect(deleteSelf.statusCode).toBe(409);

    // A second admin can't take away the last *other* active admin either.
    const { user, temporaryPassword } = await createUser('kim', 'admin');
    const kim = await activate('kim', temporaryPassword);
    await admin.patch(`/api/v1/admin/users/${user.id}`, { disabled: true });
    const res = await kim.request('DELETE', `/api/v1/admin/users/${me.id}`);
    expect(res.statusCode).toBe(401); // kim was signed out by being disabled
    await admin.patch(`/api/v1/admin/users/${user.id}`, { disabled: false });
    const kim2 = t.client();
    await kim2.login('kim');
    const demote = await kim2.patch(`/api/v1/admin/users/${me.id}`, { role: 'user' });
    expect(demote.statusCode).toBe(200); // fine: kim is still an active admin
    const demoteKim = await kim2.patch(`/api/v1/admin/users/${user.id}`, { role: 'user' });
    expect(demoteKim.statusCode).toBe(409); // kim is now the last one
  });

  it('answers 404 for unknown users', async () => {
    const res = await admin.patch('/api/v1/admin/users/nope', { displayName: 'X' });
    expect(res.statusCode).toBe(404);
  });
});

describe('password resets', () => {
  it('replaces the password, signs the user out and forces a new password', async () => {
    const { user, temporaryPassword } = await createUser('sam');
    const sam = await activate('sam', temporaryPassword);

    const res = await admin.post(`/api/v1/admin/users/${user.id}/reset-password`);
    expect(res.statusCode).toBe(200);
    const { temporaryPassword: fresh } = res.json();
    expect((await sam.get('/api/v1/auth/me')).json().user).toBeNull();

    const old = await t.client().post('/api/v1/auth/login', {
      username: 'sam',
      password: STRONG_PASSWORD,
    });
    expect(old.statusCode).toBe(401);
    const login = await t.client().login('sam', fresh);
    expect(login.json().user.mustChangePassword).toBe(true);
  });

  it('is not how admins change their own password', async () => {
    const me = (await admin.get('/api/v1/auth/me')).json().user;
    const res = await admin.post(`/api/v1/admin/users/${me.id}/reset-password`);
    expect(res.statusCode).toBe(409);
  });
});

describe('deleting users', () => {
  it('deletes the user and their sessions', async () => {
    const { user, temporaryPassword } = await createUser('sam');
    const sam = await activate('sam', temporaryPassword);
    expect((await admin.delete(`/api/v1/admin/users/${user.id}`)).statusCode).toBe(204);
    expect((await sam.get('/api/v1/auth/me')).json().user).toBeNull();
    expect(
      t.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id),
    ).toEqual({ n: 0 });
    expect((await admin.delete(`/api/v1/admin/users/${user.id}`)).statusCode).toBe(404);
  });
});

describe('audit log', () => {
  it('pages through events, newest first', async () => {
    await createUser('sam');
    await createUser('kim');
    const first = (await admin.get('/api/v1/admin/audit?limit=2')).json();
    expect(first.entries.map((e: { event: string }) => e.event)).toEqual([
      'user_created',
      'user_created',
    ]);
    expect(first.entries[0].meta.target).toBe('kim');
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = (
      await admin.get(`/api/v1/admin/audit?limit=2&before=${first.nextCursor}`)
    ).json();
    expect(second.entries.map((e: { event: string }) => e.event)).toEqual(['setup_completed']);
    expect(second.nextCursor).toBeNull();
  });
});
