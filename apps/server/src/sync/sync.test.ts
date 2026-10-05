import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uuidv7, type Page, type SyncStatus, type Tree } from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pngOf } from '../test/images';
import { createTestApp, DAY, type Client, type TestApp } from '../test/harness';
import type { SyncEngine } from './engine';
import { MemorySecretStore } from './secrets';

/*
 * Sync through a folder (ADR 0006), end to end: two or three desktop apps, each with its own
 * database, sharing one folder on this computer.
 */

const TOKEN = 'a'.repeat(40);
const DESKTOP = { HOST: '127.0.0.1', MEMORA_DESKTOP_TOKEN: TOKEN, MEMORA_DESKTOP_NAME: 'Sam' };
const HOST = { host: '127.0.0.1:3000' };
const PASSPHRASE = 'violet harbour lantern';

interface Computer {
  t: TestApp;
  me: Client;
  secrets: MemorySecretStore;
  sync(): Promise<SyncStatus>;
  tree(): Promise<Tree>;
  page(id: string): Promise<Page>;
}

let folder: string;
let computers: Computer[] = [];

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'memora-vault-'));
});

afterEach(async () => {
  for (const c of computers) await c.t.close();
  computers = [];
  rmSync(folder, { recursive: true, force: true });
});

async function computer(partBytes?: number, env: Record<string, string> = {}): Promise<Computer> {
  const secrets = new MemorySecretStore();
  const t = await createTestApp(
    { ...DESKTOP, ...env },
    {
      secretStore: secrets,
      syncTesting: { timers: false, ...(partBytes ? { partBytes } : {}) },
    },
  );
  const me = t.client(HOST);
  const signIn = await me.get(`/api/v1/auth/desktop?token=${TOKEN}`);
  expect(signIn.statusCode).toBe(303);
  // The session check hands out the CSRF token, as in the window.
  await me.get('/api/v1/auth/me');
  const c: Computer = {
    t,
    me,
    secrets,
    async sync() {
      await t.app.sync.runOnce();
      return (await me.get('/api/v1/sync')).json() as SyncStatus;
    },
    tree: async () => (await me.get('/api/v1/tree')).json() as Tree,
    page: async (id) => (await me.get(`/api/v1/pages/${id}`)).json() as Page,
  };
  computers.push(c);
  return c;
}

/** Sets sync up on a computer with the shared folder, and runs once. */
async function connect(c: Computer, passphrase = PASSPHRASE) {
  const connected = await c.me.post('/api/v1/sync/connect', { provider: 'folder', path: folder });
  expect(connected.statusCode, connected.body).toBe(200);
  const enabled = await c.me.post('/api/v1/sync/enable', { passphrase });
  expect(enabled.statusCode, enabled.body).toBe(200);
  const status = await c.sync();
  expect(status.lastError, JSON.stringify(status.lastError)).toBeNull();
  return { connected: connected.json(), status };
}

/** Runs sync on each computer in turn, twice: everything has gone round, nothing waits. */
async function settle(...cs: Computer[]) {
  for (let round = 0; round < 2; round += 1) {
    for (const c of cs) {
      const status = await c.sync();
      expect(status.lastError, JSON.stringify(status.lastError)).toBeNull();
    }
  }
  for (const c of cs) {
    const parked = c.t.db.prepare('SELECT tbl, change FROM sync_parked').all();
    expect(parked, 'changes waiting for a row').toEqual([]);
  }
}

