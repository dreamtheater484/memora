import {
  type ContentSaved,
  type PageVersion,
  type PageVersionMeta,
  type TrashList,
  type Tree,
  type TreeChanges,
  type VersionKept,
} from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanUnusedAssets } from '../assets/cleanup';
import { pngOf } from '../test/images';
import {
  DAY,
  HOUR,
  STRONG_PASSWORD,
  createTestApp,
  type Client,
  type TestApp,
} from '../test/harness';

/* Version history and the recycle bin (§9.7). */

let t: TestApp;
let me: Client;
let inboxId: string;

beforeEach(async () => {
  t = await createTestApp();
  me = await t.setupAdmin('alex');
  inboxId = ((await me.get('/api/v1/tree')).json() as Tree).inboxId;
});
afterEach(async () => {
  await t.close();
});

async function newPage(title = 'Plans', sectionId = inboxId): Promise<string> {
  return ((await me.post('/api/v1/pages', { sectionId, title })).json() as TreeChanges).pages![0]!
    .id;
}

async function save(id: string, content: string): Promise<number> {
  const page = (await me.get(`/api/v1/pages/${id}`)).json() as { revision: number };
  const res = await me.put(`/api/v1/pages/${id}/content`, { baseRevision: page.revision, content });
  expect(res.statusCode).toBe(200);
  return (res.json() as ContentSaved).revision;
}

const versions = async (id: string) =>
  (await me.get(`/api/v1/pages/${id}/versions`)).json() as PageVersionMeta[];

