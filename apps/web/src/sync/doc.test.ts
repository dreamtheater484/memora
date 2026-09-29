import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../lib/api';
import { PageDoc, type DocEditor, type DocHost, type DocSnapshot } from './doc';
import { fromServer, settle } from './records';
import { Sender } from './sender';
import { initialShared, type Shared } from './status';
import { MemoryStore, type LocalStore } from './store';

/** The server's copy of page p1. */
let serverPage: { revision: number; content: string } | null;
const puts: string[] = [];

const respond = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  if (!serverPage) return respond(404, { error: { code: 'not_found', message: 'Not found.' } });
  if (init.method === 'PUT') {
    const body = JSON.parse(String(init.body));
    puts.push(body.content);
    serverPage = { revision: serverPage.revision + 1, content: body.content };
    return respond(200, { revision: serverPage.revision, pages: [{ id: 'p1' }] });
  }
  if (url.endsWith('/pages/p1')) {
    return respond(200, { id: 'p1', type: 'markdown', ...serverPage });
  }
  return respond(404, { error: { code: 'not_found', message: 'Not found.' } });
}

class TestHost implements DocHost {
  kicks = 0;
  announced = 0;
  notices: string[] = [];
  storageErrors: unknown[] = [];
  readonly tabId = 'tab-a';
  readonly sender: Sender;
  shared: Shared = { ...initialShared };

  constructor(readonly store: LocalStore) {
    this.sender = new Sender({
      store,
      changed: () => {},
      confirmed: () => {},
      applyTree: () => {},
      inboxId: () => 'inbox',
      titleOf: () => 'Page',
      ensureSession: async () => {},
      setShared: (patch) => {
        this.shared = { ...this.shared, ...patch };
      },
      shared: () => this.shared,
      recovered: () => {},
      failed: () => {},
    });
  }

  kick() {
    this.kicks += 1;
  }
  announce() {
    this.announced += 1;
  }
  storageFailed(error: unknown) {
    this.storageErrors.push(error);
  }
  notify(message: string) {
    this.notices.push(message);
  }
  reached() {}
  unreachable() {}
}

/** An editor stand-in: its text, and what arrived from elsewhere. */
class FakeEditor implements DocEditor {
  received: string[] = [];
  constructor(
    private readonly doc: PageDoc,
    public text: string,
  ) {}
  set(text: string) {
    this.text = text;
    this.received.push(text);
  }
  type(text: string) {
    this.text = text;
    this.doc.edited(() => this.text, this);
  }
}

let store: MemoryStore;
let host: TestHost;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fakeFetch);
  setCsrfToken('token');
  serverPage = { revision: 1, content: 'Hello' };
  puts.length = 0;
  store = new MemoryStore();
  host = new TestHost(store);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function openDoc() {
  const doc = new PageDoc('p1', host);
  await doc.load();
  const editor = new FakeEditor(doc, doc.content());
  doc.attach(editor);
  return { doc, editor };
}

