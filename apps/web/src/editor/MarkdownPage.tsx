import type { EditorView, ViewUpdate } from '@codemirror/view';
import { EditorView as View } from '@codemirror/view';
import type { PageMeta, Table, ViewMode } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Columns2, Eye, ListTree, PenLine } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
} from '../components/ui';
import { cn } from '../lib/cn';
import { useSettled } from '../lib/useSettled';
import { PreviewHostContext, type PreviewHost } from '../markdown/context';
import { headingsOf, statsOf, type Heading } from '../markdown/outline';
import { OutlineList } from '../markdown/OutlineList';
import { Preview } from '../markdown/Preview';
import { toggleTask } from '../markdown/tasks';
import { saveViewMode, useEditorSettings, useNotes } from '../notes/queries';
import { useGo } from '../shell/location';
import type { DocEditor, PageDoc } from '../sync/doc';
import { currentSync } from '../sync/engine';
import { textChange } from '../sync/merge';
import { GridEditor } from './GridEditor';
import { registerJump } from './jumps';
import MarkdownEditor, { type EditorHost } from './MarkdownEditor';
import { insertFiles } from './paste';
import { scrollPreviewTo, useScrollSync } from './scrollSync';
import { currentTable, replaceCurrentTable } from './tables';
import { EditorToolbar } from './Toolbar';

/*
 * A Markdown page (§9.3): Split (source beside the preview, scrolling together), Source or
 * Preview, remembered per page. Narrow panes (phones, a narrow second pane) switch between
 * Source and Preview instead of splitting.
 */

/** Below this pane width, Split isn't offered. */
const SPLIT_MIN_PX = 720;

/** The page's text as the user sees it, following typing, other tabs and other devices. */
function useDocText(doc: PageDoc): [string, DocEditor] {
  const [text, setText] = useState(() => doc.content());
  const latest = useRef(text);
  const editor = useMemo<DocEditor>(
    () => ({
      set(next) {
        latest.current = next;
        setText(next);
      },
    }),
    [],
  );
  useEffect(() => {
    const detach = doc.attach(editor);
    editor.set(doc.content());
    return detach;
  }, [doc, editor]);
  return [text, editor];
}

function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

export interface MarkdownPageProps {
  page: PageMeta;
  doc: PageDoc;
  compact?: boolean;
  autoFocus?: boolean;
}