describe('version history', () => {
  it('keeps versions by hand (named or not) and as edited pages close, without repeats', async () => {
    const id = await newPage();
    await save(id, 'First draft');
    const named = await me.post(`/api/v1/pages/${id}/versions`, {
      reason: 'manual',
      name: 'Before the rewrite',
    });
    expect(named.statusCode).toBe(201);
    expect((named.json() as VersionKept).version).toMatchObject({
      reason: 'manual',
      name: 'Before the rewrite',
      size: 'First draft'.length,
      type: 'markdown',
    });
    // Closing the page right after: the same content is already kept.
    const again = await me.post(`/api/v1/pages/${id}/versions`, { reason: 'auto' });
    expect(again.statusCode).toBe(200);
    expect((again.json() as VersionKept).version).toBeNull();
    t.clock.advance(HOUR);
    await save(id, 'Second draft');
    const closed = await me.post(`/api/v1/pages/${id}/versions`, { reason: 'auto' });
    expect((closed.json() as VersionKept).version).toMatchObject({ reason: 'auto' });
    const list = await versions(id);
    // The middle one is the save's own: the last version was over ten minutes old.
    expect(list.map((v) => [v.reason, v.name])).toEqual([
      ['auto', null],
      ['auto', null],
      ['manual', 'Before the rewrite'],
    ]);
    const full = (
      await me.get(`/api/v1/pages/${id}/versions/${list[2]!.id}`)
    ).json() as PageVersion;
    expect(full).toMatchObject({ content: 'First draft', title: 'Plans' });
  });

  it('names and unnames versions', async () => {
    const id = await newPage();
    await save(id, 'Text');
    const { version } = (
      await me.post(`/api/v1/pages/${id}/versions`, { reason: 'manual' })
    ).json() as VersionKept;
    const named = await me.patch(`/api/v1/pages/${id}/versions/${version!.id}`, {
      name: 'Keep me',
    });
    expect(named.json()).toMatchObject({ name: 'Keep me' });
    const cleared = await me.patch(`/api/v1/pages/${id}/versions/${version!.id}`, { name: null });
    expect(cleared.json()).toMatchObject({ name: null });
    expect(
      (await me.patch(`/api/v1/pages/${id}/versions/${version!.id}`, { name: '' })).statusCode,
    ).toBe(400);
  });

  it('restores a version, keeping what it replaces, so a restore can be undone', async () => {
    const id = await newPage();
    await save(id, 'Old text');
    const { version } = (
      await me.post(`/api/v1/pages/${id}/versions`, { reason: 'manual' })
    ).json() as VersionKept;
    const revision = await save(id, 'New text');
    const res = await me.post(`/api/v1/pages/${id}/versions/${version!.id}/restore`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as ContentSaved).revision).toBe(revision + 1);
    expect((await me.get(`/api/v1/pages/${id}`)).json()).toMatchObject({ content: 'Old text' });
    const list = await versions(id);
    expect(list[0]).toMatchObject({ reason: 'restore', size: 'New text'.length });
    // Undo: restore the version the restore kept.
    await me.post(`/api/v1/pages/${id}/versions/${list[0]!.id}/restore`);
    expect((await me.get(`/api/v1/pages/${id}`)).json()).toMatchObject({ content: 'New text' });
  });

  it('restores a version as a copy, right after the page', async () => {
    const id = await newPage('Budget');
    await save(id, 'Numbers from March');
    const { version } = (
      await me.post(`/api/v1/pages/${id}/versions`, { reason: 'manual' })
    ).json() as VersionKept;
    const copy = await me.post(`/api/v1/pages/${id}/versions/${version!.id}/copy`);
    expect(copy.statusCode).toBe(201);
    const created = (copy.json() as TreeChanges).pages![0]!;
    expect(created.title).toMatch(/^Budget \(2026-01-01 \d\d:\d\d\)$/);
    expect((await me.get(`/api/v1/pages/${created.id}`)).json()).toMatchObject({
      content: 'Numbers from March',
    });
    const { pages } = (await me.get('/api/v1/tree')).json() as Tree;
    const inbox = pages
      .filter((p) => p.sectionId === inboxId)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    expect(inbox.map((p) => p.id)).toEqual([id, created.id]);
  });

  it('thins old versions by the retention rules, keeping named ones', async () => {
    const id = await newPage();
    for (let i = 0; i < 6; i += 1) {
      await save(id, `Draft ${i}`);
      await me.post(`/api/v1/pages/${id}/versions`, {
        reason: 'manual',
        ...(i === 0 ? { name: 'The first' } : {}),
      });
      t.clock.advance(5 * 60_000);
    }
    t.clock.advance(10 * DAY);
    // The maintenance job runs this every six hours.
    const { NotesService } = await import('../notes/service');
    const { createOrm } = await import('../repo');
    const service = new NotesService(t.db, createOrm(t.db), t.clock.now);
    const thinned = service.thinVersions(t.config.historyRetention);
    expect(thinned).toBe(4);
    expect((await versions(id)).map((v) => v.name ?? v.reason)).toEqual(['manual', 'The first']);
  });

  it('refuses another user’s versions', async () => {
    const id = await newPage();
    await save(id, 'Mine');
    const { version } = (
      await me.post(`/api/v1/pages/${id}/versions`, { reason: 'manual' })
    ).json() as VersionKept;
    const created = await me.post('/api/v1/admin/users', { username: 'bob', displayName: 'Bob' });
    const bob = t.client();
    await bob.login('bob', created.json().temporaryPassword);
    await bob.post('/api/v1/auth/password', {
      currentPassword: created.json().temporaryPassword,
      newPassword: STRONG_PASSWORD,
    });
    expect((await bob.get(`/api/v1/pages/${id}/versions/${version!.id}`)).statusCode).toBe(404);
  });
});

