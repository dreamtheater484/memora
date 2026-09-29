import type { UiState } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  Columns2,
  FilePlus,
  FileText,
  FolderInput,
  Inbox,
  Keyboard,
  Monitor,
  Moon,
  Notebook,
  PenLine,
  Search,
  Sparkles,
  SquareKanban,
  SquarePlus,
  Sun,
} from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  CommandPalette,
  EmptyState,
  Sheet,
  SheetContent,
  SplitPane,
  type PaletteItem,
} from '../components/ui';
import { cn } from '../lib/cn';
import { useDnd } from '../lib/dnd';
import { formatRelative } from '../lib/time';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { useNow } from '../lib/useNow';
import { flushUiState, saveUiState, useUiState } from '../notes/queries';
import { applyAccent, hueStyle } from '../theme/sections';
import { useTheme } from '../theme/theme';
import { useCommands, type Commands } from './commands';
import { PROJECTS } from './demo';
import { ShellDialogs } from './dialogs';
import { useDropRules } from './dropRules';
import { Inspector } from './Inspector';
import { useCurrent, useGo, type Current } from './location';
import { NotesPane, SecondPane } from './NotesPane';
import { PageList } from './PageList';
import { ContainerList, NotebookList } from './PhoneViews';
import { shortcutKeys, useShortcuts } from './shortcuts';
import { Rail, Sidebar } from './Sidebar';
import { useShell } from './store';
import { SyncBanner } from './SyncStatus';
import { TopBar } from './TopBar';

const panel = 'glass min-h-0 overflow-hidden rounded-xl';

function BoardPlaceholder({ boardId }: { boardId: string | null }) {
  const project = PROJECTS.find((p) => p.boards.some((b) => b.id === boardId));
  const board = project?.boards.find((b) => b.id === boardId);
  return (
    <section aria-label="Board" className="flex h-full flex-col">
      <EmptyState
        icon={<SquareKanban />}
        color={project?.color}
        title={board?.name ?? 'Board'}
        description="Kanban boards arrive in Phase 10: columns, swimlanes, cards linked to notes, and drag and drop where the whole highlighted column is the drop target."
      />
    </section>
  );
}

function BottomNav({ current }: { current: Current }) {
  const go = useGo();
  const setPaletteOpen = useShell((s) => s.setPaletteOpen);
  // Home opens the last section on larger screens; on a phone it is the notebook list.
  const inbox =
    !!current.section?.isInbox && (current.level === 'section' || current.level === 'page');
  const item = (label: string, icon: ReactNode, on: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-current={on || undefined}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-0.5 text-2xs font-medium [&>svg]:size-[1.3rem]',
        on ? 'text-fg' : 'text-fg-3',
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <nav
      aria-label="Primary"
      className="relative z-10 flex h-[calc(3.625rem+env(safe-area-inset-bottom))] shrink-0 border-t border-(--glass-edge) bg-panel pb-[env(safe-area-inset-bottom)] [backdrop-filter:var(--glass-filter)] @tablet:hidden"
    >
      {item('Notes', <Notebook />, current.level !== 'board' && !inbox, go.home)}
      {item('Search', <Search />, false, () => setPaletteOpen(true))}
      {item('Boards', <SquareKanban />, current.level === 'board', () =>
        go.board(PROJECTS[0]!.boards[0]!.id),
      )}
      {item('Inbox', <Inbox />, !!inbox, () => go.section(current.index.inbox.id))}
    </nav>
  );
}

/** What is being dragged, next to the pointer. */
function DragOverlay() {
  const item = useDnd((s) => s.item);
  const x = useDnd((s) => s.x);
  const y = useDnd((s) => s.y);
  const target = useDnd((s) => s.target);
  if (!item) return null;
  return (
    <div
      aria-hidden
      style={{ transform: `translate(${x + 14}px, ${y + 10}px)` }}
      className={cn(
        'glass-raised pointer-events-none fixed top-0 left-0 z-50 max-w-64 truncate rounded-full px-3 py-1.5 text-sm font-semibold shadow-lg',
        !target && 'opacity-70',
      )}
    >
      {item.label}
    </div>
  );
}

