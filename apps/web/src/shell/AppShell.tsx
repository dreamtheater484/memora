import type { Projects, UiState } from '@memora/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  BookOpen,
  Clock,
  Columns2,
  FileClock,
  FilePlus,
  FileText,
  FolderInput,
  Inbox,
  Keyboard,
  Monitor,
  Moon,
  MoveHorizontal,
  Notebook,
  PenLine,
  Search,
  Sparkles,
  SquareKanban,
  SquarePlus,
  Sun,
  Trash2,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette, Sheet, SheetContent, toast, type PaletteItem } from '../components/ui';
import { cn } from '../lib/cn';
import { useDnd } from '../lib/dnd';
import { HELP, openHelp } from '../lib/help';
import { formatRelative } from '../lib/time';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { useNow } from '../lib/useNow';
import { rememberOpened, toggleFullWidth, useRecent } from '../notes/places';
import { flushUiState, saveUiState, useUiState } from '../notes/queries';
import { applyAccent, hueStyle } from '../theme/sections';
import { useTheme } from '../theme/theme';
import { useCommands, type Commands } from './commands';
import { cardByKey, projectsQuery } from '../kanban/api';
import { OPEN_CARD_EVENT, useCardKeys } from '../kanban/keys';
import { firstBoardId, openBoards, useProjects } from '../kanban/projects';
import { splitRight } from '../workspace/actions';
import { specOfMain } from '../workspace/model';
import { useDeviceClass, useWorkspace } from '../workspace/store';
import { WorkspaceRow } from '../workspace/Workspace';
import { ShellDialogs } from './dialogs';
import { useDropRules } from './dropRules';
import { Inspector } from './Inspector';
import { isNotesLevel, useCurrent, useGo, type Current } from './location';
import { NotesPane } from './NotesPane';
import { PageList } from './PageList';
import { ContainerList, NotebookList } from './PhoneViews';
import { shortcutKeys, useShortcuts } from './shortcuts';
import { Rail, Sidebar } from './Sidebar';
import { useShell } from './store';
import { SyncBanner } from './SyncStatus';
import { TopBar } from './TopBar';

const panel = 'glass min-h-0 overflow-hidden rounded-xl';

// The recycle bin is opened now and then: loaded when it is.
const TrashView = lazy(() => import('../history/TrashView'));
const SearchView = lazy(() => import('../search/SearchView'));
const BoardView = lazy(() => import('../kanban/BoardView'));

function BottomNav({ current }: { current: Current }) {
  const go = useGo();
  const projects = useProjects();
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
      {item('Notes', <Notebook />, isNotesLevel(current.level) && !inbox, go.home)}
      {item('Search', <Search />, current.level === 'search', () => go.search())}
      {item('Boards', <SquareKanban />, current.level === 'board', () => openBoards(projects, go))}
      {item('Inbox', <Inbox />, !!inbox, () => go.section(current.index.inbox.id))}
    </nav>
  );
}

/** Card keys in notes (§9.11): the keys known, and following one to its card. */
function useCardKeyLinks(projects: Projects) {
  const navigate = useNavigate();
  useEffect(() => {
    useCardKeys.setState({ keys: new Set(projects.projects.map((p) => p.key)) });
  }, [projects]);
  useEffect(() => {
    const open = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      cardByKey(key).then(
        ({ id, boardId }) =>
          void navigate({ to: '/b/$boardId', params: { boardId }, search: { card: id } }),
        () => toast({ title: `There is no card ${key}`, tone: 'error' }),
      );
    };
    window.addEventListener(OPEN_CARD_EVENT, open);
    return () => window.removeEventListener(OPEN_CARD_EVENT, open);
  }, [navigate]);
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