describe('the recycle bin', () => {
  const trash = async () => (await me.get('/api/v1/trash')).json() as TrashList;

  it('lists what was deleted, where it was and when it goes', async () => {
    const nb = (await me.post('/api/v1/notebooks', { name: 'Work', color: 'blue' })).json()
      .notebooks[0].id;
    const section = (
      await me.post('/api/v1/sections', { notebookId: nb, name: 'Plans', color: 'blue' })
    ).json().sections[0].id;
    const page = await newPage('Roadmap', section);
    await newPage('Sub', section);
    await me.post('/api/v1/pages/delete', { ids: [page] });
    t.clock.advance(HOUR);
    await me.delete(`/api/v1/sections/${section}`);
    const list = await trash();
    expect(list.days).toBe(30);
    expect(list.entries.map((e) => [e.type, e.name, e.location, e.pages, e.restorable])).toEqual([
      ['section', 'Plans', ['Work'], 1, true],
      ['page', 'Roadmap', ['Work', 'Plans'], 1, false],
    ]);
    expect(list.entries[1]!.purgeAt - list.entries[1]!.deletedAt).toBe(30 * DAY);
  });

  it('restores an item into a new place when its own is gone', async () => {
    const nb = (await me.post('/api/v1/notebooks', { name: 'Work', color: 'blue' })).json()
      .notebooks[0].id;
    const section = (
      await me.post('/api/v1/sections', { notebookId: nb, name: 'Plans', color: 'blue' })
    ).json().sections[0].id;
    const page = await newPage('Roadmap', section);
    await me.post('/api/v1/pages/delete', { ids: [page] });
    await me.delete(`/api/v1/sections/${section}`);
    const back = await me.post('/api/v1/trash/restore', { items: [{ type: 'page', id: page }] });
    expect(back.statusCode).toBe(409);
    const moved = await me.post('/api/v1/trash/restore-to', {
      item: { type: 'page', id: page },
      to: { sectionId: inboxId },
    });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as TreeChanges).pages![0]).toMatchObject({ id: page, sectionId: inboxId });
    expect((await me.get(`/api/v1/pages/${page}`)).statusCode).toBe(200);
    // A section needs a notebook.
    expect(
      (
        await me.post('/api/v1/trash/restore-to', {
          item: { type: 'section', id: section },
          to: {},
        })
      ).statusCode,
    ).toBe(400);
  });

  it('deletes for good, and empties the bin', async () => {
    const a = await newPage('A');
    const b = await newPage('B');
    await save(a, 'Some text');
    await me.post(`/api/v1/pages/${a}/versions`, { reason: 'manual' });
    await me.post('/api/v1/pages/delete', { ids: [a, b] });
    const gone = await me.post('/api/v1/trash/delete', { items: [{ type: 'page', id: a }] });
    expect(gone.json()).toEqual({ removed: 1 });
    expect(t.db.prepare('SELECT count(*) AS n FROM page_versions').get()).toEqual({ n: 0 });
    expect((await trash()).entries.map((e) => e.name)).toEqual(['B']);
    expect((await me.post('/api/v1/trash/empty')).json()).toEqual({ removed: 1 });
    expect((await trash()).entries).toEqual([]);
    expect(
      (await me.post('/api/v1/trash/delete', { items: [{ type: 'page', id: b }] })).statusCode,
    ).toBe(404);
  });

  it('purges old items, and then files nothing uses', async () => {
    const id = await newPage();
    const { uuidv7 } = await import('@memora/shared');
    const asset = uuidv7();
    await me.put(`/api/v1/assets/${asset}?name=shot.png`, pngOf(10, 10), {
      headers: { 'content-type': 'image/png' },
    });
    await save(id, `![shot](asset:${asset})`);
    t.clock.advance(2 * DAY);
    // Still used by the page: kept.
    expect(cleanUnusedAssets(t.db, t.clock.now())).toBe(0);
    await me.post('/api/v1/pages/delete', { ids: [id] });
    // In the bin, the page still uses it.
    expect(cleanUnusedAssets(t.db, t.clock.now())).toBe(0);
    t.clock.advance(31 * DAY);
    const { NotesService } = await import('../notes/service');
    const { createOrm } = await import('../repo');
    const service = new NotesService(t.db, createOrm(t.db), t.clock.now);
    expect(service.purgeExpired(t.clock.now() - t.config.trashMs).removed).toBe(1);
    expect(cleanUnusedAssets(t.db, t.clock.now())).toBe(1);
    expect(t.db.prepare('SELECT count(*) AS n FROM assets').get()).toEqual({ n: 0 });
    expect(t.db.prepare('SELECT count(*) AS n FROM asset_blobs').get()).toEqual({ n: 0 });
  });
});
