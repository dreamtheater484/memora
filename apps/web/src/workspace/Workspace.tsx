import type { PaneTabSpec } from '@memora/shared';
import {
  Columns2,
  Ellipsis,
  FileClock,
  FileText,
  Link as LinkIcon,
  Plus,
  Search,
  SquareKanban,
  X,
} from 'lucide-react';
import {
  Fragment,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  CommandPalette,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  type PaletteItem,
} from '../components/ui';
import { useProjects } from '../kanban/projects';
import { cn } from '../lib/cn';
import { useCurrent, useGo } from '../shell/location';
import { splitPane } from './actions';
import {
  PANE_LIMIT,
  findTab,
  movedTab,
  resized,
  splitWith,
  withActive,
  withTab,
  withTarget,
  withoutPane,
  withoutTab,
  type DeviceClass,
  type Pane,
  type PaneTab,
  type Workspace,
} from './model';
import { PaneContent } from './PaneContent';
import { useTabTitle } from './titles';
import { changeWorkspace } from './store';
import { startTabDrag, useTabDrag, type TabDrop } from './tabDrag';

/*
 * The workspace (§9.12): the main pane and the panes beside it, in one row with dividers to
 * drag. Each pane has tabs; a tab can be dragged to another pane, or to a pane's edge to split
 * it off, or into the main pane to open it there.
 */

const panel = 'glass min-h-0 overflow-hidden rounded-xl [--glass-bg:var(--surface)]';

