import type { EditorView } from '@codemirror/view';
import {
  DEFAULT_EDITOR_SETTINGS,
  isRichContent,
  parseRich,
  type PageType,
  type RichNode,
} from '@memora/shared';
import { act, render, type RenderResult } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownEditor from '../editor/MarkdownEditor';
import { setCsrfToken } from '../lib/api';
import { PageDoc, type DocEditor, type DocHost } from '../sync/doc';
import { Sender } from '../sync/sender';
import { initialShared, type Shared } from '../sync/status';
import { MemoryStore } from '../sync/store';
import { markdownToRich, richToMarkdownPage } from './convert';
import type { RichHost } from './host';
import RichEditor from './RichEditor';

/*
 * Converting a page with diagrams back and forth (§9.4), as the page menu does it: with the
 * page open in its editor, which the other type's editor then replaces. The diagrams' code
 * survives every round trip, each editor opens with the converted page (never the other
 * editor's text), and the server only ever gets text of the page's type.
 */

const DIAGRAMS = {
  flowchart: [
    'flowchart LR',
    '    A["Order #quot;big#quot; (rush) & <fast>"] --> B{Paid?}',
    '    B -->|yes| C[Ship 🚚 naïve]',
    '    B -- no --> D("Cancel #35;1 [x]")',
    '    classDef m-blue fill:#dbeafe,stroke:#3b82f6',
    '    class A,C m-blue',
  ].join('\n'),
  mindmap: [
    'mindmap',
    '  root((Project))',
    '    Goals',
    '      Speed',
    '    Risks',
    '\t\tTabbed',
    '        ::icon(fa fa-book)',
  ].join('\n'),
  pie: [
    '%%{init: {"theme": "forest"}}%%',
    '%% a comment',
    'pie title "Pets"',
    '    "Dogs" : 386',
  ].join('\n'),
  classDiagram: ['classDiagram', '    class Animal~T~', '    Animal <|-- Duck : extends'].join(
    '\n',
  ),
  frontMatter: ['---', 'title: x', '---', 'flowchart TD', '  A-->B'].join('\n'),
  blankLines: ['', 'sequenceDiagram', '', '    A->>B: Hi', '   ', '    B-->>A: ```'].join('\n'),
};

const text = (t: string): RichNode => ({ type: 'text', text: t });
const p = (t?: string): RichNode =>
  t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' };
const diagram = (code: string): RichNode => ({
  type: 'codeBlock',
  attrs: { language: 'mermaid' },
  content: [text(code)],
});
const item = (...content: RichNode[]): RichNode => ({ type: 'listItem', content });

