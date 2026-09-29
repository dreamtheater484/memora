import {
  MAX_CONTENT,
  uuidv7,
  type ContentConflict,
  type ContentSaved,
  type Page,
  type Tree,
} from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRONG_PASSWORD, createTestApp, type Client, type TestApp } from '../test/harness';

let t: TestApp;
let me: Client;
let pageId: string;

beforeEach(async () => {
  t = await createTestApp();
  me = await t.setupAdmin('alex');
  const { inboxId } = (await me.get('/api/v1/tree')).json() as Tree;
  pageId = (await me.post('/api/v1/pages', { sectionId: inboxId, title: 'Plans' })).json().pages[0]
    .id;
});
afterEach(async () => {
  await t.close();
});

const save = (baseRevision: number, content: string, extra: object = {}) =>
  me.put(`/api/v1/pages/${pageId}/content`, { baseRevision, content, ...extra });
const page = async (): Promise<Page> => (await me.get(`/api/v1/pages/${pageId}`)).json();
const versions = () =>
  t.db
    .prepare(
      'SELECT revision, reason, content, device_label AS device FROM page_versions ORDER BY created_at, id',
    )
    .all() as { revision: number; reason: string; content: string; device: string }[];

describe('saving content', () => {
  it('saves on the current revision and answers the next one', async () => {
    const res = await save(1, '# Plans\n\nShip it.');
    expect(res.statusCode).toBe(200);
    const saved = res.json() as ContentSaved;
    expect(saved.revision).toBe(2);
    expect(saved.pages[0]).toMatchObject({ id: pageId, revision: 2, snippet: 'Plans Ship it.' });
    expect(await page()).toMatchObject({ content: '# Plans\n\nShip it.', revision: 2 });
    const { pages } = (await me.get('/api/v1/tree')).json() as Tree;
    expect(pages.find((p) => p.id === pageId)).toMatchObject({ revision: 2 });
  });

  it('refuses a save based on an old revision, with what the server has', async () => {
    await save(1, 'From the laptop');
    const res = await save(1, 'From the phone');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('revision_conflict');
    expect(res.json().error.details).toEqual({
      revision: 2,
      content: 'From the laptop',
      type: 'markdown',
    } satisfies ContentConflict);
    expect((await page()).content).toBe('From the laptop');
  });

  it('takes a repeated save (after a lost answer) without a conflict or a new revision', async () => {
    await save(1, 'Once');
    const again = await save(1, 'Once');
    expect(again.statusCode).toBe(200);
    expect(again.json().revision).toBe(2);
    expect((await page()).revision).toBe(2);
  });

  it('checks the content', async () => {
    expect((await save(0, 'x')).statusCode).toBe(400);
    expect((await save(1, 'x'.repeat(MAX_CONTENT + 1))).statusCode).toBe(400);
    const deleted = await me.post('/api/v1/pages/delete', { ids: [pageId] });
    expect(deleted.statusCode).toBe(200);
    expect((await save(1, 'Too late')).statusCode).toBe(404);
  });

  it('takes a large page', async () => {
    const big = 'Lorem ipsum dolor sit amet. '.repeat(40_000);
    expect((await save(1, big)).statusCode).toBe(200);
    expect((await page()).content).toHaveLength(big.length);
  });
});