describe('a page open in a tab', () => {
  it('loads the server’s version and keeps it on the device', async () => {
    const { doc } = await openDoc();
    expect(doc.getSnapshot()).toMatchObject({ state: 'ready', unpersisted: false });
    expect(doc.content()).toBe('Hello');
    expect(await store.get('p1')).toMatchObject({ revision: 1, content: 'Hello', dirty: 0 });
  });

  it('shows what this device has, and still takes in a newer server version', async () => {
    await store.update('p1', () =>
      settle({
        ...fromServer('p1', { revision: 1, content: 'one\ntwo\n', type: 'markdown' }, 0),
        content: 'one\ntwo\nthree\n',
      }),
    );
    serverPage = { revision: 2, content: 'ONE\ntwo\n' };
    const { doc } = await openDoc();
    expect(doc.content()).toBe('ONE\ntwo\nthree\n');
    expect(await store.get('p1')).toMatchObject({ revision: 2, base: 'ONE\ntwo\n', dirty: 1 });
  });

  it('says when a page can’t open offline', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const doc = new PageDoc('p1', host);
    await doc.load();
    expect(doc.getSnapshot().state).toBe('unavailable');
    serverPage = null;
    vi.stubGlobal('fetch', fakeFetch);
    const gone = new PageDoc('p1', host);
    await gone.load();
    expect(gone.getSnapshot().state).toBe('missing');
  });

  it('stores typing within 300 ms, and asks for a save a second after the last keystroke', async () => {
    const { doc, editor } = await openDoc();
    editor.type('Hello w');
    expect(doc.getSnapshot().unpersisted).toBe(true);
    await vi.advanceTimersByTimeAsync(299);
    expect((await store.get('p1'))!.content).toBe('Hello');
    await vi.advanceTimersByTimeAsync(1);
    expect(await store.get('p1')).toMatchObject({ content: 'Hello w', dirty: 1, writer: 'tab-a' });
    expect(doc.getSnapshot().unpersisted).toBe(false);
    expect(host.kicks).toBe(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(host.kicks).toBe(1);
  });

  it('hands over text not stored yet as the tab goes, and nothing once stored', async () => {
    const { doc, editor } = await openDoc();
    expect(doc.unstored()).toBeNull();
    editor.type('Hello w');
    expect(doc.unstored()).toMatchObject({
      text: 'Hello w',
      known: { content: 'Hello' },
      revision: 1,
      base: 'Hello',
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(doc.unstored()).toBeNull();
  });

  it('asks for a save at least every 5 seconds while typing goes on', async () => {
    const { editor } = await openDoc();
    for (let i = 0; i < 12; i++) {
      editor.type(`Hello ${'x'.repeat(i)}`);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(host.kicks).toBe(1);
  });

  it('stores and sends at once when asked (Ctrl+S, leaving the page)', async () => {
    const { doc, editor } = await openDoc();
    editor.type('Hello there');
    await doc.flush();
    expect((await store.get('p1'))!.content).toBe('Hello there');
    expect(host.kicks).toBe(1);
  });

  it('takes in text changed elsewhere, merged with what was just typed here', async () => {
    const { doc, editor } = await openDoc();
    await store.update(
      'p1',
      (r) => r && { ...r, content: 'Hello\nfrom the other tab', writeId: 'w2' },
    );
    await doc.reload();
    expect(editor.text).toBe('Hello\nfrom the other tab');
    editor.type('Hi\nfrom the other tab');
    await store.update(
      'p1',
      (r) => r && { ...r, content: 'Hello\nfrom the other tab!', writeId: 'w3' },
    );
    await doc.reload();
    expect(editor.text).toBe('Hi\nfrom the other tab!');
    await vi.advanceTimersByTimeAsync(300);
    expect((await store.get('p1'))!.content).toBe('Hi\nfrom the other tab!');
  });

  it('keeps another tab’s text as a version when the two can’t be merged', async () => {
    const { editor } = await openDoc();
    editor.type('Mine');
    await store.update('p1', (r) => r && { ...r, content: 'Theirs', writeId: 'other' });
    await vi.advanceTimersByTimeAsync(300);
    expect((await store.get('p1'))!.content).toBe('Mine');
    expect(await store.ops()).toEqual([
      expect.objectContaining({ kind: 'keepVersion', pageId: 'p1', content: 'Theirs' }),
    ]);
    expect(host.notices).toHaveLength(1);
  });

  it('carries on in memory and saves directly when the device can’t store', async () => {
    const { doc, editor } = await openDoc();
    vi.spyOn(store, 'update').mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
    editor.type('Hello, still here');
    await vi.advanceTimersByTimeAsync(300);
    expect(host.storageErrors).toHaveLength(1);
    expect(doc.getSnapshot()).toMatchObject({ fallback: true });
    expect(doc.atRisk()).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(puts).toEqual(['Hello, still here']);
    expect(doc.getSnapshot().record).toMatchObject({ revision: 2, dirty: 0 });
    expect(doc.atRisk()).toBe(false);
  });

  it('never looks stored while a failed write moves to memory', async () => {
    const { doc, editor } = await openDoc();
    vi.spyOn(store, 'update').mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
    const seen: DocSnapshot[] = [];
    doc.subscribe(() => seen.push(doc.getSnapshot()));
    editor.type('Hello, still here');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.map((s) => s.fallback)).toContain(true);
    // Until the server has it, the text is always either unstored or waiting to be sent.
    for (const s of seen) expect(s.unpersisted || s.record?.dirty === 1).toBe(true);
  });

  it('keeps this device’s text as a version before keeping theirs', async () => {
    await store.update('p1', () =>
      settle({
        ...fromServer('p1', { revision: 1, content: 'Hello', type: 'markdown' }, 0),
        content: 'Mine',
        conflict: { revision: 2, content: 'Theirs', kept: null },
      }),
    );
    serverPage = { revision: 2, content: 'Theirs' };
    const { doc, editor } = await openDoc();
    await doc.keepTheirs();
    expect(editor.text).toBe('Theirs');
    expect(await store.get('p1')).toMatchObject({ revision: 2, content: 'Theirs', dirty: 0 });
    expect(await store.ops()).toEqual([
      expect.objectContaining({ kind: 'keepVersion', content: 'Mine', baseRevision: 1 }),
    ]);
  });

  it('keep mine replaces the server’s version', async () => {
    await store.update('p1', () =>
      settle({
        ...fromServer('p1', { revision: 1, content: 'Hello', type: 'markdown' }, 0),
        content: 'Mine',
        conflict: { revision: 2, content: 'Theirs', kept: 'x' },
      }),
    );
    serverPage = { revision: 2, content: 'Theirs' };
    const { doc } = await openDoc();
    await doc.keepMine();
    expect(await store.get('p1')).toMatchObject({
      revision: 2,
      base: 'Theirs',
      content: 'Mine',
      resolving: true,
    });
    expect(host.kicks).toBe(1);
  });
});
