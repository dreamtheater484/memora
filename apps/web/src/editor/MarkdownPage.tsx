import { Text } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { EditorView as View } from '@codemirror/view';
import type { PageMeta, Table, ViewMode } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Columns2, Eye, PenLine } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Dialog, SegmentedControl } from '../components/ui';
import { openDiagramEditor } from '../diagrams/open';
import { cn } from '../lib/cn';
import { useWidth } from '../lib/useWidth';
import { prepareImage } from '../lib/images';
import { downloadImage } from '../lib/remoteImages';
import { useSettled } from '../lib/useSettled';
import { PreviewHostContext, type PreviewHost } from '../markdown/context';
import { headingsOf, statsOf } from '../markdown/outline';
import { OutlineButton } from '../markdown/OutlineButton';
import { Preview } from '../markdown/Preview';
import { toggleTask } from '../markdown/tasks';
import { saveViewMode, useEditorSettings, useNotes } from '../notes/queries';
import { summaryOf } from '../notes/summary';
import { useGo } from '../shell/location';
import type { DocEditor, PageDoc } from '../sync/doc';
import { currentSync } from '../sync/engine';
import { textChange } from '../sync/merge';
import { fenceAtLine, fenceChange, locateFence } from './diagrams';
import { GridEditor } from './GridEditor';
import { registerFocus, registerJump } from './jumps';
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
      pageType: 'markdown',
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

  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  });

  const host = useMemo<EditorHost>(
    () => ({
      addFile: async (file, name) => {
        const engine = currentSync();
        if (!engine) throw new Error('Not signed in.');
        const prepared = await prepareImage(file, name, settingsRef.current);
        return engine.addFile(prepared.blob, prepared.name);
      },
      downloadImage,
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
      summary: (id) => summaryOf(index, id),
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

  // The preview's Edit button on a diagram: the visual editor, its result put back in place.
  const editDiagram = useCallback(
    (line: number) => {
      const fence = fenceAtLine(Text.of(doc.content().split('\n')), line);
      if (!fence) return;
      openDiagramEditor({
        code: fence.code,
        page: 'markdown',
        onDone: (code) => {
          if (code === fence.code) return;
          const current = doc.content();
          const target = locateFence(Text.of(current.split('\n')), fence);
          if (!target) return;
          // In a list item or a quote, each line keeps the container's prefix.
          const change = fenceChange(target, code);
          if (view) {
            view.dispatch({ changes: change, userEvent: 'input.diagram' });
          } else {
            const next = current.slice(0, change.from) + change.insert + current.slice(change.to);
            previewEditor.set(next);
            doc.edited(() => next, previewEditor);
          }
        },
      });
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
  // Enter in the title continues here, at the start of the text.
  useEffect(
    () =>
      registerFocus(page.id, () => {
        if (mode === 'preview' || !view) return;
        view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
        view.focus();
      }),
    [page.id, mode, view],
  );

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
              // A readable width, centred (§9.12).
              '[&_.cm-content]:mx-auto [&_.cm-content]:max-w-(--measure)',
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
                onEditDiagram={editDiagram}
                className={cn('mx-auto max-w-(--measure)', compact && 'text-sm')}
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
