import {
  ASSET_SCHEME,
  RICH_FILL_COLORS,
  assetPath,
  type PageMeta,
  type PageView,
} from '@memora/shared';
import { Extension, type Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bold,
  Code,
  ExternalLink,
  FileText,
  Highlighter,
  Italic,
  Link2,
  Link2Off,
  PenLine,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  IconButton,
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  toast,
} from '../components/ui';
import { floatingPanel } from '../components/ui/styles';
import { registerJump } from '../editor/jumps';
import { cn } from '../lib/cn';
import { prepareImage } from '../lib/images';
import { downloadImage } from '../lib/remoteImages';
import { useKeyboardInset } from '../lib/useKeyboardInset';
import { useSettled } from '../lib/useSettled';
import { PreviewHostContext, type PreviewHost } from '../markdown/context';
import { OutlineButton } from '../markdown/OutlineButton';
import { saveEditorSettings, useEditorSettings, useNotes } from '../notes/queries';
import { summaryOf } from '../notes/summary';
import { FindBar } from './FindBar';
import { LinkPreview } from './LinkPreview';
import { wikiLinksKey } from './wikiLinks';
import { cardKeysKey } from './cardKeys';
import { useCardKeys } from '../kanban/keys';
import { useGo } from '../shell/location';
import type { PageDoc } from '../sync/doc';
import { currentSync } from '../sync/engine';
import { LinkDialog, MathDialog, type MathTarget } from './dialogs';
import type { RichHost } from './host';
import { richOutline } from './outline';
import RichEditor from './RichEditor';
import { RichToolbar, TableMenuItems } from './RichToolbar';
import { RichViewHostContext, type RichViewHost } from './viewHost';

/*
 * A rich text page (§9.4): the Word-like toolbar, the editor, a menu on selected text, and
 * optionally a sheet of paper (A4 or Letter) showing how an export will look. On a phone the
 * toolbar sits just above the keyboard while typing.
 */

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

const PAGE_VIEWS: { value: PageView; label: string }[] = [
  { value: 'off', label: 'Fit the window' },
  { value: 'a4', label: 'A4 page' },
  { value: 'letter', label: 'Letter page' },
];

export interface RichPageProps {
  page: PageMeta;
  doc: PageDoc;
  compact?: boolean;
  autoFocus?: boolean;
}

type DialogState = { kind: 'link' } | { kind: 'math'; target: MathTarget } | null;