/** The diagrams in a document, in order. */
function diagramCodes(doc: RichNode): string[] {
  const out: string[] = [];
  const walk = (node: RichNode) => {
    if (node.type === 'codeBlock' && node.attrs?.language === 'mermaid') {
      out.push((node.content ?? []).map((c) => c.text ?? '').join(''));
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return out;
}

const toMarkdown = (content: string) => richToMarkdownPage(content).markdown;
const toRich = (markdown: string) => JSON.stringify(markdownToRich(markdown));

describe('rich → Markdown → rich with diagrams', () => {
  it('keeps every diagram’s code exactly, wherever it is, cycle after cycle', () => {
    const all = Object.values(DIAGRAMS);
    const start: RichNode = {
      type: 'doc',
      content: [
        diagram(DIAGRAMS.flowchart),
        p('Text'),
        ...all.map(diagram),
        { type: 'bulletList', content: [item(p('In a list'), diagram(DIAGRAMS.mindmap))] },
        { type: 'blockquote', content: [p('Quoted'), diagram(DIAGRAMS.blankLines)] },
        { type: 'callout', attrs: { kind: 'tip' }, content: [diagram(DIAGRAMS.pie)] },
        diagram(DIAGRAMS.mindmap),
      ],
    };
    const codes = diagramCodes(start);
    let rich = JSON.stringify(start);
    let markdown = '';
    for (let cycle = 1; cycle <= 4; cycle++) {
      const next = toMarkdown(rich);
      if (cycle > 1) expect(next, `Markdown of cycle ${cycle}`).toBe(markdown);
      markdown = next;
      rich = toRich(markdown);
      expect(diagramCodes(parseRich(rich)!), `cycle ${cycle}`).toEqual(codes);
    }
  });
});

// The page, its server and its editors

let server: { type: PageType; revision: number; content: string };
/** What the server was asked to save, with the page's type at the time. */
let saves: { type: PageType; content: string }[];

const respond = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  if (init.method === 'PUT' && url.endsWith('/pages/p1/content')) {
    const body = JSON.parse(String(init.body)) as { content: string; baseRevision: number };
    saves.push({ type: server.type, content: body.content });
    if (body.content === server.content) return respond(200, { revision: server.revision });
    if (body.baseRevision !== server.revision) {
      return respond(409, {
        error: { code: 'revision_conflict', message: 'Changed elsewhere.', details: server },
      });
    }
    // As the server: a rich page only takes a rich document.
    if (server.type === 'rich' && !isRichContent(body.content)) {
      return respond(400, { error: { code: 'invalid_content', message: 'Not a rich page.' } });
    }
    server = { ...server, revision: server.revision + 1, content: body.content };
    return respond(200, { revision: server.revision, pages: [] });
  }
  if (url.endsWith('/pages/p1')) return respond(200, { id: 'p1', ...server });
  return respond(404, { error: { code: 'not_found', message: 'Not found.' } });
}

/** The tab's side of syncing: the leader sends at once, and the page takes the answer in. */
class Host implements DocHost {
  readonly tabId = 'tab-a';
  readonly sender: Sender;
  shared: Shared = { ...initialShared };
  doc: PageDoc | null = null;
  sending: Promise<void> = Promise.resolve();
  constructor(readonly store: MemoryStore) {
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
    this.sending = (async () => {
      const record = await this.store.get('p1');
      if (record?.dirty && !record.conflict) await this.sender.save(record, this.store);
      await this.doc?.reload();
    })();
  }
  announce() {}
  storageFailed() {}
  notify() {}
  reached() {}
  unreachable() {}
}

const richHost: RichHost = {
  addFile: async () => 'id',
  downloadImage: async (url) => url,
  pages: () => [],
  pickFiles: async () => [],
  editLink: () => {},
  editMath: () => {},
  openLink: () => {},
  pickFont: () => {},
};

const markdownHost = {
  addFile: async () => 'id',
  downloadImage: async (url: string) => url,
  localFile: async () => null,
  pages: () => [],
  pickFile: () => {},
};

/** A page open in a tab, with the editor its type has (as PageBody shows it). */
class OpenPage {
  readonly store = new MemoryStore();
  readonly host = new Host(this.store);
  readonly doc = new PageDoc('p1', this.host);
  rich: Editor | null = null;
  source: EditorView | null = null;
  /** The Markdown preview alone (Preview mode, no source editor): what it shows. */
  previewed: string | null = null;
  private shown: RenderResult | null = null;
  private detachPreview: (() => void) | null = null;

  /** Opens the page in its editor, or (Markdown, Preview mode) in the preview alone. */
  async open(previewOnly = false) {
    this.host.doc = this.doc;
    await this.doc.load();
    if (!previewOnly) {
      await this.show();
      return;
    }
    // MarkdownPage's useDocText.
    this.previewed = this.doc.content();
    const preview: DocEditor = {
      pageType: 'markdown',
      set: (next) => {
        this.previewed = next;
      },
    };
    this.detachPreview = this.doc.attach(preview);
    return preview;
  }

  get type(): PageType {
    return this.doc.getSnapshot().record!.type;
  }

  /** The editor for the page's type replaces the one shown. */
  async show() {
    this.detachPreview?.();
    this.detachPreview = null;
    this.shown?.unmount();
    this.rich = this.source = null;
    const props = { doc: this.doc, label: 'Page', settings: DEFAULT_EDITOR_SETTINGS };
    if (this.type === 'rich') {
      this.shown = render(
        createElement(RichEditor, {
          ...props,
          host: richHost,
          onEditor: (e: Editor | null) => {
            if (e) this.rich = e;
          },
        }),
      );
      // As RichPage does once the editor exists (to mark links to pages and cards).
      await act(async () => {
        this.rich!.view.dispatch(this.rich!.state.tr.setMeta('pageLinks', true));
      });
    } else {
      this.shown = render(
        createElement(MarkdownEditor, {
          ...props,
          host: markdownHost,
          onView: (v: EditorView | null) => {
            if (v) this.source = v;
          },
        }),
      );
    }
  }

  /** What the editor shows: the Markdown source, or the rich document. */
  showing(): string {
    if (this.source) return this.source.state.doc.toString();
    return JSON.stringify(this.rich!.getJSON());
  }

  /** The page menu's Convert, step by step (ConvertDialog), then the other editor. */
  async convert(): Promise<string> {
    const to: PageType = this.type === 'rich' ? 'markdown' : 'rich';
    await this.doc.flush();
    await this.host.sending;
    const record = (await this.store.get('p1'))!;
    expect(record.dirty, 'saved before converting').toBe(0);
    const content = to === 'rich' ? toRich(record.content) : toMarkdown(record.content);
    // POST /pages/:id/convert
    server = { type: to, revision: server.revision + 1, content };
    await this.doc.refresh();
    await this.show();
    return content;
  }

  async typeInSource(at: number, insert: string) {
    await act(async () => {
      this.source!.dispatch({ changes: { from: at, insert }, userEvent: 'input.type' });
    });
    await this.doc.flush();
    await this.host.sending;
  }

  async typeInRich(insert: string) {
    await act(async () => {
      this.rich!.commands.insertContentAt(1, insert);
    });
    await this.doc.flush();
    await this.host.sending;
  }

  close() {
    this.shown?.unmount();
  }
}

/** Every save was of the page's type at the time: never one type's text in the other. */
function expectSavesOfTheirType() {
  for (const save of saves) {
    const rich = isRichContent(save.content) && save.content.trim().startsWith('{');
    expect(rich, `a ${save.type} page was sent ${save.content.slice(0, 40)}`).toBe(
      save.type === 'rich',
    );
  }
}

describe('converting an open page with diagrams', () => {
  let page: OpenPage;
  beforeEach(() => {
    vi.stubGlobal('fetch', fakeFetch);
    setCsrfToken('token');
    saves = [];
    page = new OpenPage();
  });
  afterEach(() => {
    page.close();
    vi.unstubAllGlobals();
  });

  const start: RichNode = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('Plan')] },
      diagram(DIAGRAMS.flowchart),
      p('Then'),
      diagram(DIAGRAMS.mindmap),
      // The editor always leaves a paragraph after a last diagram; Markdown drops it.
      p(),
    ],
  };
  const codes = diagramCodes(start);

  it('shows the converted page after every conversion, round trip after round trip', async () => {
    server = { type: 'rich', revision: 1, content: JSON.stringify(start) };
    await page.open();
    for (let round = 1; round <= 3; round++) {
      const markdown = await page.convert();
      expect(page.type).toBe('markdown');
      expect(page.showing(), `Markdown editor, round ${round}`).toBe(markdown);
      expect(diagramCodes(markdownToRich(page.showing()))).toEqual(codes);

      await page.convert();
      expect(page.type).toBe('rich');
      expect(diagramCodes(page.rich!.getJSON() as RichNode)).toEqual(codes);
      // The page now ends with a diagram, so the editor adds a paragraph after it as it
      // opens: that isn't an edit, and nothing is saved for it.
      expect.soft(page.doc.getSnapshot().unpersisted, `opening, round ${round}`).toBe(false);
    }
    expect.soft(saves, 'saves made by opening the page').toEqual([]);
    expect(server.type).toBe('rich');
    expect(diagramCodes(parseRich(server.content)!)).toEqual(codes);
  });

  it('typing in the rich editor, then converting: the Markdown editor shows the Markdown', async () => {
    server = { type: 'rich', revision: 1, content: JSON.stringify(start) };
    await page.open();
    await page.typeInRich('Our ');
    expect(server.content).toContain('Our Plan');

    const markdown = await page.convert();
    expect(page.showing()).toBe(markdown);
    expect(page.showing()).toMatch(/^# Our Plan\n\n```mermaid\nflowchart LR\n/);

    // A keystroke in the Markdown editor saves Markdown.
    await page.typeInSource(page.showing().length, '\n\nDone.');
    expect(server).toMatchObject({ type: 'markdown', content: `${markdown}\n\nDone.` });

    await page.convert();
    expect(diagramCodes(page.rich!.getJSON() as RichNode)).toEqual(codes);
    await page.typeInRich('Still ');
    expect(server.type).toBe('rich');
    expect(diagramCodes(parseRich(server.content)!)).toEqual(codes);
    expectSavesOfTheirType();
  });

  it('a Markdown page edited from its preview, then converted: the rich editor shows the page', async () => {
    const markdown = toMarkdown(JSON.stringify(start));
    server = { type: 'markdown', revision: 1, content: markdown };
    const preview = (await page.open(true))!;
    // The preview's diagram editor, Done: the code goes back between the fences
    // (`doc.edited(() => next, previewEditor)` in MarkdownPage).
    const edited = markdown.replace('class A,C m-blue', 'class A m-blue');
    preview.set(edited);
    page.doc.edited(() => edited, preview);
    await page.doc.flush();
    await page.host.sending;
    expect(server.content).toBe(edited);

    await page.convert();
    const shown = page.rich!.getJSON() as RichNode;
    expect(diagramCodes(shown)).toEqual([
      DIAGRAMS.flowchart.replace('class A,C m-blue', 'class A m-blue'),
      DIAGRAMS.mindmap,
    ]);
    expect(page.doc.content()).toBe(server.content);
    // The preview, about to go, was never handed the rich document as Markdown.
    expect(page.previewed).toBe(edited);
    expectSavesOfTheirType();
  });
});