describe('versions', () => {
  it('keeps the replaced content now and then (every 10 minutes at most)', async () => {
    await save(1, 'First draft'); // replaces an empty page: nothing to keep
    await save(2, 'Second draft');
    await save(3, 'Third draft'); // within 10 minutes of the last version
    t.clock.advance(11 * 60_000);
    await save(4, 'Fourth draft');
    // Test requests carry no browser in their user agent.
    expect(versions()).toEqual([
      { revision: 2, reason: 'auto', content: 'First draft', device: 'Browser' },
      { revision: 4, reason: 'auto', content: 'Third draft', device: 'Browser' },
    ]);
  });

  it('always keeps what a conflict resolution replaces', async () => {
    await save(1, 'Theirs');
    await save(2, 'Mine', { resolving: true });
    expect(versions()).toEqual([
      expect.objectContaining({ revision: 2, reason: 'conflict', content: 'Theirs' }),
    ]);
  });

  it('keeps the browser’s side of a conflict, labelled with its device', async () => {
    const phone = t.client({
      'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile',
    });
    await phone.login('alex', STRONG_PASSWORD);
    const res = await phone.post(`/api/v1/pages/${pageId}/versions`, {
      reason: 'conflict',
      content: 'Written on the train',
      baseRevision: 1,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().version).toMatchObject({ pageId, revision: 1, reason: 'conflict' });
    expect(versions()).toEqual([
      {
        revision: 1,
        reason: 'conflict',
        content: 'Written on the train',
        device: 'Chrome on Android',
      },
    ]);
    const bad = await me.post(`/api/v1/pages/${pageId}/versions`, {
      reason: 'restore',
      content: 'x',
      baseRevision: 1,
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('pages made in the browser', () => {
  it('keep the id they were given, and a repeated request makes no second page', async () => {
    const { inboxId } = (await me.get('/api/v1/tree')).json() as Tree;
    const id = uuidv7();
    const body = { id, sectionId: inboxId, title: 'Written offline' };
    const first = await me.post('/api/v1/pages', body);
    expect(first.statusCode).toBe(201);
    expect(first.json().pages[0]).toMatchObject({ id, title: 'Written offline', revision: 1 });
    const again = await me.post('/api/v1/pages', body);
    expect(again.json().pages[0].id).toBe(id);
    const { pages } = (await me.get('/api/v1/tree')).json() as Tree;
    expect(pages.filter((p) => p.title === 'Written offline')).toHaveLength(1);
  });

  it('can’t take an id another user has', async () => {
    const created = await me.post('/api/v1/admin/users', { username: 'sam', displayName: 'Sam' });
    const sam = t.client();
    await sam.login('sam', created.json().temporaryPassword);
    await sam.post('/api/v1/auth/password', {
      currentPassword: created.json().temporaryPassword,
      newPassword: STRONG_PASSWORD,
    });
    const { inboxId } = (await sam.get('/api/v1/tree')).json() as Tree;
    const res = await sam.post('/api/v1/pages', { id: pageId, sectionId: inboxId });
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).not.toContain('Plans');
    expect((await page()).title).toBe('Plans');
  });
});

describe('rich pages and conversion', () => {
  const richDoc = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plans' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Ship it.' }] },
    ],
  });
  const convert = (body: object) => me.post(`/api/v1/pages/${pageId}/convert`, body);

  it('converts a page, keeping what it replaces as a version', async () => {
    await save(1, '# Plans\n\nShip it.');
    const res = await convert({ type: 'rich', content: richDoc, baseRevision: 2 });
    expect(res.statusCode).toBe(200);
    const saved = res.json() as ContentSaved;
    expect(saved.revision).toBe(3);
    expect(saved.pages[0]).toMatchObject({ type: 'rich', snippet: 'Plans Ship it.' });
    expect(await page()).toMatchObject({ type: 'rich', content: richDoc, revision: 3 });
    expect(versions()).toEqual([
      {
        revision: 2,
        reason: 'conversion',
        content: '# Plans\n\nShip it.',
        device: expect.any(String),
      },
    ]);
    // And back.
    const back = await convert({ type: 'markdown', content: '# Plans', baseRevision: 3 });
    expect(back.statusCode).toBe(200);
    expect(await page()).toMatchObject({ type: 'markdown', content: '# Plans', revision: 4 });
    expect(versions().map((v) => v.reason)).toEqual(['conversion', 'conversion']);
  });

  it('refuses a conversion based on an old revision, or to the same type', async () => {
    await save(1, 'Changed meanwhile');
    const stale = await convert({ type: 'rich', content: richDoc, baseRevision: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('revision_conflict');
    const same = await convert({ type: 'markdown', content: 'x', baseRevision: 2 });
    expect(same.statusCode).toBe(409);
    expect((await page()).type).toBe('markdown');
    expect(versions()).toEqual([]);
  });

  it('only stores documents on rich pages', async () => {
    const bad = await convert({ type: 'rich', content: '# Not JSON', baseRevision: 1 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_content');
    expect((await convert({ type: 'rich', content: '', baseRevision: 1 })).statusCode).toBe(200);
    expect((await save(2, '{"type":"paragraph"}')).json().error.code).toBe('invalid_content');
    const saved = await save(2, richDoc);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().pages[0].snippet).toBe('Plans Ship it.');
  });
});
