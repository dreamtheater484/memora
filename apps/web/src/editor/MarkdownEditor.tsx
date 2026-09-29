import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import type { DocEditor, PageDoc } from '../sync/doc';
import { textChange } from '../sync/merge';

/*
 * A minimal Markdown source editor (CodeMirror 6), enough to write pages and to exercise the
 * sync engine (Phase 4). The real editor, with split view and preview, is Phase 5. Loaded on
 * demand, so the rest of the app doesn't carry it.
 */

/** Marks changes that came from elsewhere, so they aren't reported back as typing. */
const fromElsewhere = Annotation.define<boolean>();

const theme = EditorView.theme({
  '&': { color: 'var(--fg)', backgroundColor: 'transparent', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.7', overflow: 'visible' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '0.25rem 0 3.5rem' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'color-mix(in oklab, var(--accent) 24%, transparent)' },
  '.cm-placeholder': { color: 'var(--fg-3)' },
});

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700', color: 'var(--fg)' },
  { tag: tags.heading1, fontSize: '1.2em' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: tags.monospace, color: 'var(--sec-ink, var(--fg-2))' },
  { tag: tags.quote, color: 'var(--fg-2)', fontStyle: 'italic' },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: 'var(--fg-3)' },
  { tag: tags.list, color: 'var(--fg)' },
]);

export interface MarkdownEditorProps {
  doc: PageDoc;
  /** The editor's accessible name. */
  label: string;
  /** Takes the focus when it appears (a new page). */
  autoFocus?: boolean;
}

export default function MarkdownEditor({ doc, label, autoFocus }: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const editor: DocEditor = {
      set(text) {
        const current = view.state.doc.toString();
        if (current === text) return;
        // The smallest change keeps the cursor and selection where they were.
        view.dispatch({ changes: textChange(current, text), annotations: fromElsewhere.of(true) });
      },
    };
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: doc.content(),
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(highlight),
          placeholder('Start writing…'),
          keymap.of([
            {
              // Saves now (it saves anyway); the indicator confirms.
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                void doc.flush();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((t) => t.annotation(fromElsewhere))) return;
            doc.edited(() => update.view.state.doc.toString(), editor);
          }),
          EditorView.domEventHandlers({
            blur: () => {
              void doc.flush();
            },
          }),
          theme,
        ],
      }),
    });
    const detach = doc.attach(editor);
    if (autoFocus) view.focus();
    return () => {
      detach();
      view.destroy();
    };
  }, [doc, label, autoFocus]);
  return <div ref={host} data-editor="markdown" className="min-h-40 text-[0.9375rem]" />;
}