export function WorkspaceRow({
  cls,
  ws,
  main,
}: {
  cls: DeviceClass;
  ws: Workspace;
  main: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const go = useGo();
  const [picking, setPicking] = useState<string | null>(null);

  const drop = (tabId: string, target: TabDrop) => {
    const found = findTab(ws, tabId);
    if (!found) return;
    if (target.kind === 'main') {
      openInMain(go, found.tab);
      changeWorkspace(cls, (w) => withoutTab(w, tabId));
    } else if (target.kind === 'split') {
      changeWorkspace(cls, (w) => splitWith(w, tabId, target.paneId, target.side, PANE_LIMIT[cls]));
    } else {
      changeWorkspace(cls, (w) => movedTab(w, tabId, target.paneId, target.index));
    }
  };

  return (
    <div ref={row} className="flex min-h-0 min-w-0">
      <div
        data-pane="main"
        className="relative flex min-h-0 min-w-0 flex-col"
        style={{ flex: `${ws.sizes[0] ?? 100} 1 0` }}
      >
        {main}
        <DropHint paneId="main" />
      </div>
      {ws.panes.map((pane, i) => (
        <Fragment key={pane.id}>
          <Divider cls={cls} ws={ws} index={i} row={row} />
          <div
            data-pane={pane.id}
            className="relative flex min-h-0 min-w-0 flex-col"
            style={{ flex: `${ws.sizes[i + 1] ?? 0} 1 0` }}
          >
            <PaneView
              cls={cls}
              pane={pane}
              number={i + 2}
              full={ws.panes.length >= PANE_LIMIT[cls]}
              onDrop={drop}
              onPick={() => setPicking(pane.id)}
            />
            <DropHint paneId={pane.id} />
          </div>
        </Fragment>
      ))}
      <TabGhost />
      <PagePicker
        open={!!picking}
        onClose={() => setPicking(null)}
        onPick={(pageId) => {
          if (picking)
            changeWorkspace(cls, (w) => withTab(w, picking, { kind: 'page', target: pageId }));
        }}
      />
    </div>
  );
}

function openInMain(go: ReturnType<typeof useGo>, tab: PaneTabSpec) {
  if (tab.kind === 'page' && tab.target) go.page(tab.target);
  else if (tab.kind === 'board' && tab.target) go.board(tab.target);
  else if (tab.kind === 'search') go.search(tab.target ?? undefined);
}

/** The divider between two panes: drag it, or use the arrow keys. */
function Divider({
  cls,
  ws,
  index,
  row,
}: {
  cls: DeviceClass;
  ws: Workspace;
  index: number;
  row: RefObject<HTMLDivElement | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const last = useRef(0);
  const a = ws.sizes[index] ?? 0;
  const b = ws.sizes[index + 1] ?? 0;
  const move = (delta: number) => changeWorkspace(cls, (w) => resized(w, index, delta));
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') move(-step);
    else if (e.key === 'ArrowRight') move(step);
    else return;
    e.preventDefault();
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={index === 0 ? 'Resize the main pane' : `Resize pane ${index + 1}`}
      aria-orientation="vertical"
      aria-valuenow={Math.round((a / (a + b || 1)) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      data-dragging={dragging || undefined}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = e.clientX;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const width = row.current?.getBoundingClientRect().width ?? 0;
        if (!width) return;
        const delta = ((e.clientX - last.current) / width) * 100;
        last.current = e.clientX;
        move(delta);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      className="group relative flex w-2.5 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none"
    >
      <span
        aria-hidden
        className="h-10 w-[3px] rounded-full bg-transparent transition-colors duration-(--dur-fast) group-hover:bg-line-strong group-focus-visible:bg-accent group-data-dragging:bg-accent"
      />
    </div>
  );
}

function PaneView({
  cls,
  pane,
  number,
  full,
  onDrop,
  onPick,
}: {
  cls: DeviceClass;
  pane: Pane;
  number: number;
  full: boolean;
  onDrop: (tabId: string, drop: TabDrop) => void;
  onPick: () => void;
}) {
  const active = pane.tabs.find((t) => t.id === pane.active) ?? null;
  const label = `Pane ${number}`;
  const change = (update: (w: Workspace) => Workspace) => changeWorkspace(cls, update);
  const open = (spec: PaneTabSpec) => change((w) => withTab(w, pane.id, spec));
  return (
    <section aria-label={label} className={cn(panel, 'flex h-full flex-col')}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
        <div
          role="tablist"
          aria-label={`${label} tabs`}
          data-pane-tabs
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
        >
          {pane.tabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              selected={tab.id === pane.active}
              onSelect={() => change((w) => withActive(w, pane.id, tab.id))}
              onClose={() => change((w) => withoutTab(w, tab.id))}
              onDrop={(drop) => onDrop(tab.id, drop)}
            />
          ))}
        </div>
        <OpenMenu label={`Open in ${label}`} onOpen={open} onPick={onPick} />
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={`${label} options`} icon={<Ellipsis />} size="sm" />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem
              icon={<Columns2 />}
              disabled={full}
              onSelect={() =>
                splitPane(
                  cls,
                  pane.id,
                  active ? { kind: active.kind, target: active.target } : null,
                )
              }
            >
              Split right
            </MenuItem>
            {active && (
              <MenuItem icon={<X />} onSelect={() => change((w) => withoutTab(w, active.id))}>
                Close tab
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={<X />} onSelect={() => change((w) => withoutPane(w, pane.id))}>
              Close pane
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <div
        role="tabpanel"
        aria-labelledby={active ? `tab-${active.id}` : undefined}
        aria-label={active ? undefined : `${label}, empty`}
        className="min-h-0 flex-1"
      >
        {active ? (
          <PaneContent
            key={active.id}
            tab={active}
            onTarget={(target) => change((w) => withTarget(w, active.id, target))}
          />
        ) : (
          <Chooser onOpen={open} onPick={onPick} />
        )}
      </div>
    </section>
  );
}

function TabButton({
  tab,
  selected,
  onSelect,
  onClose,
  onDrop,
}: {
  tab: PaneTab;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onDrop: (drop: TabDrop) => void;
}) {
  const { title, icon } = useTabTitle(tab);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const tabs = [
        ...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
      ];
      const at = tabs.indexOf(e.currentTarget);
      const next = tabs[at + (e.key === 'ArrowLeft' ? -1 : 1)];
      next?.focus();
      next?.click();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };
  return (
    <div
      role="tab"
      id={`tab-${tab.id}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      title={`${title} (Delete closes)`}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
      onPointerDown={(e) => startTabDrag(e, tab.id, title, onDrop)}
      className={cn(
        'group flex h-8 max-w-56 min-w-0 shrink-0 cursor-default items-center gap-1.5 rounded-md pr-1 pl-2.5 text-sm outline-none select-none',
        'focus-visible:outline-2 focus-visible:outline-focus [&>svg]:size-3.5 [&>svg]:shrink-0',
        selected ? 'bg-hover font-medium text-fg' : 'text-fg-2 hover:bg-hover/60 hover:text-fg',
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{title}</span>
      {/* The tab's own close control; the keyboard closes with Delete. */}
      <span
        aria-hidden
        data-no-drag
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          'grid size-5 place-items-center rounded-sm text-fg-3 hover:bg-line hover:text-fg [&>svg]:size-3',
          !selected && 'opacity-0 group-hover:opacity-100',
        )}
      >
        <X />
      </span>
    </div>
  );
}

/** The + menu: what can be opened in a pane. */
function OpenMenu({
  label,
  onOpen,
  onPick,
}: {
  label: string;
  onOpen: (spec: PaneTabSpec) => void;
  onPick: () => void;
}) {
  const projects = useProjects();
  const boards = projects.boards.filter((b) => !b.archivedAt);
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={label} icon={<Plus />} size="sm" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<FileText />} onSelect={onPick}>
          Page…
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger icon={<SquareKanban />}>Board</MenuSubTrigger>
          <MenuSubContent>
            {boards.length === 0 && <MenuItem disabled>No boards yet</MenuItem>}
            {boards.map((b) => (
              <MenuItem key={b.id} onSelect={() => onOpen({ kind: 'board', target: b.id })}>
                {b.name}
              </MenuItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuItem icon={<Search />} onSelect={() => onOpen({ kind: 'search', target: null })}>
          Search
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LinkIcon />} onSelect={() => onOpen({ kind: 'backlinks', target: null })}>
          Backlinks of the main page
        </MenuItem>
        <MenuItem icon={<FileClock />} onSelect={() => onOpen({ kind: 'history', target: null })}>
          History of the main page
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** An empty pane: what to open in it. */
function Chooser({ onOpen, onPick }: { onOpen: (spec: PaneTabSpec) => void; onPick: () => void }) {
  const projects = useProjects();
  const boards = projects.boards.filter((b) => !b.archivedAt).slice(0, 5);
  const item = (icon: ReactNode, text: string, onClick: () => void) => (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-hover [&>svg]:size-4 [&>svg]:text-fg-3"
      >
        {icon}
        {text}
      </button>
    </li>
  );
  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-72">
        <p className="mb-2 px-3 text-sm font-semibold">Open in this pane</p>
        <ul className="flex flex-col gap-px">
          {item(<FileText />, 'A page…', onPick)}
          {boards.map((b) => (
            <Fragment key={b.id}>
              {item(<SquareKanban />, b.name, () => onOpen({ kind: 'board', target: b.id }))}
            </Fragment>
          ))}
          {item(<Search />, 'Search', () => onOpen({ kind: 'search', target: null }))}
          {item(<LinkIcon />, 'Backlinks of the main page', () =>
            onOpen({ kind: 'backlinks', target: null }),
          )}
          {item(<FileClock />, 'History of the main page', () =>
            onOpen({ kind: 'history', target: null }),
          )}
        </ul>
        <p className="mt-3 px-3 text-xs text-fg-3">
          Or drag a tab here. Ctrl+\ opens the main page in a new pane.
        </p>
      </div>
    </div>
  );
}

/** Where a dragged tab would go, shown over the pane. */
function DropHint({ paneId }: { paneId: string }) {
  const drop = useTabDrag((s) => s.drop);
  if (!drop) return null;
  let side: 'before' | 'after' | 'all' | null = null;
  if (drop.kind === 'main' && paneId === 'main') side = 'all';
  if (drop.kind === 'split' && drop.paneId === paneId) side = drop.side;
  if (drop.kind === 'tabs' && drop.paneId === paneId && drop.index === Number.MAX_SAFE_INTEGER) {
    side = 'all';
  }
  if (!side) return null;
  return (
    <div
      aria-hidden
      data-drop-hint={side}
      className={cn(
        'pointer-events-none absolute inset-y-0 z-30 rounded-xl border-2 border-focus bg-focus/10',
        side === 'all' && 'inset-x-0',
        side === 'before' && 'left-0 w-1/2',
        side === 'after' && 'right-0 w-1/2',
      )}
    />
  );
}

/** The dragged tab, next to the pointer. */
function TabGhost() {
  const tabId = useTabDrag((s) => s.tabId);
  const label = useTabDrag((s) => s.label);
  const x = useTabDrag((s) => s.x);
  const y = useTabDrag((s) => s.y);
  if (!tabId) return null;
  return (
    <div
      aria-hidden
      style={{ transform: `translate(${x + 12}px, ${y + 8}px)` }}
      className="pointer-events-none fixed top-0 left-0 z-60 rounded-md bg-surface px-2.5 py-1 text-sm font-medium shadow-lg"
    >
      {label}
    </div>
  );
}

/** Picks a page to open in a pane: recent pages first, then any by name. */
function PagePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (pageId: string) => void;
}) {
  const { index } = useCurrent();
  const items: PaletteItem[] = useMemo(
    () =>
      [...index.tree.pages]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((page) => ({
          id: page.id,
          title: page.title || 'Untitled page',
          subtitle: index.section.get(page.sectionId)?.name,
          group: 'Pages',
          icon: <FileText />,
          onSelect: () => onPick(page.id),
        })),
    [index, onPick],
  );
  return (
    <CommandPalette
      open={open}
      onOpenChange={(o) => !o && onClose()}
      items={items}
      placeholder="Open a page in this pane"
      emptyText="No pages match"
    />
  );
}
