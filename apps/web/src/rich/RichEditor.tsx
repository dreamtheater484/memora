import { parseRich, type EditorSettings, type RichNode } from '@memora/shared';
import type { AnyExtension, Editor, JSONContent, Range } from '@tiptap/core';
import { Dropcursor, Placeholder, TrailingNode } from '@tiptap/extensions';
import type { Node as PMNode, Slice } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { DocEditor, PageDoc } from '../sync/doc';
import { cleanPastedHtml } from './clean';
import { CodeHighlight } from './codeHighlight';
import { DragHandle } from './dragHandle';
import { insertFiles, keepPastedImages } from './files';
import type { RichHost } from './host';
import { richExtensions } from './schema';
import { slashItems } from './slashItems';
import { pageLinks, slashCommands } from './suggestions';
import { Find } from './find';
import { RichKeys } from './keys';
import { editDiagramAt } from './diagramActions';
import { codeBlockView } from './diagramView';
import { FileView, ImageView } from './views';
import { WikiLinks } from './wikiLinks';
import { CardKeys } from './cardKeys';
import { knownCardKey, openCardKey } from '../kanban/keys';
import '../markdown/markdown.css';
import './rich.css';

/*
 * The rich text editor (§9.4): TipTap, with the page's document kept in step with the sync
 * engine like the Markdown editor's text. Files pasted or dropped are kept as the page's files
 * (offline too); images in pasted HTML are downloaded by the server afterwards.
 */

export interface RichEditorProps {
  doc: PageDoc;
  label: string;
  settings: Required<EditorSettings>;
  host: RichHost;
  autoFocus?: boolean;
  onEditor?: (editor: Editor | null) => void;
  /** More extensions from the page (its keyboard shortcuts). */
  extra?: AnyExtension;
}

const serialize = (editor: Editor) => JSON.stringify(editor.getJSON());

/** The editor has its view: TipTap makes it when the editor's element is on the page. */
function mounted(editor: Editor): boolean {
  try {
    return !editor.isDestroyed && !!editor.view.dom;
  } catch {
    return false;
  }
}

/** A document the schema can show, or null (then the page isn't shown, never overwritten). */
function readable(editor: Editor | null, json: RichNode): PMNode | null {
  if (!editor) return null;
  try {
    const node = editor.schema.nodeFromJSON(json);
    node.check();
    return node;
  } catch {
    return null;
  }
}

/**
 * What the editor (made once per page) reaches: always the page's latest host, the editor
 * itself once it exists, and the sync engine's receiver.
 */
class Bridge implements RichHost {
  editor: Editor | null = null;
  receiver: DocEditor | null = null;
  constructor(
    private host: RichHost,
    private onEditor?: (editor: Editor | null) => void,
  ) {}
  /** The page rendered again: its latest host. */
  update(host: RichHost, onEditor?: (editor: Editor | null) => void) {
    this.host = host;
    this.onEditor = onEditor;
  }
  connect(editor: Editor | null, receiver: DocEditor | null) {
    this.editor = editor;
    this.receiver = receiver;
    this.onEditor?.(editor);
  }
  addFile = (file: Blob, name: string) => this.host.addFile(file, name);
  downloadImage = (url: string) => this.host.downloadImage(url);
  pages = () => this.host.pages();
  pickFiles = (images: boolean) => this.host.pickFiles(images);
  editLink = () => this.host.editLink();
  editMath = (target: Parameters<RichHost['editMath']>[0]) => this.host.editMath(target);
  openLink = (href: string) => this.host.openLink(href);
  pickFont = () => this.host.pickFont();
}

function editorExtensions(bridge: Bridge, extra?: AnyExtension): AnyExtension[] {
  return [
    ...richExtensions({
      views: {
        image: ReactNodeViewRenderer(ImageView),
        file: ReactNodeViewRenderer(FileView),
        codeBlock: codeBlockView,
      },
      onDiagramEdit: editDiagramAt,
      onMathClick: (node, pos) =>
        bridge.editMath({
          pos,
          latex: String(node.attrs.latex ?? ''),
          inline: node.type.name === 'inlineMath',
        }),
    }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === 'heading' ? 'Heading' : 'Type / for blocks, [[ to link a page…',
      showOnlyCurrent: true,
    }),
    Dropcursor.configure({ color: 'var(--accent)', width: 2 }),
    TrailingNode,
    CodeHighlight,
    DragHandle,
    Find,
    RichKeys,
    CardKeys.configure({ known: knownCardKey, open: openCardKey }),
    WikiLinks.configure({
      exists: (title) => {
        const wanted = title.trim().toLowerCase();
        return bridge.pages().some((p) => p.title.trim().toLowerCase() === wanted);
      },
    }),
    ...(extra ? [extra] : []),
    slashCommands(() => slashItems(bridge)),
    pageLinks(
      () => bridge.pages(),
      (editor: Editor, range: Range, title: string) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: 'text',
              text: title,
              marks: [{ type: 'link', attrs: { href: `wiki:${encodeURIComponent(title)}` } }],
            },
            { type: 'text', text: ' ' },
          ])
          .run();
      },
    ),
  ];
}