async function notebook(c: Computer, name: string) {
  const res = await c.me.post('/api/v1/notebooks', { name, color: 'coral' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().notebooks[0].id as string;
}

async function section(c: Computer, notebookId: string, name: string) {
  const res = await c.me.post('/api/v1/sections', { notebookId, name, color: 'teal' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().sections[0].id as string;
}

async function page(
  c: Computer,
  sectionId: string,
  title: string,
  content = '',
  type = 'markdown',
) {
  const res = await c.me.post('/api/v1/pages', { sectionId, title, content, type });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().pages[0].id as string;
}

async function save(c: Computer, id: string, content: string) {
  const { revision } = await c.page(id);
  const res = await c.me.put(`/api/v1/pages/${id}/content`, { baseRevision: revision, content });
  expect(res.statusCode, res.body).toBe(200);
}

const rich = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

describe('setting sync up', () => {
  it('makes a vault in an empty folder, and asks the next computer for its passphrase', async () => {
    const a = await computer();
    const b = await computer();
    const first = await connect(a);
    expect(first.connected.vault).toBe('new');
    expect(first.status).toMatchObject({ state: 'on', provider: 'folder', location: folder });
    expect(readdirSync(folder)).toContain('memora-vault.json');

    const connected = await b.me.post('/api/v1/sync/connect', { provider: 'folder', path: folder });
    expect(connected.json()).toMatchObject({ vault: 'existing' });
    const wrong = await b.me.post('/api/v1/sync/enable', { passphrase: 'not the passphrase' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('wrong_password');
    expect((await b.me.get('/api/v1/sync')).json()).toMatchObject({ state: 'connecting' });
  });

  it('refuses a weak passphrase for a new vault', async () => {
    const a = await computer();
    await a.me.post('/api/v1/sync/connect', { provider: 'folder', path: folder });
    const weak = await a.me.post('/api/v1/sync/enable', { passphrase: 'short' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.details.fields.passphrase).toBeTruthy();
    expect(readdirSync(folder)).not.toContain('memora-vault.json');
  });

  it('names a phone by the name the Android app gives, not "localhost"', async () => {
    const phone = await computer(undefined, {
      MEMORA_DESKTOP_SHELL: 'android',
      MEMORA_DESKTOP_NAME: 'Pixel 9',
    });
    const { status } = await connect(phone);
    expect(status.device?.name).toBe('Pixel 9');
  });

  it('is only in the desktop app', async () => {
    const server = await createTestApp({}, { syncTesting: { timers: false } });
    const admin = await server.setupAdmin();
    const res = await admin.post('/api/v1/sync/connect', { provider: 'folder', path: folder });
    expect(res.statusCode).toBe(404);
    expect((await admin.get('/api/v1/sync')).json()).toMatchObject({ available: false });
    await server.close();
  });

  it('keeps the secrets out of the database, and the notes unreadable in the folder', async () => {
    const a = await computer();
    const nb = await notebook(a, 'Garden plans');
    const s = await section(a, nb, 'Vegetables');
    await page(a, s, 'Tomatoes', 'Plant the san marzano seedlings in May.');
    await connect(a);
    const everything = readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => readFileSync(join(e.parentPath, e.name)).toString('latin1'))
      .join('\n');
    expect(everything).not.toContain('marzano');
    expect(everything).not.toContain('Garden plans');
    const state = JSON.stringify(a.t.db.prepare('SELECT * FROM sync_state').all());
    expect(state).not.toContain(PASSPHRASE);
    const secrets = await a.secrets.load();
    expect(secrets.credentials).toEqual({ kind: 'folder' });
    expect(secrets.vaultKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });
});

describe('two computers', () => {
  it('brings the first computer’s notes to the second, and changes both ways', async () => {
    const a = await computer();
    const b = await computer();
    const nb = await notebook(a, 'Work');
    const s = await section(a, nb, 'Meetings');
    const p = await page(a, s, 'Monday', '# Monday\n\nAgenda');
    const inboxA = (await a.tree()).inboxId;
    const quick = await page(a, inboxA, 'Quick note', 'Call the plumber');
    const ownB = await notebook(b, 'Home');
    await connect(a);
    await connect(b);
    await settle(a, b);

    const treeB = await b.tree();
    expect(treeB.notebooks.map((n) => n.name).sort()).toEqual(['Home', 'Work']);
    expect(treeB.inboxId).toBe(inboxA);
    expect(treeB.pages.map((x) => x.title).sort()).toEqual(['Monday', 'Quick note']);
    expect((await b.page(p)).content).toBe('# Monday\n\nAgenda');
    expect((await b.page(quick)).sectionId).toBe(inboxA);
    expect((await a.tree()).notebooks.map((n) => n.id)).toContain(ownB);

    await save(b, p, '# Monday\n\nAgenda\n\n- Budget');
    await a.me.patch(`/api/v1/notebooks/${nb}`, { name: 'Office' });
    await settle(b, a);
    expect((await a.page(p)).content).toBe('# Monday\n\nAgenda\n\n- Budget');
    expect((await b.tree()).notebooks.find((n) => n.id === nb)?.name).toBe('Office');
    // Each computer counts its own revisions: the browser saves against them.
    expect((await a.page(p)).revision).toBeGreaterThan(1);
  });

  it('merges Markdown edits made on both computers at the same time', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    const p = await page(a, inbox, 'List', 'Apples\n\nBread\n\nCheese');
    await connect(a);
    await connect(b);
    await settle(a, b);

    await save(a, p, 'Apples and pears\n\nBread\n\nCheese');
    await save(b, p, 'Apples\n\nBread\n\nCheese and crackers');
    await settle(a, b);
    const merged = 'Apples and pears\n\nBread\n\nCheese and crackers';
    expect((await a.page(p)).content).toBe(merged);
    expect((await b.page(p)).content).toBe(merged);
  });

  it('keeps both sides of a rich page changed on both computers', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    const p = await page(a, inbox, 'Letter', rich('Dear Sam'), 'rich');
    await connect(a);
    await connect(b);
    await settle(a, b);

    await save(a, p, rich('Dear Sam, from A'));
    await save(b, p, rich('Dear Sam, from B'));
    await settle(a, b);
    const onA = await a.page(p);
    const onB = await b.page(p);
    expect(onA.content).toBe(onB.content);
    const kept = (computer: Computer) =>
      computer.t.db
        .prepare("SELECT content FROM page_versions WHERE page_id = ? AND reason = 'conflict'")
        .all(p) as { content: string }[];
    const loser =
      onA.content === rich('Dear Sam, from A')
        ? rich('Dear Sam, from B')
        : rich('Dear Sam, from A');
    expect(kept(a).map((v) => v.content)).toContain(loser);
    expect(kept(b).map((v) => v.content)).toContain(loser);
  });

  it('deletes on every computer, to the recycle bin and for good', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    const p = await page(a, inbox, 'Old', 'Gone soon');
    await connect(a);
    await connect(b);
    await settle(a, b);

    await a.me.post('/api/v1/pages/delete', { ids: [p] });
    await settle(a, b);
    expect((await b.tree()).pages.map((x) => x.id)).not.toContain(p);
    const trash = (await b.me.get('/api/v1/trash')).json();
    expect(JSON.stringify(trash)).toContain(p);

    await b.me.post('/api/v1/trash/empty');
    await settle(b, a);
    expect(a.t.db.prepare('SELECT 1 FROM pages WHERE id = ?').get(p)).toBeUndefined();
  });

  it('brings pasted files along, through the folder', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    const id = uuidv7();
    const image = pngOf(640, 480);
    const up = await a.me.put(`/api/v1/assets/${id}?name=photo.png`, image, {
      headers: { 'content-type': 'image/png' },
    });
    expect(up.statusCode, up.body).toBe(201);
    await page(a, inbox, 'Photo', `![photo](asset:${id})`);
    await connect(a);
    await connect(b);
    await settle(a, b);
    const got = await b.me.get(`/api/v1/assets/${id}`);
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(image)).toBe(true);
    expect(readdirSync(join(folder, 'files')).length).toBe(1);
  });

  it('makes tags with the same name one tag', async () => {
    const a = await computer();
    const b = await computer();
    const pa = await page(a, (await a.tree()).inboxId, 'From A');
    const pb = await page(b, (await b.tree()).inboxId, 'From B');
    await a.me.put(`/api/v1/pages/${pa}/tags`, { names: ['Work'] });
    await b.me.put(`/api/v1/pages/${pb}/tags`, { names: ['work'] });
    await connect(a);
    await connect(b);
    await settle(a, b, a, b);
    for (const c of [a, b]) {
      const tree = await c.tree();
      expect(tree.tags).toHaveLength(1);
      const tag = tree.tags![0]!.id;
      for (const id of [pa, pb]) expect(tree.pages.find((x) => x.id === id)?.tags).toEqual([tag]);
    }
  });

  it('gives a project key taken on both computers to the older project', async () => {
    const a = await computer();
    const b = await computer();
    const made = await a.me.post('/api/v1/projects', {
      name: 'Website',
      key: 'WEB',
      color: 'cyan',
    });
    expect(made.statusCode, made.body).toBe(201);
    await b.me.post('/api/v1/projects', { name: 'Web shop', key: 'WEB', color: 'cyan' });
    await connect(a);
    await connect(b);
    await settle(a, b, a, b);
    const keys = async (c: Computer) =>
      c.t.db.prepare('SELECT name, key FROM projects ORDER BY name').all() as {
        name: string;
        key: string;
      }[];
    expect(await keys(a)).toEqual([
      { name: 'Web shop', key: 'WEB2' },
      { name: 'Website', key: 'WEB' },
    ]);
    expect(await keys(b)).toEqual(await keys(a));
  });

  it('syncs boards and cards', async () => {
    const a = await computer();
    const b = await computer();
    const made = (
      await a.me.post('/api/v1/projects', { name: 'Home', key: 'HOME', color: 'cyan' })
    ).json();
    const board = (await a.me.get(`/api/v1/boards/${made.board.id}`)).json();
    const card = (
      await a.me.post('/api/v1/cards', { columnId: board.columns[0].id, title: 'Paint the fence' })
    ).json();
    await connect(a);
    await connect(b);
    await settle(a, b);
    const onB = (await b.me.get(`/api/v1/cards/${card.id}`)).json();
    expect(onB.card).toMatchObject({ title: 'Paint the fence', number: card.number });
    await b.me.post(`/api/v1/cards/${card.id}/move`, {
      columnId: board.columns[1].id,
      beforeId: null,
    });
    await settle(b, a);
    expect((await a.me.get(`/api/v1/cards/${card.id}`)).json().card.columnId).toBe(
      board.columns[1].id,
    );
  });

  it('takes favourites along, but not where you were', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    const p = await page(a, inbox, 'Fav');
    await a.me.patch('/api/v1/settings', {
      ui: { favorites: [{ type: 'page', id: p }], lastSectionId: inbox },
      editor: { lineNumbers: true },
    });
    await connect(a);
    await connect(b);
    await settle(a, b);
    const settings = (await b.me.get('/api/v1/settings')).json();
    expect(settings.ui.favorites).toEqual([{ type: 'page', id: p }]);
    expect(settings.ui.lastSectionId).toBeUndefined();
    expect(settings.editor.lineNumbers).toBe(true);
  });

  it('copes with settings that only hold where you were', async () => {
    const a = await computer();
    const b = await computer();
    await a.me.patch('/api/v1/settings', { ui: { lastSectionId: (await a.tree()).inboxId } });
    await connect(a);
    await connect(b);
    await settle(a, b);
    expect((await b.me.get('/api/v1/settings')).json().ui).toEqual({});
  });

  it('repairs subpages moved into each other on two computers', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    const x = await page(a, inbox, 'X');
    const y = await page(a, inbox, 'Y');
    await connect(a);
    await connect(b);
    await settle(a, b);
    const ax = await a.me.post('/api/v1/pages/move', {
      ids: [x],
      sectionId: inbox,
      parentPageId: y,
      beforeId: null,
    });
    expect(ax.statusCode, ax.body).toBe(200);
    const by = await b.me.post('/api/v1/pages/move', {
      ids: [y],
      sectionId: inbox,
      parentPageId: x,
      beforeId: null,
    });
    expect(by.statusCode, by.body).toBe(200);
    await settle(a, b, a, b);
    for (const c of [a, b]) {
      const pages = (await c.tree()).pages;
      const parents = Object.fromEntries(pages.map((pg) => [pg.id, pg.parentPageId]));
      expect(parents[x] === y && parents[y] === x).toBe(false);
    }
    const parentsA = (await a.tree()).pages.map((pg) => [pg.id, pg.parentPageId]);
    const parentsB = (await b.tree()).pages.map((pg) => [pg.id, pg.parentPageId]);
    expect(parentsB.sort()).toEqual(parentsA.sort());
  });
});