function usePaletteItems(current: Current, commands: Commands): PaletteItem[] {
  const { index } = current;
  const go = useGo();
  const shell = useShell();
  const { setTheme, glass, setGlass } = useTheme();
  const ultra = useMediaQuery('(min-width: 200rem)');
  const now = useNow();
  return useMemo(() => {
    const items: PaletteItem[] = [];
    const pathLabel = (sectionId: string) => {
      const path = index.pathOf(sectionId);
      if (!path) return '';
      return [path.notebook?.name, ...path.groups.map((g) => g.name), path.section.name]
        .filter(Boolean)
        .join(' › ');
    };
    for (const page of index.tree.pages) {
      items.push({
        id: `page:${page.id}`,
        title: page.title || 'Untitled page',
        subtitle: pathLabel(page.sectionId),
        group: 'Pages',
        icon: <FileText />,
        hint: formatRelative(page.updatedAt, now),
        keywords: page.snippet,
        onSelect: () => go.page(page.id),
      });
    }
    for (const s of index.tree.sections) {
      items.push({
        id: `section:${s.id}`,
        title: s.name,
        subtitle: s.isInbox ? undefined : pathLabel(s.id).split(' › ').slice(0, -1).join(' › '),
        group: 'Sections',
        icon: (
          <span
            aria-hidden
            className="hue size-2.5 rounded-full bg-sec"
            style={hueStyle(s.color)}
          />
        ),
        onSelect: () => go.section(s.id),
      });
    }
    for (const nb of index.notebooks) {
      items.push({
        id: `notebook:${nb.id}`,
        title: nb.name,
        group: 'Notebooks',
        icon: <Notebook />,
        onSelect: () => go.notebook(nb.id),
      });
    }
    for (const p of PROJECTS) {
      for (const b of p.boards) {
        items.push({
          id: `board:${b.id}`,
          title: b.name,
          subtitle: p.name,
          group: 'Boards',
          icon: <SquareKanban />,
          onSelect: () => go.board(b.id),
        });
      }
    }
    if (current.section) {
      items.push(
        {
          id: 'cmd:new-page',
          title: 'New page',
          group: 'Commands',
          icon: <FilePlus />,
          hint: shortcutKeys('new-page'),
          onSelect: () => void commands.newPage(),
        },
        ...(current.page
          ? [
              {
                id: 'cmd:new-subpage',
                title: 'New subpage',
                group: 'Commands',
                icon: <FilePlus />,
                hint: shortcutKeys('new-subpage'),
                onSelect: () => void commands.newPage({ subpage: true }),
              },
              {
                id: 'cmd:move',
                title: 'Move or copy this page…',
                group: 'Commands',
                icon: <FolderInput />,
                hint: shortcutKeys('move'),
                onSelect: () => commands.movePages(),
              },
            ]
          : []),
      );
    }
    items.push(
      {
        id: 'cmd:quick-note',
        title: 'Quick note',
        group: 'Commands',
        icon: <PenLine />,
        hint: shortcutKeys('quick-note'),
        keywords: 'inbox capture',
        onSelect: commands.quickNote,
      },
      {
        id: 'cmd:new-notebook',
        title: 'New notebook',
        group: 'Commands',
        icon: <Notebook />,
        onSelect: commands.newNotebook,
      },
      ...(current.notebook
        ? [
            {
              id: 'cmd:new-section',
              title: `New section in ${current.notebook.name}`,
              group: 'Commands',
              icon: <SquarePlus />,
              onSelect: () => void commands.newSection(),
            },
          ]
        : []),
      {
        id: 'cmd:shortcuts',
        title: 'Keyboard shortcuts',
        group: 'Commands',
        icon: <Keyboard />,
        hint: '?',
        onSelect: commands.showShortcuts,
      },
      {
        id: 'cmd:light',
        title: 'Use the light theme',
        group: 'Commands',
        icon: <Sun />,
        keywords: 'appearance',
        onSelect: () => setTheme('light'),
      },
      {
        id: 'cmd:dark',
        title: 'Use the dark theme',
        group: 'Commands',
        icon: <Moon />,
        keywords: 'appearance',
        onSelect: () => setTheme('dark'),
      },
      {
        id: 'cmd:system',
        title: 'Match the system theme',
        group: 'Commands',
        icon: <Monitor />,
        keywords: 'appearance',
        onSelect: () => setTheme('system'),
      },
      {
        id: 'cmd:glass',
        title: glass === 'off' ? 'Turn glass effects on' : 'Turn glass effects off',
        group: 'Commands',
        icon: <Sparkles />,
        keywords: 'appearance transparency blur solid',
        onSelect: () => setGlass(glass === 'off' ? 'auto' : 'off'),
      },
    );
    if (ultra) {
      items.push({
        id: 'cmd:split',
        title: shell.secondPane ? 'Close the second pane' : 'Open the second pane',
        group: 'Commands',
        icon: <Columns2 />,
        onSelect: () => shell.setSecondPane(!shell.secondPane),
      });
    }
    return items;
  }, [
    index,
    current.section,
    current.page,
    current.notebook,
    commands,
    go,
    shell,
    setTheme,
    glass,
    setGlass,
    ultra,
    now,
  ]);
}