/** Images a paste brought in that are still elsewhere: web addresses, or embedded data. */
const pastedImages = (html: string) => [
  ...new Set(
    [...html.matchAll(/<img[^>]+src="((?:https?:|data:image\/)[^"]+)"/g)].map((m) =>
      m[1]!.replace(/&amp;/g, '&'),
    ),
  ),
];

export default function RichEditor({
  doc,
  label,
  settings,
  host,
  autoFocus,
  onEditor,
  extra,
}: RichEditorProps) {
  const [bridge] = useState(() => new Bridge(host, onEditor));
  useLayoutEffect(() => bridge.update(host, onEditor));
  const [extensions] = useState(() => editorExtensions(bridge, extra));
  const initial = useMemo(() => parseRich(doc.content()), [doc]);

  const editor = useEditor(
    {
      extensions,
      content: (initial ?? undefined) as JSONContent | undefined,
      autofocus: autoFocus ? 'end' : false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          'aria-label': label,
          role: 'textbox',
          'aria-multiline': 'true',
          class: 'markdown-body rich-content',
          spellcheck: String(settings.spellcheck),
        },
        transformPastedHTML(html) {
          const cleaned = cleanPastedHtml(html);
          const sources = pastedImages(cleaned);
          // Kept once the paste (or drop) is in the document.
          if (sources.length) {
            setTimeout(() => {
              if (bridge.editor) void keepPastedImages(bridge.editor, sources, bridge);
            });
          }
          return cleaned;
        },
        handlePaste(_view: EditorView, event: ClipboardEvent, _slice: Slice) {
          const files = [...(event.clipboardData?.files ?? [])];
          if (!files.length || !bridge.editor) return false;
          event.preventDefault();
          void insertFiles(bridge.editor, files, bridge);
          return true;
        },
        handleDrop(view: EditorView, event: DragEvent, _slice: Slice, moved: boolean) {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (moved || !files.length || !bridge.editor) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertFiles(bridge.editor, files, bridge, at);
          return true;
        },
        handleClick(view: EditorView, pos: number, event: MouseEvent) {
          // Ctrl/Cmd+click follows a link, as in Word.
          if (!(event.ctrlKey || event.metaKey)) return false;
          const link = view.state.doc
            .resolve(pos)
            .marks()
            .find((m) => m.type.name === 'link');
          if (!link) return false;
          bridge.openLink(String(link.attrs.href ?? ''));
          return true;
        },
      },
      onUpdate: ({ editor: current, transaction }) => {
        // Only a change to the document is an edit: not what plugins add by themselves after
        // one that changed nothing (the empty paragraph after a closing diagram, as the page
        // opens), which is saved with the next real change.
        const from = bridge.receiver;
        if (!from || !transaction.docChanged) return;
        doc.edited(() => serialize(current), from);
      },
    },
    [doc],
  );

  // Text from elsewhere (another tab, device or a merge) replaces the document.
  useEffect(() => {
    if (!editor) return;
    const receiver: DocEditor = {
      pageType: 'rich',
      set(text) {
        const json = parseRich(text);
        const node = json && readable(editor, json);
        // Not a document this editor can show: it keeps its own, which the page then ignores.
        if (!node || editor.isDestroyed) return false;
        if (node.eq(editor.state.doc)) return;
        const { from, to } = editor.state.selection;
        const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, node.content);
        const size = tr.doc.content.size;
        try {
          tr.setSelection(
            TextSelection.between(
              tr.doc.resolve(Math.min(from, size)),
              tr.doc.resolve(Math.min(to, size)),
            ),
          );
        } catch {
          // Keep whatever the replacement left.
        }
        editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('preventUpdate', true));
      },
    };
    let detach: (() => void) | null = null;
    // Once the editor is on the page (its view exists).
    const start = () => {
      if (detach) return;
      bridge.connect(editor, receiver);
      // Gives the editor the page's text as it is now.
      detach = doc.attach(receiver);
    };
    if (mounted(editor)) start();
    else editor.on('mount', start);
    return () => {
      editor.off('mount', start);
      detach?.();
      bridge.connect(null, null);
    };
  }, [bridge, doc, editor]);

  useEffect(() => {
    if (editor && mounted(editor)) {
      editor.view.dom.setAttribute('spellcheck', String(settings.spellcheck));
    }
  }, [editor, settings.spellcheck]);

  return <EditorContent editor={editor} className="rich-editor" />;
}