export default memo(function RichPage({ page, doc, compact, autoFocus }: RichPageProps) {
  const settings = useEditorSettings();
  const queryClient = useQueryClient();
  const index = useNotes();
  const go = useGo();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [finding, setFinding] = useState(false);
  const inset = useKeyboardInset();

  const pages = useMemo(
    () => index.tree.pages.map((p) => ({ id: p.id, title: p.title })),
    [index.tree.pages],
  );
  const latest = useRef({ pages, settings });
  useLayoutEffect(() => {
    latest.current = { pages, settings };
  });

  const findPage = useCallback(
    (title: string) => {
      const wanted = title.trim().toLowerCase();
      const candidates = latest.current.pages.filter(
        (p) => p.title.trim().toLowerCase() === wanted,
      );
      const near = candidates.find((p) => index.page.get(p.id)?.sectionId === page.sectionId);
      return near ?? candidates[0] ?? null;
    },
    [index, page.sectionId],
  );

  const localFile = useCallback(
    async (id: string) => (await currentSync()?.localFile(id)) ?? null,
    [],
  );

  const host = useMemo<RichHost>(
    () => ({
      addFile: async (file, name) => {
        const engine = currentSync();
        if (!engine) throw new Error('Not signed in.');
        const prepared = await prepareImage(file, name, latest.current.settings);
        return engine.addFile(prepared.blob, prepared.name);
      },
      downloadImage,
      pages: () => latest.current.pages,
      pickFiles: (images) =>
        new Promise<File[]>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          if (images) input.accept = 'image/*';
          input.onchange = () => resolve([...(input.files ?? [])]);
          input.click();
        }),
      editLink: () => setDialog({ kind: 'link' }),
      editMath: (target) => setDialog({ kind: 'math', target }),
      openLink: (href) => {
        if (href.startsWith('wiki:')) {
          const title = decodeURIComponent(href.slice(5).split('#')[0] ?? '');
          const target = findPage(title);
          if (target) go.page(target.id);
          else toast({ title: `No page is called “${title}” yet` });
          return;
        }
        if (href.startsWith(ASSET_SCHEME)) {
          const id = href.slice(ASSET_SCHEME.length);
          void localFile(id).then((url) => window.open(url ?? assetPath(id), '_blank', 'noopener'));
          return;
        }
        if (/^(https?|mailto|tel):/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
      },
    }),
    [findPage, go, localFile],
  );

  const previewHost = useMemo<PreviewHost>(
    () => ({
      findPage,
      openPage: (id) => go.page(id),
      localFile,
      summary: (id) => summaryOf(index, id),
    }),
    [findPage, go, localFile, index],
  );
  const viewHost = useMemo<RichViewHost>(() => ({ downloadImage }), []);
  const linkSummary = useCallback(
    (title: string) => {
      const target = findPage(title);
      return target ? summaryOf(index, target.id) : null;
    },
    [findPage, index],
  );

  // Links to pages that are gone (or came) show as such once the pages change, and card
  // keys once the projects are known.
  const cardKeys = useCardKeys((s) => s.keys);
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta(wikiLinksKey, true).setMeta(cardKeysKey, true));
    }
  }, [editor, index, cardKeys]);

  // Outline and word count, once typing pauses.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const changed = () => setVersion((v) => v + 1);
    const focus = () => setFocused(true);
    const blur = () =>
      setTimeout(() => {
        if (!editor.isDestroyed && !editor.isFocused) setFocused(false);
      }, 150);
    editor.on('update', changed);
    editor.on('focus', focus);
    editor.on('blur', blur);
    changed();
    return () => {
      editor.off('update', changed);
      editor.off('focus', focus);
      editor.off('blur', blur);
    };
  }, [editor]);
  const settled = useSettled(version, 400);
  const outline = useMemo(
    () => richOutline(editor && settled >= 0 ? editor.getJSON() : undefined),
    [editor, settled],
  );

  const jump = useCallback(
    (nth: number) => {
      if (!editor) return;
      let found: number | null = null;
      let count = 0;
      editor.state.doc.descendants((node, pos) => {
        if (found !== null) return false;
        if (node.type.name === 'heading') {
          if (node.textContent.trim() && count++ === nth) found = pos;
          return false;
        }
        return true;
      });
      if (found === null) return;
      editor
        .chain()
        .focus()
        .setTextSelection(found + 1)
        .scrollIntoView()
        .run();
    },
    [editor],
  );
  useEffect(() => registerJump(page.id, jump), [page.id, jump]);

  // Ctrl/Cmd+K makes a link in the editor (search moves to Ctrl/Cmd+P, as in Markdown pages).
  const shortcuts = useMemo(
    () =>
      Extension.create({
        name: 'pageShortcuts',
        addKeyboardShortcuts: () => ({
          'Mod-k': () => {
            setDialog({ kind: 'link' });
            return true;
          },
          // Find and replace (§9.8), rather than the browser's find.
          'Mod-f': () => {
            setFinding(true);
            return true;
          },
        }),
      }),
    [],
  );

  const view: PageView = settings.pageView;
  const end = useMemo(
    () => (
      <div className="flex shrink-0 items-center gap-1">
        <OutlineButton
          headings={outline.headings}
          onJump={jump}
          words={outline.stats.words}
          minutes={outline.stats.minutes}
        />
        <Menu>
          <MenuTrigger asChild>
            <IconButton
              label="Page view"
              icon={<FileText />}
              size="sm"
              active={view !== 'off'}
              onMouseDown={keepFocus}
            />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>Show the page</MenuLabel>
            <MenuRadioGroup
              value={view}
              onValueChange={(pageView) =>
                void saveEditorSettings(queryClient, { pageView: pageView as PageView })
              }
            >
              {PAGE_VIEWS.map((v) => (
                <MenuRadioItem key={v.value} value={v.value}>
                  {v.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </div>
    ),
    [outline, jump, view, queryClient],
  );

  const openTableMenu = (event: React.MouseEvent) => {
    if (!editor || !(event.target as HTMLElement).closest('.ProseMirror td, .ProseMirror th')) {
      return;
    }
    event.preventDefault();
    const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    // Right-clicking outside a selection of cells moves the cursor there first.
    const inSelection =
      at && at.pos >= editor.state.selection.from && at.pos <= editor.state.selection.to;
    if (at && !inSelection) editor.chain().focus().setTextSelection(at.pos).run();
    setTableMenu({ x: event.clientX, y: event.clientY });
  };

  const pinned = focused && inset > 0;
  return (
    <div
      data-page-view={view}
      className={cn(
        'flex h-full min-h-0 flex-col',
        '[--page-pad:1rem] @tablet:[--page-pad:1.75rem] @wide:[--page-pad:2.25rem]',
        compact && '@tablet:[--page-pad:1.25rem]',
      )}
    >
      <div
        className={cn(
          'flex h-10 shrink-0 items-center gap-2 border-b border-line px-(--page-pad)',
          pinned && 'fixed inset-x-0 z-40 border-t bg-panel',
        )}
        style={pinned ? { bottom: inset } : undefined}
      >
        <RichToolbar editor={editor} host={host} end={end} />
      </div>
      <div className="relative min-h-0 flex-1">
        {finding && editor && (
          <div className="absolute top-2 right-(--page-pad) z-20">
            <FindBar editor={editor} onClose={() => setFinding(false)} />
          </div>
        )}
        <div
          data-rich-scroll
          className="h-full overflow-auto [contain:strict]"
          onContextMenu={openTableMenu}
        >
          <div
            className={cn(
              'rich-sheet',
              view !== 'off' && `rich-sheet-${view}`,
              compact && 'text-sm',
            )}
          >
            <PreviewHostContext.Provider value={previewHost}>
              <RichViewHostContext.Provider value={viewHost}>
                <RichEditor
                  doc={doc}
                  label={compact ? 'Page content, second pane' : 'Page content'}
                  settings={settings}
                  host={host}
                  autoFocus={autoFocus}
                  onEditor={setEditor}
                  extra={shortcuts}
                />
                <LinkPreview editor={editor} summaryOf={linkSummary} />
              </RichViewHostContext.Provider>
            </PreviewHostContext.Provider>
          </div>
        </div>
      </div>
      {editor && <SelectionMenu editor={editor} host={host} />}
      {editor && (
        <Menu open={!!tableMenu} onOpenChange={(open) => !open && setTableMenu(null)}>
          <MenuTrigger asChild>
            <span
              aria-hidden
              className="pointer-events-none fixed size-0"
              style={{ left: tableMenu?.x ?? 0, top: tableMenu?.y ?? 0 }}
            />
          </MenuTrigger>
          <MenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
            <TableMenuItems
              editor={editor}
              state={{ canMerge: editor.can().mergeCells(), canSplit: editor.can().splitCell() }}
            />
          </MenuContent>
        </Menu>
      )}
      <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
        {editor && dialog?.kind === 'link' && (
          <LinkDialog editor={editor} onDone={() => setDialog(null)} />
        )}
        {editor && dialog?.kind === 'math' && (
          <MathDialog editor={editor} target={dialog.target} onDone={() => setDialog(null)} />
        )}
      </Dialog>
    </div>
  );
});

/** Menus float above the page, outside the scrolling (and contained) editor. */
const menuLayer = () => document.body;

/** The menu on selected text: the most used formatting, and links. */
function SelectionMenu({ editor, host }: { editor: Editor; host: RichHost }) {
  const chain = () => editor.chain().focus();
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      link: e.isActive('link'),
    }),
  });
  const tool = (label: string, icon: React.ReactNode, active: boolean, run: () => void) => (
    <IconButton
      label={label}
      icon={icon}
      size="sm"
      active={active}
      aria-pressed={active}
      onMouseDown={keepFocus}
      onClick={run}
      tooltip={false}
    />
  );
  return (
    <>
      <BubbleMenu
        editor={editor}
        pluginKey="selectionMenu"
        shouldShow={({ editor: e, view, state, from, to }) =>
          e.isEditable &&
          view.hasFocus() &&
          from !== to &&
          !(state.selection instanceof NodeSelection) &&
          !e.isActive('codeBlock') &&
          !state.selection.$from.parent.type.spec.code &&
          // Not for a selection of table cells: the table menu is for those.
          !(state.selection instanceof CellSelection)
        }
        appendTo={menuLayer}
        style={{ zIndex: 50 }}
        options={{
          strategy: 'fixed',
          placement: 'top',
          offset: 8,
          flip: true,
          shift: { padding: 8 },
        }}
      >
        <div
          role="toolbar"
          aria-label="Selected text"
          className={cn(floatingPanel, 'flex items-center gap-0.5 p-1')}
        >
          {tool('Bold', <Bold />, on.bold, () => chain().toggleBold().run())}
          {tool('Italic', <Italic />, on.italic, () => chain().toggleItalic().run())}
          {tool('Underline', <Underline />, on.underline, () => chain().toggleUnderline().run())}
          {tool('Strikethrough', <Strikethrough />, on.strike, () => chain().toggleStrike().run())}
          {tool('Inline code', <Code />, on.code, () => chain().toggleCode().run())}
          {tool('Highlight', <Highlighter />, on.highlight, () =>
            editor.isActive('highlight')
              ? chain().unsetHighlight().run()
              : chain().setHighlight({ color: RICH_FILL_COLORS[0].value }).run(),
          )}
          {tool('Link', <Link2 />, on.link, () => host.editLink())}
        </div>
      </BubbleMenu>
      <BubbleMenu
        editor={editor}
        pluginKey="linkMenu"
        shouldShow={({ editor: e, view, from, to }) =>
          view.hasFocus() && from === to && e.isActive('link')
        }
        appendTo={menuLayer}
        style={{ zIndex: 50 }}
        options={{
          strategy: 'fixed',
          placement: 'bottom-start',
          offset: 6,
          flip: true,
          shift: { padding: 8 },
        }}
      >
        <LinkBubble editor={editor} host={host} />
      </BubbleMenu>
    </>
  );
}

