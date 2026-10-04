import type { SyncStatus, Tree } from '@memora/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type Client, type TestApp } from '../test/harness';
import { fakeDav, fakeGoogle, type FakeDav, type FakeGoogle } from '../test/fakeClouds';
import { MemorySecretStore } from './secrets';
import { RemoteError } from './store';
import { parseMultistatus, WebDavStore } from './stores/webdav';

/*
 * The cloud stores (ADR 0006) against stand-ins: WebDAV keeps to its folder, and Google Drive
 * is reached with the `drive.file` scope only, through a sign-in Memora started.
 */

let dav: FakeDav | undefined;
let google: FakeGoogle | undefined;
const apps: TestApp[] = [];

afterEach(async () => {
  await dav?.close();
  await google?.close();
  dav = undefined;
  google = undefined;
  for (const t of apps.splice(0)) await t.close();
});

const store = (url: string, password = 'secret') =>
  new WebDavStore({ url, username: 'sam', password, allowHttp: true });

describe('WebDAV', () => {
  it('makes its folder, then reads, writes, lists and removes in it', async () => {
    dav = await fakeDav();
    const s = store(`${dav.url}/dav/files/sam/Memora`);
    await s.prepare();
    expect(dav.dirs.has('/dav/files/sam/Memora/')).toBe(true);
    await s.write('changes/a.0000000001.mchg', Buffer.from('one'));
    expect((await s.read('changes/a.0000000001.mchg', 100))?.toString()).toBe('one');
    await expect(s.read('changes/a.0000000001.mchg', 2)).rejects.toThrow(/too large/);
    expect(await s.create('changes/a.0000000001.mchg', Buffer.from('two'))).toBe(false);
    expect(await s.create('changes/a.0000000002.mchg', Buffer.from('two'))).toBe(true);
    await s.remove('changes/a.0000000002.mchg');
    expect(await s.list('changes')).toEqual([
      { name: 'a.0000000001.mchg', size: 3, modifiedAt: Date.UTC(2026, 0, 1) },
    ]);
    expect(await s.read('changes/missing.mchg', 100)).toBeNull();
    await s.remove('changes/a.0000000001.mchg');
    expect(await s.list('changes')).toEqual([]);
    // Every request stayed in the folder.
    for (const request of dav.requests) {
      expect(request.split(' ')[1]!.startsWith('/dav/files/sam/Memora')).toBe(true);
    }
  });

  it('makes the folders above only for kDrive, whose root it knows', async () => {
    dav = await fakeDav();
    const nested = store(`${dav.url}/dav/files/sam/Apps/Memora`);
    await expect(nested.prepare()).rejects.toThrow(/folder above/);
    await nested.prepare(true);
    expect(dav.dirs.has('/dav/files/sam/Apps/Memora/')).toBe(true);
  });

  it('ignores entries outside the folder in a listing', async () => {
    dav = await fakeDav();
    const s = store(`${dav.url}/dav/files/sam/Memora`);
    await s.prepare();
    await s.write('changes/ok.mchg', Buffer.from('x'));
    dav.hostile.hrefs = [
      '/dav/files/sam/Other/secret.mchg',
      '/dav/files/sam/Memora/changes/../../Other/x.mchg',
      'https://elsewhere.example/dav/files/sam/Memora/changes/evil.mchg',
      '/dav/files/sam/Memora/changes/sub/deeper.mchg',
      '/dav/files/sam/Memora/changes/bad name.mchg',
    ];
    expect((await s.list('changes')).map((e) => e.name)).toEqual(['ok.mchg']);
  });

  it('never follows a redirect, and says when the password is refused', async () => {
    dav = await fakeDav();
    const s = store(`${dav.url}/dav/files/sam/Memora`);
    await s.prepare();
    await s.write('memora-vault.json', Buffer.from('{}'));
    dav.hostile.redirectGets = true;
    await expect(s.read('memora-vault.json', 100)).rejects.toMatchObject({ kind: 'denied' });
    const wrong = store(`${dav.url}/dav/files/sam/Memora`, 'wrong');
    await expect(wrong.prepare()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('only connects over HTTPS, to an address without a password or query', () => {
    expect(
      () => new WebDavStore({ url: 'http://example.com/dav', username: 'a', password: 'b' }),
    ).toThrow(RemoteError);
    expect(
      () => new WebDavStore({ url: 'https://u:p@example.com/dav', username: 'a', password: 'b' }),
    ).toThrow(/without/);
    expect(
      () => new WebDavStore({ url: 'https://example.com/dav?x=1', username: 'a', password: 'b' }),
    ).toThrow(/without/);
  });

  it('reads multistatus answers whatever their namespace prefix, with entities', () => {
    const items = parseMultistatus(
      '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/a/b&amp;c.mchg</D:href><D:propstat><D:prop><D:getcontentlength>12</D:getcontentlength><D:resourcetype/></D:prop></D:propstat></D:response><response xmlns="DAV:"><href>/a/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response></D:multistatus>',
    );
    expect(items).toEqual([
      { href: '/a/b&c.mchg', collection: false, size: 12 },
      { href: '/a/', collection: true },
    ]);
  });
});

const TOKEN = 'a'.repeat(40);
const DESKTOP = {
  HOST: '127.0.0.1',
  MEMORA_DESKTOP_TOKEN: TOKEN,
  MEMORA_GOOGLE_CLIENT_ID: 'memora-test.apps.googleusercontent.com',
  MEMORA_GOOGLE_CLIENT_SECRET: 'not-secret-in-an-app',
};
const HOST = { host: '127.0.0.1:3000' };

async function desktop(g: FakeGoogle): Promise<{ t: TestApp; me: Client; browser: Client }> {
  const t = await createTestApp(DESKTOP, {
    secretStore: new MemorySecretStore(),
    syncTesting: { timers: false, googleEndpoints: g.endpoints },
  });
  apps.push(t);
  const me = t.client(HOST);
  await me.get(`/api/v1/auth/desktop?token=${TOKEN}`);
  await me.get('/api/v1/auth/me');
  // The computer's own browser: no session with Memora.
  return { t, me, browser: t.client(HOST) };
}

async function signIn(g: FakeGoogle, c: { me: Client; browser: Client }) {
  const start = await c.me.post('/api/v1/sync/google/start');
  expect(start.statusCode, start.body).toBe(200);
  const url = new URL(start.json().url as string);
  expect(url.origin + url.pathname).toBe(g.endpoints.auth);
  const { code, state, redirectUri } = g.authorize(url.toString());
  expect(redirectUri).toBe('http://127.0.0.1:3000/api/v1/sync/google/callback');
  const back = await c.browser.get(
    `/api/v1/sync/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
  expect(back.statusCode, back.body).toBe(200);
  expect(back.body).toContain('Connected');
  return url;
}

describe('Google Drive', () => {
  it('asks for the drive.file scope only, with PKCE, and syncs two computers in its own folder', async () => {
    google = await fakeGoogle();
    const a = await desktop(google);
    const b = await desktop(google);
    const url = await signIn(google, a);
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const inbox = ((await a.me.get('/api/v1/tree')).json() as Tree).inboxId;
    await a.me.post('/api/v1/pages', { sectionId: inbox, title: 'From Drive', content: 'Hello' });
    const connected = await a.me.post('/api/v1/sync/connect', {
      provider: 'google',
      folder: 'Memora',
    });
    expect(connected.json()).toMatchObject({ vault: 'new', location: 'Google Drive › Memora' });
    await a.me.post('/api/v1/sync/enable', { passphrase: 'violet harbour lantern' });
    await a.t.app.sync.runOnce();
    expect(((await a.me.get('/api/v1/sync')).json() as SyncStatus).lastError).toBeNull();
    // Its own folder, next to (never inside, never instead of) the person's folder of that name.
    const folders = [...google.files.values()].filter((f) => f.name === 'Memora');
    expect(folders).toHaveLength(2);
    expect(google.files.get('mine')!.parents).toEqual(['root']);
    expect([...google.files.values()].some((f) => f.parents.includes('mine'))).toBe(false);

    await signIn(google, b);
    const second = await b.me.post('/api/v1/sync/connect', {
      provider: 'google',
      folder: 'Memora',
    });
    expect(second.json()).toMatchObject({ vault: 'existing' });
    await b.me.post('/api/v1/sync/enable', { passphrase: 'violet harbour lantern' });
    await b.t.app.sync.runOnce();
    const tree = (await b.me.get('/api/v1/tree')).json() as Tree;
    expect(tree.pages.map((p) => p.title)).toContain('From Drive');
    expect(
      google.granted.every((scope) => scope === 'https://www.googleapis.com/auth/drive.file'),
    ).toBe(true);
  });

  it('refuses a callback it didn’t start, or with the wrong state', async () => {
    google = await fakeGoogle();
    const a = await desktop(google);
    const stray = await a.browser.get('/api/v1/sync/google/callback?code=x&state=y');
    expect(stray.statusCode).toBe(400);
    const start = await a.me.post('/api/v1/sync/google/start');
    const { code } = google.authorize(start.json().url as string);
    const forged = await a.browser.get(`/api/v1/sync/google/callback?code=${code}&state=forged`);
    expect(forged.statusCode).toBe(400);
    const status = (await a.me.get('/api/v1/sync')).json() as SyncStatus;
    expect(status.pending?.signIn).toBe('waiting');
    const declined = await a.browser.get(
      `/api/v1/sync/google/callback?error=access_denied&state=${new URL(start.json().url as string).searchParams.get('state')}`,
    );
    expect(declined.statusCode).toBe(400);
    expect(((await a.me.get('/api/v1/sync')).json() as SyncStatus).pending?.signIn).toBe('failed');
  });
});