/**
 * The responsive app shell (§9.12 of the plan). Columns appear as the window grows: phone
 * (one level at a time and a bottom bar), tablet (rail), desktop (sidebar and page list), wide
 * (inspector) and ultra-wide (a second editor pane). Layout follows container queries on the
 * shell itself.
 */
export function AppShell() {
  const shell = useShell();
  const { navOpen, pagesOpen, paletteOpen, secondPane, split } = shell;
  const current = useCurrent();
  const { level, section, page } = current;
  const commands = useCommands();
  const queryClient = useQueryClient();
  const ui = useUiState();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const tablet = useMediaQuery('(min-width: 40rem)');
  const ultra = useMediaQuery('(min-width: 200rem)');
  const paletteItems = usePaletteItems(current, commands);
  useDropRules(commands);

  // The accent and the ambient glow follow the current section.
  const accent =
    level === 'board'
      ? PROJECTS.find((p) => p.boards.some((b) => b.id === current.boardId))?.color
      : section?.color;
  useEffect(() => {
    if (accent) applyAccent(accent);
  }, [accent]);

  // Remember the open section, and the open page of each section, for the next visit.
  const sectionId = level === 'board' ? undefined : section?.id;
  const pageId = page?.id;
  useEffect(() => {
    if (!sectionId) return;
    const patch: UiState = {};
    if (ui.lastSectionId !== sectionId) patch.lastSectionId = sectionId;
    if (pageId && ui.lastPages?.[sectionId] !== pageId) patch.lastPages = { [sectionId]: pageId };
    if (Object.keys(patch).length) saveUiState(queryClient, patch);
    // Only when the place changes, not when the stored state catches up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, pageId]);

  // A new section starts with nothing selected; moving on closes the drawers.
  useEffect(() => {
    useShell.getState().select([], null);
  }, [sectionId]);
  useEffect(() => {
    useShell.setState({ navOpen: false, pagesOpen: false });
  }, [sectionId, pageId, level]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushUiState();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  useShortcuts({
    palette: () => shell.setPaletteOpen(!useShell.getState().paletteOpen),
    'quick-note': commands.quickNote,
    shortcuts: commands.showShortcuts,
    'new-page': () => void commands.newPage(),
    'new-subpage': () => void commands.newPage({ subpage: true }),
    rename: () => commands.rename(),
    move: () => commands.movePages(),
    delete: () => commands.deletePages(),
    indent: commands.indent,
    outdent: commands.outdent,
    'move-up': () => commands.shiftPage(-1),
    'move-down': () => commands.shiftPage(1),
    'prev-page': () => commands.stepPage(-1),
    'next-page': () => commands.stepPage(1),
    'prev-section': () => commands.stepSection(-1),
    'next-section': () => commands.stepSection(1),
  });

  const notes = level !== 'board';
  const phone = !tablet;
  const left = ui.pageListSide === 'left';

  let main: ReactNode;
  if (!notes) main = <BoardPlaceholder boardId={current.boardId} />;
  else if (phone && !current.missing && level === 'home') main = <NotebookList />;
  else if (phone && !current.missing && (level === 'notebook' || level === 'group')) {
    main = <ContainerList current={current} />;
  } else if (phone && !current.missing && level === 'section') main = <PageList />;
  else main = <NotesPane />;

  const showPageList = notes && !!section;
  const pageListPanel = (
    <div className={cn(panel, 'hidden @desktop:block')}>{desktop && <PageList />}</div>
  );

  return (
    <div className="aurora-bg @container flex h-full flex-col">
      <TopBar />
      <SyncBanner />
      <div
        className={cn(
          'grid min-h-0 flex-1 gap-2.5 px-2 pb-2 @tablet:px-2.5 @tablet:pb-2.5',
          'grid-cols-[minmax(0,1fr)] @tablet:grid-cols-[4rem_minmax(0,1fr)]',
          !showPageList
            ? '@desktop:grid-cols-[15.5rem_minmax(0,1fr)] @wide:grid-cols-[16.5rem_minmax(0,1fr)] @ultra:grid-cols-[17.5rem_minmax(0,1fr)]'
            : left
              ? '@desktop:grid-cols-[15.5rem_17rem_minmax(0,1fr)] @wide:grid-cols-[16.5rem_18rem_minmax(0,1fr)_18.75rem] @ultra:grid-cols-[17.5rem_18.75rem_minmax(0,1fr)_20rem]'
              : '@desktop:grid-cols-[15.5rem_minmax(0,1fr)_17rem] @wide:grid-cols-[16.5rem_minmax(0,1fr)_18rem_18.75rem] @ultra:grid-cols-[17.5rem_minmax(0,1fr)_18.75rem_20rem]',
        )}
      >
        <div className={cn(panel, 'hidden @tablet:block @desktop:hidden')}>
          <Rail />
        </div>
        <div className={cn(panel, 'hidden @desktop:block')}>
          <Sidebar />
        </div>
        {showPageList && left && pageListPanel}
        {notes && ultra && secondPane ? (
          <SplitPane
            className="min-h-0"
            size={split}
            onSizeChange={shell.setSplit}
            defaultSize={56}
            min={30}
            max={75}
            label="Resize the second pane"
            first={<main className={cn(panel, 'h-full [--glass-bg:var(--surface)]')}>{main}</main>}
            second={
              <div className={cn(panel, 'h-full [--glass-bg:var(--surface)]')}>
                <SecondPane />
              </div>
            }
          />
        ) : (
          <main className={cn(panel, '[--glass-bg:var(--surface)]')}>{main}</main>
        )}
        {showPageList && !left && pageListPanel}
        {showPageList && (
          <div className={cn(panel, 'hidden @wide:block')}>
            <Inspector />
          </div>
        )}
      </div>
      <BottomNav current={current} />
      {phone && notes && (level === 'home' || section?.isInbox) && (
        <button
          type="button"
          aria-label="Quick note"
          onClick={commands.quickNote}
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 grid size-14 place-items-center rounded-2xl bg-accent text-on-accent shadow-lg [&>svg]:size-6"
        >
          <PenLine />
        </button>
      )}

      <Sheet open={navOpen && !desktop} onOpenChange={shell.setNavOpen}>
        <SheetContent side="left" title="Navigation">
          <Sidebar />
        </SheetContent>
      </Sheet>
      <Sheet
        open={pagesOpen && tablet && !desktop && showPageList}
        onOpenChange={shell.setPagesOpen}
      >
        <SheetContent side={left ? 'left' : 'right'} title="Pages">
          <PageList />
        </SheetContent>
      </Sheet>
      <CommandPalette open={paletteOpen} onOpenChange={shell.setPaletteOpen} items={paletteItems} />
      <ShellDialogs />
      <DragOverlay />
    </div>
  );
}