/** Memoised: the page around it re-renders whenever the page's save state changes. */
export default memo(function MarkdownPage({ page, doc, compact, autoFocus }: MarkdownPageProps) {
  const settings = useEditorSettings();
  const queryClient = useQueryClient();
  const index = useNotes();
  const go = useGo();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [preview, setPreview] = useState<HTMLDivElement | null>(null);
  const [inTable, setInTable] = useState(false);
  const [grid, setGrid] = useState<Table | null>(null);
  const [text, previewEditor] = useDocText(doc);
  const width = useWidth(root);
  const narrow = width > 0 && width < SPLIT_MIN_PX;

  const preferred: ViewMode = page.viewMode ?? settings.viewMode;
  const mode: ViewMode = narrow && preferred === 'split' ? 'source' : preferred;

  const pages = useMemo(
    () => index.tree.pages.map((p) => ({ id: p.id, title: p.title })),
    [index.tree.pages],
  );
  const pagesRef = useRef(pages);
  useLayoutEffect(() => {
    pagesRef.current = pages;
  });

  const host = useMemo<EditorHost>(
    () => ({
      addFile: async (file, name) => {
        const engine = currentSync();
        if (!engine) throw new Error('Not signed in.');
        return engine.addFile(file, name);
      },
      localFile: async (id) => (await currentSync()?.localFile(id)) ?? null,
      pages: () => pagesRef.current,
      pickFile: (target, images) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        if (images) input.accept = 'image/*';
        input.onchange = () => {
          const files = [...(input.files ?? [])];
          if (files.length) void insertFiles(target, files, host);
        };
        input.click();
      },
    }),
    [],
  );

  const previewHost = useMemo<PreviewHost>(
    () => ({
      findPage: (title) => {
        const wanted = title.trim().toLowerCase();
        const candidates = pagesRef.current.filter((p) => p.title.trim().toLowerCase() === wanted);
        // The same section first, as people usually link nearby.
        const near = candidates.find((p) => index.page.get(p.id)?.sectionId === page.sectionId);
        return near ?? candidates[0] ?? null;
      },
      openPage: (id) => go.page(id),
      localFile: host.localFile,
    }),
    [go, host, index, page.sectionId],
  );

  const toggle = useCallback(
    (line: number) => {
      const current = doc.content();
      const next = toggleTask(current, line);
      if (next === current) return;
      if (view) {
        view.dispatch({ changes: textChange(current, next), userEvent: 'input' });
      } else {
        previewEditor.set(next);
        doc.edited(() => next, previewEditor);
      }
    },
    [doc, previewEditor, view],
  );

  const onUpdate = useCallback((update: ViewUpdate) => {
    if (update.selectionSet || update.docChanged) {
      setInTable(currentTable(update.state) !== null);
    }
  }, []);

  useScrollSync(view, preview, mode === 'split');

  const jump = useCallback(
    (line: number) => {
      if (mode !== 'preview' && view) {
        const pos = view.state.doc.line(Math.min(line, view.state.doc.lines)).from;
        view.dispatch({
          selection: { anchor: pos },
          effects: View.scrollIntoView(pos, { y: 'start', yMargin: 12 }),
        });
        view.focus();
      }
      if (mode !== 'source' && preview) scrollPreviewTo(preview, line);
    },
    [mode, preview, view],
  );
  useEffect(() => registerJump(page.id, jump), [page.id, jump]);

  // Long pages take a moment to count: only once typing pauses.
  const settled = useSettled(text, 400);
  const headings = useMemo(() => headingsOf(settled), [settled]);
  const stats = useMemo(() => statsOf(settled), [settled]);

  const modes = useMemo(
    () =>
      narrow
        ? ([
            { value: 'source', label: 'Edit', icon: <PenLine />, iconOnly: true },
            { value: 'preview', label: 'Preview', icon: <Eye />, iconOnly: true },
          ] as const)
        : ([
            { value: 'source', label: 'Source', icon: <PenLine />, iconOnly: true },
            { value: 'split', label: 'Split', icon: <Columns2 />, iconOnly: true },
            { value: 'preview', label: 'Preview', icon: <Eye />, iconOnly: true },
          ] as const),
    [narrow],
  );

  const end = useMemo(
    () => (
      <div className="flex shrink-0 items-center gap-1">
        <OutlineButton
          headings={headings}
          onJump={jump}
          words={stats.words}
          minutes={stats.minutes}
        />
        <SegmentedControl
          label="View"
          value={mode}
          onValueChange={(next) => saveViewMode(queryClient, page.id, next)}
          segments={modes}
        />
      </div>
    ),
    [headings, jump, stats, mode, modes, queryClient, page.id],
  );
  const pickFile = useCallback(
    (images: boolean) => view && host.pickFile(view, images),
    [host, view],
  );
  const openGrid = useCallback(() => {
    const table = view && currentTable(view.state);
    if (table) setGrid(table.table);
  }, [view]);

  return (
    <div
      ref={setRoot}
      data-view-mode={mode}
      className={cn(
        'flex h-full min-h-0 flex-col',
        '[--page-pad:1rem] @tablet:[--page-pad:1.75rem] @wide:[--page-pad:2.25rem]',
        compact && '@tablet:[--page-pad:1.25rem]',
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-(--page-pad)">
        {mode === 'preview' ? (
          <>
            <span className="flex-1 text-xs text-fg-3">Preview · click a task box to tick it</span>
            {end}
          </>
        ) : (
          <EditorToolbar
            view={view}
            inTable={inTable}
            onPickFile={pickFile}
            onGridEditor={openGrid}
            end={end}
          />
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        {mode !== 'preview' && (
          <div
            className={cn(
              // Contained: layout work in one column never spreads to the other, which on a
              // long page would make every scroll in the editor re-lay out the whole preview.
              'min-h-0 min-w-0 flex-1 pt-3 [contain:strict] [&_.cm-scroller]:px-(--page-pad)',
              mode === 'split' && 'border-r border-line',
            )}
          >
            <MarkdownEditor
              doc={doc}
              label={compact ? 'Page content, second pane' : 'Page content'}
              settings={settings}
              host={host}
              autoFocus={autoFocus}
              onView={setView}
              onUpdate={onUpdate}
            />
          </div>
        )}
        {mode !== 'source' && (
          <div
            ref={setPreview}
            data-preview
            className="min-h-0 min-w-0 flex-1 overflow-auto px-(--page-pad) pt-4 pb-[30vh] [contain:strict]"
          >
            <PreviewHostContext.Provider value={previewHost}>
              <Preview
                text={text}
                onToggleTask={toggle}
                className={cn(mode === 'preview' && 'max-w-[47.5rem]', compact && 'text-sm')}
              />
            </PreviewHostContext.Provider>
          </div>
        )}
      </div>
      <Dialog open={!!grid} onOpenChange={(open) => !open && setGrid(null)}>
        {grid && (
          <GridEditor
            table={grid}
            onCancel={() => setGrid(null)}
            onSave={(table) => {
              if (view) replaceCurrentTable(view, table);
              setGrid(null);
              view?.focus();
            }}
          />
        )}
      </Dialog>
    </div>
  );
});

/** The page's headings, and how long it is (on narrower screens; wide ones show them in the details panel). */
function OutlineButton({
  headings,
  onJump,
  words,
  minutes,
}: {
  headings: Heading[];
  onJump: (line: number) => void;
  words: number;
  minutes: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton label="Outline" icon={<ListTree />} size="sm" active={open} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <OutlineList
          headings={headings}
          onJump={(line) => {
            setOpen(false);
            onJump(line);
          }}
        />
        <p className="mt-2 border-t border-line px-2 pt-2 text-xs text-fg-3 tabular-nums">
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {minutes} min read
        </p>
      </PopoverContent>
    </Popover>
  );
}