function usePaletteItems(current: Current, commands: Commands, query: string): PaletteItem[] {
  const { index } = current;
  const go = useGo();
  const recent = useRecent();
  const ui = useUiState();
  const queryClient = useQueryClient();
  const { setTheme, glass, setGlass } = useTheme();
  const cls = useDeviceClass();
  const now = useNow();
  const projects = useProjects();
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
    for (const p of projects.projects) {
      if (p.archivedAt) continue;
      for (const b of projects.boards) {
        if (b.projectId !== p.id || b.archivedAt) continue;
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
    items.push({
      id: 'cmd:new-project',
      title: 'New project',
      group: 'Commands',
      icon: <SquareKanban />,
      onSelect: () => useShell.getState().openDialog({ kind: 'new-project' }),
    });
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
        {
          id: 'cmd:new-markdown-page',
          title: 'New Markdown page',
          group: 'Commands',
          icon: <FilePlus />,
          onSelect: () => void commands.newPage({ type: 'markdown' }),
        },
        {
          id: 'cmd:new-rich-page',
          title: 'New rich text page',
          group: 'Commands',
          icon: <FilePlus />,
          onSelect: () => void commands.newPage({ type: 'rich' }),
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
              {
                id: 'cmd:history',
                title: 'Page history',
                group: 'Commands',
                icon: <FileClock />,
                keywords: 'versions restore',
                onSelect: () =>
                  useShell.getState().openDialog({ kind: 'history', pageId: current.page!.id }),
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
        id: 'cmd:trash',
        title: 'Recycle bin',
        group: 'Commands',
        icon: <Trash2 />,
        keywords: 'deleted restore trash',
        onSelect: go.trash,
      },
      {
        id: 'cmd:shortcuts',
        title: 'Keyboard shortcuts',
        group: 'Commands',
        icon: <Keyboard />,
        hint: '?',
        onSelect: commands.showShortcuts,
      },
      {
        id: 'cmd:guide',
        title: 'Open the user guide',
        group: 'Commands',
        icon: <BookOpen />,
        keywords: 'help manual documentation',
        onSelect: () => openHelp(HELP.guide),
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
    if (cls) {
      items.push({
        id: 'cmd:split',
        title: current.page ? 'Open the page in a new pane' : 'Open a new pane',
        group: 'Commands',
        icon: <Columns2 />,
        hint: shortcutKeys('split-pane'),
        keywords: 'split pane side by side workspace',
        onSelect: () => splitRight(cls, specOfMain(current.page?.id, current.boardId)),
      });
    }
    if (current.page?.type === 'markdown') {
      const page = current.page;
      const full = !!ui.fullWidth?.includes(page.id);
      items.push({
        id: 'cmd:full-width',
        title: full ? 'Show the page at a readable width' : 'Show the page at full width',
        group: 'Commands',
        icon: <MoveHorizontal />,
        keywords: 'wide width line length',
        onSelect: () => toggleFullWidth(queryClient, ui, page.id),
      });
    }
    // A rich page's text fills the pane unless its edge was dragged: this undoes that.
    if (current.page?.type === 'rich' && ui.pageWidths?.[current.page.id]) {
      const page = current.page;
      items.push({
        id: 'cmd:fit-text',
        title: 'Fit the text to the pane',
        group: 'Commands',
        icon: <MoveHorizontal />,
        keywords: 'wide width full text',
        onSelect: () => saveUiState(queryClient, { pageWidths: { [page.id]: null } }, 0),
      });
    }
    // Full-text search (§9.8), for what typing here doesn't find by name.
    const words = query.trim();
    items.push({
      id: 'cmd:search',
      title: words ? `Search all pages for “${words}”` : 'Search all pages',
      group: 'Search',
      icon: <Search />,
      hint: shortcutKeys('search'),
      keywords: `${words} find full text`,
      onSelect: () => go.search(words || undefined),
    });
    // With nothing typed, recent pages come first.
    if (!words) {
      const opened = recent
        .filter((r) => r.type === 'page')
        .map((r) => index.page.get(r.id))
        .filter((p) => !!p)
        .slice(0, 8);
      items.unshift(
        ...opened.map((page) => ({
          id: `recent:${page.id}`,
          title: page.title || 'Untitled page',
          subtitle: pathLabel(page.sectionId),
          group: 'Recent',
          icon: <Clock />,
          onSelect: () => go.page(page.id),
        })),
      );
    }
    return items;
  }, [
    query,
    recent,
    index,
    current.section,
    current.page,
    current.notebook,
    commands,
    go,
    setTheme,
    glass,
    setGlass,
    cls,
    ui,
    queryClient,
    current.boardId,
    now,
    projects,
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
  const { navOpen, pagesOpen, paletteOpen } = shell;
  const current = useCurrent();
  const { level, section, page } = current;
  const commands = useCommands();
  const go = useGo();
  const queryClient = useQueryClient();
  const ui = useUiState();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const tablet = useMediaQuery('(min-width: 40rem)');
  const [paletteQuery, setPaletteQuery] = useState('');
  const paletteItems = usePaletteItems(current, commands, paletteQuery);
  useDropRules(commands);

  // The accent and the ambient glow follow the current section.
  const projects = useProjects();
  useCardKeyLinks(projects);
  // Panes beside the main one on wide screens (§9.12).
  const boardsKnown = useQuery(projectsQuery).status !== 'pending';
  const { cls, ws } = useWorkspace(boardsKnown ? firstBoardId(projects) : undefined);
  const accent =
    level === 'board'
      ? projects.projects.find(
          (p) => p.id === projects.boards.find((b) => b.id === current.boardId)?.projectId,
        )?.color
      : section?.color;
  useEffect(() => {
    if (accent) applyAccent(accent);
  }, [accent]);

  // Remember the open section, and the open page of each section, for the next visit.
  const sectionId = isNotesLevel(level) ? section?.id : undefined;
  const pageId = page?.id;
  useEffect(() => {
    if (!sectionId) return;
    const patch: UiState = {};
    if (ui.lastSectionId !== sectionId) patch.lastSectionId = sectionId;
    if (pageId && ui.lastPages?.[sectionId] !== pageId) patch.lastPages = { [sectionId]: pageId };
    if (Object.keys(patch).length) saveUiState(queryClient, patch);
    // Recent pages (§9.9): the one shown in the main pane.
    if (pageId) rememberOpened(queryClient, ui, { type: 'page', id: pageId });
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
    search: () => go.search(),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
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
    'split-pane': () => {
      if (cls) splitRight(cls, specOfMain(page?.id, current.boardId));
      else toast({ title: 'Panes side by side need a wider window.' });
    },
  });

  const notes = isNotesLevel(level);
  const phone = !tablet;
  const left = ui.pageListSide === 'left';

  let main: ReactNode;
  if (level === 'trash' || level === 'search') {
    main = (
      <Suspense fallback={null}>{level === 'trash' ? <TrashView /> : <SearchView />}</Suspense>
    );
  } else if (!notes) {
    main = (
      <Suspense fallback={null}>
        {current.boardId && <BoardView key={current.boardId} boardId={current.boardId} />}
      </Suspense>
    );
  } else if (phone && !current.missing && level === 'home') main = <NotebookList />;
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
      {/* The first stop for the keyboard: past the bars and navigation, to the content. */}
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-semibold shadow-lg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to the content
      </a>
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
        {cls && ws && ws.panes.length > 0 ? (
          <WorkspaceRow
            cls={cls}
            ws={ws}
            main={
              <main
                id="main-content"
                tabIndex={-1}
                className={cn(panel, 'h-full outline-none [--glass-bg:var(--surface)]')}
              >
                {main}
              </main>
            }
          />
        ) : (
          <main
            id="main-content"
            tabIndex={-1}
            className={cn(panel, 'outline-none [--glass-bg:var(--surface)]')}
          >
            {main}
          </main>
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
      <CommandPalette
        open={paletteOpen}
        onOpenChange={(open) => {
          shell.setPaletteOpen(open);
          setPaletteQuery('');
        }}
        onQueryChange={setPaletteQuery}
        items={paletteItems}
      />
      <ShellDialogs />
      <DragOverlay />
    </div>
  );
}
