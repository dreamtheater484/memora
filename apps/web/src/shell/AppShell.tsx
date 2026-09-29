import { useQuery } from '@tanstack/react-query';
import {
  Columns2,
  FilePlus,
  FileText,
  Monitor,
  Moon,
  Notebook,
  Search,
  Sparkles,
  SquareKanban,
  Sun,
} from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { fetchHealth } from '../api';
import {
  CommandPalette,
  EmptyState,
  Sheet,
  SheetContent,
  SplitPane,
  toast,
  type PaletteItem,
} from '../components/ui';
import { cn } from '../lib/cn';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { applyAccent, hueStyle } from '../theme/sections';
import { useTheme } from '../theme/theme';
import { findSection, flatPages, NOTEBOOKS, PROJECTS } from './demo';
import { Inspector } from './Inspector';
import { NotesPane, SecondPane } from './NotesPane';
import { PageList } from './PageList';
import { Rail, Sidebar } from './Sidebar';
import { useShell } from './store';
import { TopBar } from './TopBar';

const panel = 'glass min-h-0 overflow-hidden rounded-xl';

function BoardPlaceholder({ boardId }: { boardId: string }) {
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

function BottomNav() {
  const { view, setPagesOpen, setPaletteOpen, openSection, openBoard, sectionId } = useShell();
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
      {item('Notes', <Notebook />, view.kind === 'notes', () => openSection(sectionId))}
      {item('Pages', <FileText />, false, () => setPagesOpen(true))}
      {item('Boards', <SquareKanban />, view.kind === 'board', () =>
        openBoard(PROJECTS[0]!.boards[0]!.id),
      )}
      {item('Search', <Search />, false, () => setPaletteOpen(true))}
    </nav>
  );
}

function usePaletteItems(): PaletteItem[] {
  const shell = useShell();
  const { setTheme, glass, setGlass } = useTheme();
  const ultra = useMediaQuery('(min-width: 200rem)');
  return useMemo(() => {
    const items: PaletteItem[] = [];
    for (const nb of NOTEBOOKS) {
      for (const s of nb.sections) {
        for (const p of flatPages(s.id)) {
          items.push({
            id: `page:${p.id}`,
            title: p.title,
            subtitle: `${nb.name} › ${s.name}`,
            group: 'Pages',
            icon: <FileText />,
            hint: p.edited,
            keywords: p.snippet,
            onSelect: () => {
              shell.openSection(s.id);
              shell.openPage(p.id);
            },
          });
        }
      }
    }
    for (const nb of NOTEBOOKS) {
      for (const s of nb.sections) {
        items.push({
          id: `section:${s.id}`,
          title: s.name,
          subtitle: nb.name,
          group: 'Sections',
          icon: (
            <span
              aria-hidden
              className="hue size-2.5 rounded-full bg-sec"
              style={hueStyle(s.color)}
            />
          ),
          onSelect: () => shell.openSection(s.id),
        });
      }
    }
    for (const p of PROJECTS) {
      for (const b of p.boards) {
        items.push({
          id: `board:${b.id}`,
          title: b.name,
          subtitle: p.name,
          group: 'Boards',
          icon: <SquareKanban />,
          onSelect: () => shell.openBoard(b.id),
        });
      }
    }
    items.push(
      {
        id: 'cmd:new-page',
        title: 'New page',
        group: 'Commands',
        icon: <FilePlus />,
        hint: 'Ctrl Alt N',
        onSelect: () => toast('Creating pages arrives with the editor (Phase 5).'),
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
  }, [shell, setTheme, glass, setGlass, ultra]);
}

/**
 * The responsive app shell (§9.12 of the plan). Columns appear as the window
 * grows: phone (one pane and a bottom bar), tablet (rail), desktop (sidebar
 * and page list), wide (inspector) and ultra-wide (a second editor pane).
 * Layout follows container queries on the shell itself.
 */
export function AppShell() {
  const shell = useShell();
  const { view, sectionId, navOpen, pagesOpen, paletteOpen, secondPane, split } = shell;
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const tablet = useMediaQuery('(min-width: 40rem)');
  const ultra = useMediaQuery('(min-width: 200rem)');
  const paletteItems = usePaletteItems();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    retry: 1,
  });

  // The accent and the ambient glow follow the current section.
  const accent =
    view.kind === 'board'
      ? PROJECTS.find((p) => p.boards.some((b) => b.id === view.boardId))?.color
      : findSection(sectionId)?.section.color;
  useEffect(() => {
    if (accent) applyAccent(accent);
  }, [accent]);

  // Ctrl K / Cmd K opens search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useShell.getState().setPaletteOpen(!useShell.getState().paletteOpen);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const notes = view.kind === 'notes';
  const main = notes ? <NotesPane /> : <BoardPlaceholder boardId={view.boardId} />;

  return (
    <div className="aurora-bg @container flex h-full flex-col">
      <TopBar saveState={health.isError ? 'offline' : 'saved'} />
      <div
        className={cn(
          'grid min-h-0 flex-1 gap-2.5 px-2 pb-2 @tablet:px-2.5 @tablet:pb-2.5',
          'grid-cols-[minmax(0,1fr)] @tablet:grid-cols-[4rem_minmax(0,1fr)]',
          notes
            ? '@desktop:grid-cols-[15.5rem_minmax(0,1fr)_17rem] @wide:grid-cols-[16.5rem_minmax(0,1fr)_18rem_18.75rem] @ultra:grid-cols-[17.5rem_minmax(0,1fr)_18.75rem_20rem]'
            : '@desktop:grid-cols-[15.5rem_minmax(0,1fr)] @wide:grid-cols-[16.5rem_minmax(0,1fr)] @ultra:grid-cols-[17.5rem_minmax(0,1fr)]',
        )}
      >
        <div className={cn(panel, 'hidden @tablet:block @desktop:hidden')}>
          <Rail />
        </div>
        <div className={cn(panel, 'hidden @desktop:block')}>
          <Sidebar />
        </div>
        {notes && ultra && secondPane ? (
          <SplitPane
            className="min-h-0"
            size={split}
            onSizeChange={shell.setSplit}
            defaultSize={56}
            min={30}
            max={75}
            label="Resize the second pane"
            first={<div className={cn(panel, 'h-full [--glass-bg:var(--surface)]')}>{main}</div>}
            second={
              <div className={cn(panel, 'h-full [--glass-bg:var(--surface)]')}>
                <SecondPane />
              </div>
            }
          />
        ) : (
          <div className={cn(panel, '[--glass-bg:var(--surface)]')}>{main}</div>
        )}
        {notes && (
          <div className={cn(panel, 'hidden @desktop:block')}>
            <PageList />
          </div>
        )}
        {notes && (
          <div className={cn(panel, 'hidden @wide:block')}>
            <Inspector />
          </div>
        )}
      </div>
      <BottomNav />

      <Sheet open={navOpen && !desktop} onOpenChange={shell.setNavOpen}>
        <SheetContent side="left" title="Navigation">
          <Sidebar />
        </SheetContent>
      </Sheet>
      <Sheet open={pagesOpen && !desktop && notes} onOpenChange={shell.setPagesOpen}>
        <SheetContent
          side={tablet ? 'right' : 'bottom'}
          title="Pages"
          className={tablet ? '' : 'h-[72dvh]'}
        >
          <PageList />
        </SheetContent>
      </Sheet>
      <CommandPalette open={paletteOpen} onOpenChange={shell.setPaletteOpen} items={paletteItems} />
    </div>
  );
}