describe('a third computer, and safety', () => {
  it('joins from the snapshot', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    for (let i = 0; i < 5; i += 1) await page(a, inbox, `Page ${i}`, `Text ${i}`);
    await connect(a);
    await connect(b);
    await settle(a, b);
    expect(readdirSync(join(folder, 'snapshots')).length).toBeGreaterThan(0);
    const c = await computer();
    await connect(c);
    await settle(c);
    expect((await c.tree()).pages.map((x) => x.title).sort()).toEqual(
      (await a.tree()).pages.map((x) => x.title).sort(),
    );
  });

  it('joins from a snapshot in several parts, and passes over one that isn’t complete', async () => {
    const a = await computer(2_000);
    const inbox = (await a.tree()).inboxId;
    for (let i = 0; i < 12; i += 1) await page(a, inbox, `Page ${i}`, 'x'.repeat(400));
    await connect(a);
    const parts = readdirSync(join(folder, 'snapshots'));
    expect(parts.length).toBeGreaterThan(2);
    // A snapshot whose last part never arrived: newer, but not used.
    const newer = parts[0]!.replace(/^d{16}/, String(9_000_000_000_000).padStart(16, '0'));
    writeFileSync(
      join(folder, 'snapshots', newer),
      readFileSync(join(folder, 'snapshots', parts[0]!)),
    );
    const c = await computer();
    await connect(c);
    await settle(c);
    expect((await c.tree()).pages.map((x) => x.title).sort()).toEqual(
      (await a.tree()).pages.map((x) => x.title).sort(),
    );
  });

  it('reads a changed batch from a snapshot, or holds back only that computer and says so', async () => {
    const a = await computer();
    const b = await computer();
    await connect(a);
    await connect(b);
    const inbox = (await a.tree()).inboxId;
    await page(a, inbox, 'Secret');
    await a.sync(); // A's first batch, and a snapshot that has it
    const ofA = () =>
      readdirSync(join(folder, 'changes'))
        .filter((n) => n.startsWith(a.t.app.sync.status().device!.id))
        .sort();
    const tamper = (name: string) => {
      const target = join(folder, 'changes', name);
      const data = readFileSync(target);
      data[data.length - 20] = data[data.length - 20]! ^ 0xff;
      writeFileSync(target, data);
    };
    tamper(ofA().at(-1)!);
    await settle(b);
    expect((await b.tree()).pages.map((x) => x.title)).toContain('Secret');

    // No snapshot has the next one: A's changes wait, and the rest goes on.
    await page(a, inbox, 'Second');
    await a.sync();
    tamper(ofA().at(-1)!);
    const status = await b.sync();
    expect(status.lastError?.message).toMatch(/changed by something other than Memora/);
    expect((await b.tree()).pages.map((x) => x.title)).not.toContain('Second');
    await page(b, (await b.tree()).inboxId, 'From B');
    await b.sync();
    await a.sync();
    expect((await a.tree()).pages.map((x) => x.title)).toContain('From B');
  });

  it('never sets up a vault over other files, and never removes them', async () => {
    mkdirSync(join(folder, 'files'));
    const mine = join(folder, 'files', 'tax-return.pdf');
    writeFileSync(mine, 'my own document');
    const a = await computer();
    const refused = await a.me.post('/api/v1/sync/connect', { provider: 'folder', path: folder });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/files in it/);

    // Put there after the vault was made (a sync app's copy, say), and old: still kept.
    rmSync(mine);
    await page(a, (await a.tree()).inboxId, 'Note');
    expect(
      (await a.me.post('/api/v1/sync/connect', { provider: 'folder', path: folder })).statusCode,
    ).toBe(200);
    writeFileSync(mine, 'my own document');
    const old = new Date('2020-01-01');
    utimesSync(mine, old, old);
    expect((await a.me.post('/api/v1/sync/enable', { passphrase: PASSPHRASE })).statusCode).toBe(
      200,
    );
    expect((await a.sync()).lastError).toBeNull();
    expect(readdirSync(join(folder, 'snapshots'))).not.toEqual([]);
    expect(readFileSync(mine, 'utf8')).toBe('my own document');
  });

  it('sends what changed while sync was paused', async () => {
    const a = await computer();
    const b = await computer();
    const p = await page(a, (await a.tree()).inboxId, 'Before');
    await connect(a);
    await connect(b);
    await settle(a, b);
    // A loses its sign-in: sync pauses until it is given again.
    const saved = await a.secrets.load();
    await a.secrets.save({ credentials: null, vaultKey: null, googleClient: null });
    (a.t.app.sync as unknown as { context: unknown }).context = null;
    expect((await a.sync()).paused).toBe('signed_out');
    const renamed = await a.me.patch(`/api/v1/pages/${p}`, { title: 'During the pause' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    await a.secrets.save(saved);
    expect((await a.me.post('/api/v1/sync/resume', {})).statusCode).toBe(200);
    await settle(a, b);
    expect((await b.page(p)).title).toBe('During the pause');
  });

  it('makes tags one tag when the newer one arrives first', async () => {
    const a = await computer();
    const b = await computer();
    await connect(a);
    await connect(b);
    await settle(a, b);
    const pa = await page(a, (await a.tree()).inboxId, 'From A');
    await a.me.put(`/api/v1/pages/${pa}/tags`, { names: ['Work'] });
    b.t.clock.advance(1000);
    const pb = await page(b, (await b.tree()).inboxId, 'From B');
    await b.me.put(`/api/v1/pages/${pb}/tags`, { names: ['work'] });
    // A hears of B's (newer) tag first, then B of A's, and B sends its tag's deletion.
    await b.sync();
    await a.sync();
    await settle(b, a, b, a);
    for (const c of [a, b]) {
      const tree = await c.tree();
      expect(tree.tags).toHaveLength(1);
      const tag = tree.tags![0]!.id;
      for (const id of [pa, pb]) expect(tree.pages.find((x) => x.id === id)?.tags).toEqual([tag]);
    }
  });

  it('keeps no copy of a rich page deleted for good in the same round', async () => {
    const a = await computer();
    const b = await computer();
    const p = await page(a, (await a.tree()).inboxId, 'Letter', rich('v1'), 'rich');
    await connect(a);
    await connect(b);
    await settle(a, b);
    await save(b, p, rich('from B'));
    await save(a, p, rich('from A'));
    await a.sync();
    await a.me.post('/api/v1/pages/delete', { ids: [p] });
    await a.me.post('/api/v1/trash/empty');
    await a.sync();
    await settle(b, a);
    for (const c of [a, b]) {
      expect(c.t.db.prepare('SELECT 1 FROM pages WHERE id = ?').get(p)).toBeUndefined();
    }
  });

  it('lets a later change win over one from a computer whose clock is days ahead', async () => {
    const a = await computer();
    const b = await computer();
    const p = await page(a, (await a.tree()).inboxId, 'Title');
    await connect(a);
    await connect(b);
    await settle(a, b);
    a.t.clock.advance(3 * DAY);
    await a.me.patch(`/api/v1/pages/${p}`, { title: 'From A, days ahead' });
    await a.sync();
    await b.sync();
    await b.me.patch(`/api/v1/pages/${p}`, { title: 'From B, after it' });
    await settle(b, a);
    for (const c of [a, b]) expect((await c.page(p)).title).toBe('From B, after it');
  });

  it('snapshots rows as they were last sent', async () => {
    const a = await computer();
    const inbox = (await a.tree()).inboxId;
    const p = await page(a, inbox, 'Sent');
    await connect(a);
    await a.me.patch(`/api/v1/pages/${p}`, { title: 'Not sent yet' });
    const fresh = await page(a, inbox, 'New');
    const engine = (a.t.app.sync as unknown as { context: { engine: SyncEngine } }).context.engine;
    const { changes } = engine.snapshotPage(null);
    const pages = changes.filter((c) => c.t === 'pages');
    expect(pages.find((c) => c.k[0] === p)?.f?.title).toBe('Sent');
    expect(pages.find((c) => c.k[0] === fresh)).toBeUndefined();
  });

  it('pauses after a restore, and joins again when told', async () => {
    const a = await computer();
    await connect(a);
    a.t.db.prepare("UPDATE app_meta SET value = 'restored-data' WHERE key = 'data_id'").run();
    await a.t.app.sync.stop();
    await a.t.app.sync.start();
    expect(a.t.app.sync.status()).toMatchObject({ state: 'paused', paused: 'restored' });
    const resumed = await a.me.post('/api/v1/sync/resume');
    expect(resumed.json()).toMatchObject({ state: 'on' });
    const status = await a.sync();
    expect(status.lastError).toBeNull();
  });

  it('turns off, leaving the folder for the other computers', async () => {
    const a = await computer();
    await connect(a);
    const off = await a.me.delete('/api/v1/sync');
    expect(off.json()).toMatchObject({ state: 'off' });
    expect(readdirSync(folder)).toContain('memora-vault.json');
    expect((await a.secrets.load()).vaultKey).toBeNull();
    const triggers = a.t.db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'memora_sync_%'",
      )
      .get() as { n: number };
    expect(triggers.n).toBe(0);
  });
});