function LinkBubble({ editor, host }: { editor: Editor; host: RichHost }) {
  const href = useEditorState({
    editor,
    selector: ({ editor: e }) => String(e.getAttributes('link').href ?? ''),
  });
  const shown = href.startsWith('wiki:')
    ? `Page: ${decodeURIComponent(href.slice(5).split('#')[0] ?? '')}`
    : href.startsWith(ASSET_SCHEME)
      ? 'A file of this page'
      : href;
  return (
    <div
      role="toolbar"
      aria-label="Link"
      className={cn(floatingPanel, 'flex max-w-[22rem] items-center gap-1 p-1 pl-2.5')}
    >
      <span className="min-w-0 flex-1 truncate text-xs text-fg-2" title={href}>
        {shown}
      </span>
      <IconButton
        label="Open link"
        icon={<ExternalLink />}
        size="sm"
        onMouseDown={keepFocus}
        onClick={() => host.openLink(href)}
      />
      {editor.isEditable && (
        <>
          <IconButton
            label="Edit link"
            icon={<PenLine />}
            size="sm"
            onMouseDown={keepFocus}
            onClick={() => host.editLink()}
          />
          <IconButton
            label="Remove link"
            icon={<Link2Off />}
            size="sm"
            onMouseDown={keepFocus}
            onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
          />
        </>
      )}
    </div>
  );
}
