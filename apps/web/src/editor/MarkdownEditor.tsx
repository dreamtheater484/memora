import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
  keymap,
  lineNumbers,
  placeholder,
  type ViewUpdate,
} from '@codemirror/view';
import { formatAllTables, type EditorSettings } from '@memora/shared';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { DocEditor, PageDoc } from '../sync/doc';
import { textChange } from '../sync/merge';
import { insertLink, setHeading, toggleList, toggleWrap, wrapOnType } from './commands';
import { completions, type CompletionHost } from './completion';
import { pasteAndDrop, type FileHost } from './paste';
import { autoFormatTables, tableSupport } from './tables';
import { useTheme } from '../theme/theme';
import { editorTheme, markdownHighlight } from './theme';
import { drawnDiagrams, refreshDiagrams } from './diagrams';
import { imageThumbnails, type LocalFile } from './thumbnails';
import { wideCharacters } from './wide';

/*
 * The Markdown source editor (§9.3), CodeMirror 6 in a Notepad++-like style: highlighting
 * (code blocks per language), optional line numbers and visible whitespace, the current line,
 * bracket matching, folding of headings and code blocks, find and replace, tables that line
 * up, writing aids and paste handling. Loaded on demand, so the rest of the app doesn't carry it.
 */

/** Marks changes that came from elsewhere, so they aren't reported back as typing. */
const fromElsewhere = Annotation.define<boolean>();

export type EditorHost = FileHost & CompletionHost & { localFile: LocalFile };

export interface MarkdownEditorProps {
  doc: PageDoc;
  /** The editor's accessible name. */
  label: string;
  settings: Required<EditorSettings>;
  host: EditorHost;
  /** Takes the focus when it appears (a new page). */
  autoFocus?: boolean;
  /** The CodeMirror view, for the toolbar, the outline and scroll sync. */
  onView?: (view: EditorView | null) => void;
  /** Every change of text or selection (the toolbar shows table commands in a table). */
  onUpdate?: (update: ViewUpdate) => void;
}

const gutter = new Compartment();
const wrapping = new Compartment();
const whitespace = new Compartment();
const tabs = new Compartment();
const spelling = new Compartment();
const thumbnails = new Compartment();
const diagrams = new Compartment();
const tableFormatting = new Compartment();

function configured(settings: Required<EditorSettings>, host: EditorHost) {
  return {
    gutter: settings.lineNumbers
      ? [lineNumbers(), foldGutter(), highlightActiveLineGutter()]
      : [foldGutter()],
    wrapping: settings.wordWrap ? EditorView.lineWrapping : [],
    whitespace: settings.whitespace ? highlightWhitespace() : [],
    tabs: [EditorState.tabSize.of(settings.tabSize), indentUnit.of(' '.repeat(settings.tabSize))],
    spelling: EditorView.contentAttributes.of({ spellcheck: String(settings.spellcheck) }),
    thumbnails: settings.imageThumbnails ? imageThumbnails(host.localFile) : [],
    diagrams: settings.drawDiagrams ? drawnDiagrams() : [],
    tableFormatting: autoFormatTables.of(settings.formatTables),
  };
}

