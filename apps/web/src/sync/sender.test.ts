import type { PageMeta, TreeChanges } from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../lib/api';
import { fromServer, settle, type PageRecord } from './records';
import { Sender, type SenderHost } from './sender';
import { initialShared, type Shared } from './status';
import { MemoryStore } from './store';

/** Enough of the server for saving content. */
class FakeServer {
  pages = new Map<string, { revision: number; content: string }>();
  versions: { pageId: string; content: string }[] = [];
  created: Record<string, unknown>[] = [];
  down = false;
  log: string[] = [];

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    if (this.down) throw new TypeError('Failed to fetch');
    const path = url.replace('/api/v1', '');
    const body = init.body ? JSON.parse(String(init.body)) : {};
    this.log.push(`${init.method} ${path}`);
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    const error = (status: number, code: string, details?: unknown) =>
      json(status, { error: { code, message: code, details } });

    let m = path.match(/^\/pages\/([^/]+)\/content$/);
    if (m && init.method === 'PUT') {
      const page = this.pages.get(m[1]!);
      if (!page) return error(404, 'not_found');
      if (body.content.length > 50) return error(400, 'invalid_request');
      if (body.content === page.content) return json(200, this.saved(m[1]!));
      if (body.baseRevision !== page.revision) {
        return error(409, 'revision_conflict', { ...page, type: 'markdown' });
      }
      page.content = body.content;
      page.revision += 1;
      return json(200, this.saved(m[1]!));
    }
    m = path.match(/^\/pages\/([^/]+)\/versions$/);
    if (m) {
      if (!this.pages.has(m[1]!)) return error(404, 'not_found');
      this.versions.push({ pageId: m[1]!, content: body.content });
      return json(201, {});
    }
    if (path === '/pages') {
      if (body.sectionId === 'gone') return error(404, 'not_found');
      this.created.push(body);
      this.pages.set(body.id, { revision: 1, content: body.content ?? '' });
      return json(201, { pages: [meta(body.id, body.title ?? '')] });
    }
    return error(404, 'not_found');
  };

  private saved(id: string) {
    const page = this.pages.get(id)!;
    return { revision: page.revision, pages: [{ ...meta(id, ''), revision: page.revision }] };
  }
}

const meta = (id: string, title: string): PageMeta => ({
  id,
  sectionId: 'inbox',
  parentPageId: null,
  title,
  type: 'markdown',
  sortKey: 'a0',
  snippet: '',
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
});

let server: FakeServer;
let store: MemoryStore;
let shared: Shared;
let host: SenderHost & { tree: TreeChanges[]; notices: string[]; confirmedIds: string[] };
let sender: Sender;

