import { isRichContent, type PageType } from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../lib/api';
import { PageDoc, type DocEditor, type DocHost, type DocSnapshot } from './doc';
import { fromServer, settle } from './records';
import { Sender } from './sender';
import { initialShared, type Shared } from './status';
import { MemoryStore, type LocalStore } from './store';

/** The server's copy of page p1 (a Markdown page unless it says otherwise). */
let serverPage: { revision: number; content: string; type?: PageType } | null;
const puts: string[] = [];

const respond = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  if (!serverPage) return respond(404, { error: { code: 'not_found', message: 'Not found.' } });
  if (init.method === 'PUT') {
    const body = JSON.parse(String(init.body));
    puts.push(body.content);
    // As the server: a rich page only takes a rich document.
    if (serverPage.type === 'rich' && !isRichContent(body.content)) {
      return respond(400, { error: { code: 'invalid_content', message: 'Not a rich page.' } });
    }
    serverPage = { ...serverPage, revision: serverPage.revision + 1, content: body.content };
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
      uploaded: () => {},
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
    readonly pageType: PageType = 'markdown',
    /** Text it can't show (as the rich editor can't show Markdown): it keeps its own. */
    private readonly cantShow: (text: string) => boolean = () => false,
  ) {}
  set(text: string) {
    if (this.cantShow(text)) return false;
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

/*
 * Converting a page while it is open (§9.4): the page's type changes under the open editor,
 * which is then replaced by one of the other type. The old editor's text must never come
 * back, and must never be saved into the converted page.
 */
describe('a page converted while it is open', () => {
  const richDoc = (text: string) =>
    JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
  const hello = richDoc('Hello');
  /** As the rich editor: it can only show a rich document. */
  const notRich = (text: string) => !isRichContent(text);

  /** The leader tab sends what waits, and the page takes the answer in. */
  async function send(doc: PageDoc) {
    const record = await store.get('p1');
    if (record?.dirty && !record.conflict) await host.sender.save(record, store);
    await doc.reload();
  }

  /** Types, stores and sends. */
  async function typeAndSave(doc: PageDoc, editor: FakeEditor, text: string) {
    editor.type(text);
    await doc.flush();
    await send(doc);
  }

  /** `POST /pages/p1/convert`, then the page fetches the result (as ConvertDialog does). */
  async function convert(doc: PageDoc, type: PageType, content: string) {
    serverPage = { type, revision: serverPage!.revision + 1, content };
    await doc.refresh();
  }

  async function openRich() {
    serverPage = { type: 'rich', revision: 1, content: hello };
    const doc = new PageDoc('p1', host);
    await doc.load();
    const editor = new FakeEditor(doc, doc.content(), 'rich', notRich);
    const detach = doc.attach(editor);
    return { doc, editor, detach };
  }

  it('rich → Markdown: the Markdown editor gets the Markdown, not the rich editor’s document', async () => {
    const { doc, editor, detach } = await openRich();
    await typeAndSave(doc, editor, richDoc('Hello there'));
    expect(serverPage).toMatchObject({ type: 'rich', content: richDoc('Hello there') });

    await convert(doc, 'markdown', 'Hello there');
    // The rich editor is never handed Markdown; it goes, as the page now shows Markdown.
    expect(editor.received).not.toContain('Hello there');
    detach();
    expect(doc.content()).toBe('Hello there');
    const markdown = new FakeEditor(doc, doc.content());
    doc.attach(markdown);
    expect(markdown.text).toBe('Hello there');
    expect(doc.getSnapshot()).toMatchObject({ unpersisted: false, record: { type: 'markdown' } });
  });

  it('never saves the old editor’s text into the converted page', async () => {
    const { doc, editor } = await openRich();
    await typeAndSave(doc, editor, richDoc('Hello there'));
    await convert(doc, 'markdown', 'Hello there');
    puts.length = 0;
    // Still on screen for a moment: a keystroke there changes nothing.
    editor.type(richDoc('Hello there!'));
    expect(doc.getSnapshot().unpersisted).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await doc.flush();
    await send(doc);
    expect(await store.get('p1')).toMatchObject({ type: 'markdown', content: 'Hello there' });
    expect(puts).toEqual([]);
    expect(serverPage).toMatchObject({ type: 'markdown', content: 'Hello there' });
  });

  it('Markdown → rich after a task box was ticked in the preview: the rich editor gets the document', async () => {
    serverPage = { type: 'markdown', revision: 1, content: '- [ ] Pack' };
    const doc = new PageDoc('p1', host);
    await doc.load();
    // The preview alone (no source editor open): its text is what it last set.
    const preview = new FakeEditor(doc, doc.content());
    const detachPreview = doc.attach(preview);
    const ticked = '- [x] Pack';
    preview.set(ticked);
    doc.edited(() => ticked, preview);
    await doc.flush();
    await send(doc);
    expect(serverPage.content).toBe(ticked);

    await convert(doc, 'rich', richDoc('Pack'));
    expect(preview.received).not.toContain(richDoc('Pack'));
    detachPreview();
    expect(doc.content()).toBe(richDoc('Pack'));
    const editor = new FakeEditor(doc, doc.content(), 'rich', notRich);
    doc.attach(editor);
    expect(editor.text).toBe(richDoc('Pack'));
  });

  it('round trips, typing in each editor before converting', async () => {
    const opened = await openRich();
    let { editor, detach } = opened;
    const { doc } = opened;
    for (let round = 1; round <= 3; round++) {
      await typeAndSave(doc, editor, richDoc(`Round ${round}`));
      await convert(doc, 'markdown', `Round ${round}`);
      detach();
      expect(doc.content()).toBe(`Round ${round}`);
      const markdown = new FakeEditor(doc, doc.content());
      const detachMarkdown = doc.attach(markdown);
      expect(markdown.text).toBe(`Round ${round}`);
      await typeAndSave(doc, markdown, `Round ${round}, edited`);

      await convert(doc, 'rich', richDoc(`Round ${round}, edited`));
      detachMarkdown();
      expect(doc.content()).toBe(richDoc(`Round ${round}, edited`));
      editor = new FakeEditor(doc, doc.content(), 'rich', notRich);
      detach = doc.attach(editor);
      expect(editor.text).toBe(richDoc(`Round ${round}, edited`));
    }
    // What the server was sent: rich documents while rich, Markdown while Markdown.
    expect(puts).toEqual([
      richDoc('Round 1'),
      'Round 1, edited',
      richDoc('Round 2'),
      'Round 2, edited',
      richDoc('Round 3'),
      'Round 3, edited',
    ]);
  });

  it('keeps what was just typed as a version when the page is converted on another device', async () => {
    const { doc, editor } = await openRich();
    // Typed, not stored yet: meanwhile another device converted the page.
    editor.type(richDoc('Hello, typed here'));
    serverPage = { type: 'markdown', revision: 2, content: 'Hello' };
    await doc.refresh();
    expect(doc.content()).toBe('Hello');
    expect(doc.getSnapshot()).toMatchObject({ unpersisted: false, record: { type: 'markdown' } });
    expect(await store.ops()).toEqual([
      expect.objectContaining({ kind: 'keepVersion', content: richDoc('Hello, typed here') }),
    ]);
    expect(host.notices).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    await doc.flush();
    expect(await store.get('p1')).toMatchObject({ type: 'markdown', content: 'Hello', dirty: 0 });
  });

  it('never stores the old type’s text when another tab took the conversion in first', async () => {
    const { doc, editor } = await openRich();
    editor.type(richDoc('Hello, typed here'));
    // Another tab of this browser fetched the converted page into the shared record.
    await store.update(
      'p1',
      (r) =>
        r &&
        settle({
          ...r,
          type: 'markdown',
          revision: 2,
          base: 'Hello',
          content: 'Hello',
          writeId: 'other-tab',
          writer: '',
        }),
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(await store.get('p1')).toMatchObject({ type: 'markdown', content: 'Hello', dirty: 0 });
    expect(doc.content()).toBe('Hello');
    expect(await store.ops()).toEqual([
      expect.objectContaining({ kind: 'keepVersion', content: richDoc('Hello, typed here') }),
    ]);
  });

  it('an editor that can’t show the page’s latest text never saves its older text', async () => {
    serverPage = { type: 'rich', revision: 1, content: hello };
    const doc = new PageDoc('p1', host);
    await doc.load();
    // Another tab stores a document this editor can't read (from a newer version, say).
    const unreadable = '{"type":"doc","content":[{"type":"fromTheFuture"}]}';
    const editor = new FakeEditor(doc, doc.content(), 'rich', (t) => t === unreadable);
    doc.attach(editor);
    await store.update('p1', (r) => r && { ...r, content: unreadable, writeId: 'w2' });
    await doc.reload();
    expect(editor.text).toBe(hello);
    // Typing there, on the older document, doesn't touch the page.
    editor.type(richDoc('Typed on the old one'));
    expect(doc.getSnapshot().unpersisted).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await store.get('p1'))!.content).toBe(unreadable);
    expect(doc.content()).toBe(unreadable);
    // Once it shows the page again, its typing counts again.
    await store.update('p1', (r) => r && { ...r, content: richDoc('Readable'), writeId: 'w3' });
    await doc.reload();
    expect(editor.text).toBe(richDoc('Readable'));
    editor.type(richDoc('Readable, typed'));
    await vi.advanceTimersByTimeAsync(300);
    expect((await store.get('p1'))!.content).toBe(richDoc('Readable, typed'));
  });
});