export default function MarkdownEditor({
  doc,
  label,
  settings,
  host,
  autoFocus,
  onView,
  onUpdate,
}: MarkdownEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The latest props, for handlers made once with the editor.
  const latest = useRef(settings);
  const hostRef = useRef(host);
  const onViewRef = useRef(onView);
  const onUpdateRef = useRef(onUpdate);
  useLayoutEffect(() => {
    latest.current = settings;
    hostRef.current = host;
    onViewRef.current = onView;
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    const element = parent.current;
    if (!element) return;
    const proxyHost: EditorHost = {
      addFile: (file, name) => hostRef.current.addFile(file, name),
      downloadImage: (url) =>
        hostRef.current.downloadImage?.(url) ?? Promise.reject(new Error('Not available')),
      localFile: (id) => hostRef.current.localFile(id),
      pages: () => hostRef.current.pages(),
      pickFile: (v, images) => hostRef.current.pickFile(v, images),
    };
    const editor: DocEditor = {
      set(text) {
        const current = cm.state.doc.toString();
        if (current === text) return;
        // The smallest change keeps the cursor and selection where they were.
        cm.dispatch({ changes: textChange(current, text), annotations: fromElsewhere.of(true) });
      },
    };
    const save = (v: EditorView) => {
      if (latest.current.formatTablesOnSave) {
        const text = v.state.doc.toString();
        const formatted = formatAllTables(text);
        if (formatted !== text) {
          v.dispatch({ changes: textChange(text, formatted), userEvent: 'input.format' });
        }
      }
      void doc.flush();
      return true;
    };
    const initial = configured(settings, proxyHost);
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      bracketMatching(),
      closeBrackets(),
      codeFolding(),
      highlightSelectionMatches(),
      search({ top: true }),
      gutter.of(initial.gutter),
      wrapping.of(initial.wrapping),
      whitespace.of(initial.whitespace),
      tabs.of(initial.tabs),
      spelling.of(initial.spelling),
      thumbnails.of(initial.thumbnails),
      diagrams.of(initial.diagrams),
      tableFormatting.of(initial.tableFormatting),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(markdownHighlight),
      wideCharacters,
      placeholder('Start writing… Type / for tables, code, diagrams and more.'),
      tableSupport(),
      completions(proxyHost),
      pasteAndDrop(proxyHost),
      wrapOnType,
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: save },
        { key: 'Mod-b', run: toggleWrap('**') },
        { key: 'Mod-i', run: toggleWrap('*') },
        { key: 'Mod-k', run: insertLink, preventDefault: true },
        { key: 'Mod-Shift-x', run: toggleWrap('~~') },
        { key: 'Mod-e', run: toggleWrap('`') },
        ...[1, 2, 3, 4, 5, 6].map((level) => ({ key: `Mod-${level}`, run: setHeading(level) })),
        { key: 'Mod-Shift-7', run: toggleList('ordered') },
        { key: 'Mod-Shift-8', run: toggleList('bullet') },
        { key: 'Mod-Shift-9', run: toggleList('task') },
        ...closeBracketsKeymap,
        ...searchKeymap,
        ...foldKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
      EditorView.updateListener.of((update) => {
        onUpdateRef.current?.(update);
        if (!update.docChanged) return;
        if (update.transactions.some((t) => t.annotation(fromElsewhere))) return;
        doc.edited(() => update.view.state.doc.toString(), editor);
      }),
      EditorView.domEventHandlers({
        blur: () => {
          void doc.flush();
        },
      }),
      editorTheme,
    ];
    const cm = new EditorView({
      parent: element,
      state: EditorState.create({ doc: doc.content(), extensions }),
    });
    view.current = cm;
    const detach = doc.attach(editor);
    onViewRef.current?.(cm);
    if (autoFocus) cm.focus();
    return () => {
      onViewRef.current?.(null);
      detach();
      cm.destroy();
      view.current = null;
    };
    // Settings are applied below without recreating the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, label, autoFocus]);

  useEffect(() => {
    const cm = view.current;
    if (!cm) return;
    const next = configured(settings, {
      ...hostRef.current,
      localFile: (id) => hostRef.current.localFile(id),
    });
    cm.dispatch({
      effects: [
        gutter.reconfigure(next.gutter),
        wrapping.reconfigure(next.wrapping),
        whitespace.reconfigure(next.whitespace),
        tabs.reconfigure(next.tabs),
        spelling.reconfigure(next.spelling),
        thumbnails.reconfigure(next.thumbnails),
        diagrams.reconfigure(next.diagrams),
        tableFormatting.reconfigure(next.tableFormatting),
      ],
    });
  }, [settings]);

  // Diagrams drawn in the source follow the app's light or dark look.
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    if (view.current) refreshDiagrams(view.current);
  }, [theme]);

  return <div ref={parent} data-editor="markdown" className="h-full min-h-0" />;
}