beforeEach(() => {
  server = new FakeServer();
  vi.stubGlobal('fetch', server.fetch);
  setCsrfToken('token');
  store = new MemoryStore();
  shared = { ...initialShared };
  host = {
    store,
    tree: [],
    notices: [],
    confirmedIds: [],
    changed: () => {},
    confirmed: (id) => host.confirmedIds.push(id),
    applyTree: (changes) => host.tree.push(changes),
    inboxId: () => 'inbox',
    titleOf: () => 'Plans',
    ensureSession: async () => {},
    setShared: (patch) => {
      shared = { ...shared, ...patch };
    },
    shared: () => shared,
    recovered: (title) => host.notices.push(`recovered ${title}`),
    failed: (message) => host.notices.push(message),
  };
  sender = new Sender(host);
});
afterEach(() => {
  sender.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A page the server has at revision 1, edited here to `content`. */
async function editedPage(id: string, serverText: string, content: string) {
  server.pages.set(id, { revision: 1, content: serverText });
  await store.update(id, () =>
    settle({
      ...fromServer(id, { revision: 1, content: serverText, type: 'markdown' }, 0),
      content,
    }),
  );
}

const record = (id: string) => store.get(id) as Promise<PageRecord>;

describe('the sender', () => {
  it('sends a changed page and takes in the new revision', async () => {
    await editedPage('p1', 'Hi', 'Hello');
    await sender.kick();
    expect(server.pages.get('p1')).toEqual({ revision: 2, content: 'Hello' });
    expect(await record('p1')).toMatchObject({ revision: 2, base: 'Hello', dirty: 0 });
    expect(host.confirmedIds).toEqual(['p1']);
    expect(shared).toMatchObject({ pending: 0, counted: true, saving: [], reachable: true });
  });

  it('merges with a newer version from elsewhere and sends the merge', async () => {
    await editedPage('p1', 'one\ntwo\n', 'one\ntwo\nthree\n');
    server.pages.set('p1', { revision: 2, content: 'ONE\ntwo\n' });
    await sender.kick();
    expect(server.pages.get('p1')).toEqual({ revision: 3, content: 'ONE\ntwo\nthree\n' });
    expect(await record('p1')).toMatchObject({ revision: 3, dirty: 0 });
  });

  it('keeps both sides of an overlapping edit, sending nothing over the other', async () => {
    await editedPage('p1', 'Take the tent', 'Take the hammock');
    server.pages.set('p1', { revision: 2, content: 'Take the bivvy' });
    await sender.kick();
    expect(server.pages.get('p1')!.content).toBe('Take the bivvy');
    expect(server.versions).toEqual([{ pageId: 'p1', content: 'Take the hammock' }]);
    const conflicted = await record('p1');
    expect(conflicted.conflict).toMatchObject({ revision: 2, content: 'Take the bivvy' });
    expect(conflicted.conflict!.kept).toBe(conflicted.writeId);
    expect(shared.conflicts).toEqual(['p1']);
    // Kept once, not on every round.
    await sender.kick();
    expect(server.versions).toHaveLength(1);
  });

  it('keeps the text of a page deleted elsewhere as a new page in the Inbox', async () => {
    await editedPage('p1', 'Hi', 'Hello');
    server.pages.delete('p1');
    await sender.kick();
    expect(await store.get('p1')).toBeUndefined();
    const [created] = server.created;
    expect(created).toMatchObject({ sectionId: 'inbox', title: 'Plans (recovered)' });
    expect(server.pages.get(String(created!.id))).toEqual({ revision: 2, content: 'Hello' });
    expect(host.notices).toEqual(['recovered Plans']);
  });

  it('waits and tries again while the server can’t be reached', async () => {
    vi.useFakeTimers();
    await editedPage('p1', 'Hi', 'Hello');
    server.down = true;
    await sender.kick();
    expect(shared).toMatchObject({ reachable: false, pending: 1 });
    expect(await record('p1')).toMatchObject({ content: 'Hello', dirty: 1 });
    server.down = false;
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.pages.get('p1')!.content).toBe('Hello');
    expect(shared).toMatchObject({ reachable: true, pending: 0 });
  });

  it('backs off further with each failure, up to 30 seconds', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await editedPage('p1', 'Hi', 'Hello');
    let tries = 0;
    server.fetch = async () => {
      tries += 1;
      throw new TypeError('Failed to fetch');
    };
    vi.stubGlobal('fetch', server.fetch);
    await sender.kick();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = tries;
      let waited = 0;
      while (tries === before) {
        await vi.advanceTimersByTimeAsync(250);
        waited += 250;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('sends a change that arrives while it finishes a round', async () => {
    await editedPage('p1', 'Hi', 'Hello');
    const counts = store.counts.bind(store);
    let arrived = false;
    // The change is stored, and the sender asked, while it counts after sending.
    vi.spyOn(store, 'counts').mockImplementation(async () => {
      if (!arrived && server.pages.get('p1')!.content === 'Hello') {
        arrived = true;
        await store.update('p1', (r) => r && { ...r, content: 'Hello again', writeId: 'w2' });
        void sender.kick();
      }
      return counts();
    });
    await sender.kick();
    await vi.waitFor(async () => expect(await record('p1')).toMatchObject({ dirty: 0 }));
    expect(server.pages.get('p1')!.content).toBe('Hello again');
  });

  it('creates pages made offline before sending their content', async () => {
    const id = '0199a000-0000-7000-8000-000000000001';
    await store.addOp({
      kind: 'createPage',
      body: { id, sectionId: 'inbox', title: 'Offline' },
      meta: meta(id, 'Offline'),
    });
    await store.update(id, () =>
      settle({
        ...fromServer(id, { revision: 1, content: '', type: 'markdown' }, 0),
        content: 'Hi',
      }),
    );
    await sender.kick();
    expect(server.log).toEqual(['POST /pages', `PUT /pages/${id}/content`]);
    expect(server.pages.get(id)).toEqual({ revision: 2, content: 'Hi' });
    expect(await store.ops()).toEqual([]);
  });

  it('puts a page made offline in the Inbox when its section went meanwhile', async () => {
    const id = '0199a000-0000-7000-8000-000000000002';
    await store.addOp({
      kind: 'createPage',
      body: { id, sectionId: 'gone', title: 'Offline' },
      meta: meta(id, 'Offline'),
    });
    await sender.kick();
    expect(server.created).toEqual([expect.objectContaining({ id, sectionId: 'inbox' })]);
  });

  it('stops sending a page the server refuses until it changes', async () => {
    await editedPage('p1', 'Hi', 'x'.repeat(60));
    await sender.kick();
    await sender.kick();
    expect(server.log.filter((l) => l.startsWith('PUT'))).toHaveLength(1);
    expect(shared.refused).toEqual({ p1: (await record('p1')).writeId });
    expect(host.notices).toHaveLength(1);
    await store.update('p1', (r) => r && { ...r, content: 'Short', writeId: 'new' });
    await sender.kick();
    expect(server.pages.get('p1')!.content).toBe('Short');
  });

  it('marks a save that settles a conflict', async () => {
    await editedPage('p1', 'Hi', 'Mine');
    await store.update('p1', (r) => r && { ...r, resolving: true });
    const bodies: unknown[] = [];
    const inner = server.fetch;
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return inner(url, init);
    });
    await sender.kick();
    expect(bodies).toEqual([{ baseRevision: 1, content: 'Mine', resolving: true }]);
    expect((await record('p1')).resolving).toBeUndefined();
  });
});