describe('when computers disagree', () => {
  it('keeps a page deleted for good on one computer deleted, though edited on the other', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    const p = await page(a, inbox, 'Doomed', 'v1');
    await connect(a);
    await connect(b);
    await settle(a, b);
    await a.me.post('/api/v1/pages/delete', { ids: [p] });
    await a.me.post('/api/v1/trash/empty');
    await save(b, p, 'v2 from b');
    await settle(a, b, a, b);
    for (const c of [a, b]) {
      expect(
        c.t.db.prepare('SELECT 1 FROM pages WHERE id = ?').get(p),
        'page gone',
      ).toBeUndefined();
    }
  });

  it('puts a page added in a section deleted elsewhere in the recycle bin with it', async () => {
    const a = await computer();
    const b = await computer();
    const nb = await notebook(a, 'Trips');
    const s = await section(a, nb, 'Italy');
    await connect(a);
    await connect(b);
    await settle(a, b);
    await a.me.delete(`/api/v1/sections/${s}`);
    const p = await page(b, s, 'Rome', 'Colosseum');
    await settle(a, b, a, b);
    for (const c of [a, b]) {
      expect(
        (await c.tree()).pages.map((x) => x.id),
        'not in the tree',
      ).not.toContain(p);
      const row = c.t.db.prepare('SELECT deleted_root_id FROM pages WHERE id = ?').get(p) as
        { deleted_root_id: string } | undefined;
      expect(row?.deleted_root_id).toBe(s);
    }
    // Restoring the section brings the page back, everywhere.
    await a.me.post('/api/v1/trash/restore', { items: [{ type: 'section', id: s }] });
    await settle(a, b);
    expect((await b.tree()).pages.map((x) => x.id)).toContain(p);
  });

  it('waits for a batch a sync app hasn’t delivered yet', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    await connect(a);
    await connect(b);
    await settle(a, b);
    const first = await page(a, inbox, 'First');
    await a.sync();
    const second = await page(a, inbox, 'Second');
    await a.sync();
    const deviceA = a.t.app.sync.status().device!.id;
    const ofA = readdirSync(join(folder, 'changes'))
      .filter((n) => n.startsWith(deviceA))
      .sort();
    const held = ofA.at(-2)!;
    renameSync(join(folder, 'changes', held), join(folder, held));
    await b.sync();
    let titles = (await b.tree()).pages.map((x) => x.title);
    expect(titles).not.toContain('First');
    expect(titles).not.toContain('Second');
    renameSync(join(folder, held), join(folder, 'changes', held));
    await b.sync();
    titles = (await b.tree()).pages.map((x) => x.id);
    expect(titles).toEqual(expect.arrayContaining([first, second]));
  });

  it('catches up from a snapshot when old batches were removed', async () => {
    const a = await computer();
    const b = await computer();
    const inbox = (await a.tree()).inboxId;
    await connect(a);
    await connect(b);
    await settle(a, b);
    for (let i = 0; i < 3; i += 1) {
      await page(a, inbox, `Later ${i}`);
      await a.sync();
    }
    // A week on, A writes a snapshot; its older batches are then removed by hand.
    a.t.clock.advance(8 * DAY);
    await page(a, inbox, 'After the snapshot');
    await a.sync();
    await a.sync();
    const deviceA = a.t.app.sync.status().device!.id;
    const ofA = readdirSync(join(folder, 'changes'))
      .filter((n) => n.startsWith(deviceA))
      .sort();
    for (const name of ofA.slice(0, -1)) rmSync(join(folder, 'changes', name));
    const status = await b.sync();
    expect(status.lastError).toBeNull();
    expect((await b.tree()).pages.map((x) => x.title).sort()).toEqual(
      (await a.tree()).pages.map((x) => x.title).sort(),
    );
  });

  it('keeps card numbers unique in a project', async () => {
    const a = await computer();
    const b = await computer();
    const made = (
      await a.me.post('/api/v1/projects', { name: 'Ops', key: 'OPS', color: 'cyan' })
    ).json();
    const board = (await a.me.get(`/api/v1/boards/${made.board.id}`)).json();
    await connect(a);
    await connect(b);
    await settle(a, b);
    const column = board.columns[0].id;
    await a.me.post('/api/v1/cards', { columnId: column, title: 'From A' });
    await b.me.post('/api/v1/cards', { columnId: column, title: 'From B' });
    await settle(a, b, a, b);
    const numbers = (c: Computer) =>
      c.t.db.prepare('SELECT title, number FROM cards ORDER BY title').all() as {
        title: string;
        number: number;
      }[];
    const onA = numbers(a);
    expect(new Set(onA.map((c) => c.number)).size).toBe(onA.length);
    expect(numbers(b)).toEqual(onA);
  });
});
