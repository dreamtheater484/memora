import {
  COLOR_IDS,
  COLUMN_SORTS,
  DUE_FILTERS,
  LANE_MODES,
  PRIORITIES,
  cardKey as keyOf,
  hasFilter,
  type BoardData,
  type Card,
  type CardFilter,
  type Column,
  type ColumnSort,
  type DueFilter,
  type LaneMode,
  type Priority,
} from '@memora/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Columns3,
  Ellipsis,
  Filter,
  Palette,
  Pencil,
  Plus,
  Rows3,
  SquareKanban,
  Trash2,
  X,
} from 'lucide-react';
import {
  Fragment,
  createContext,
  lazy,
  memo,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  IconButton,
  Input,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Sheet,
  SheetContent,
  Skeleton,
  Switch,
  toast,
} from '../components/ui';
import { errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useNow } from '../lib/useNow';
import { useNotes } from '../notes/queries';
import { PageBody, PageSaveIndicator } from '../shell/PageEditor';
import { useShell } from '../shell/store';
import { usePageDoc } from '../sync/hooks';
import { hueStyle, sectionColor } from '../theme/sections';
import {
  boardKey,
  boardQuery,
  createCard,
  createColumn,
  createLane,
  deleteCard,
  deleteColumn,
  deleteLane,
  moveBack,
  moveCard,
  projectsQuery,
  updateBoard,
  updateCard,
  updateColumn,
  updateLane,
  type MoveTarget,
} from './api';
import { askName } from './ask';
import { CardFace } from './CardFace';
import { shortDate } from './format';
import { startCardDrag, startLineDrag, useBoardDrag, type CardTarget } from './drag';
import {
  cellKey,
  layout,
  planMove,
  placeOf,
  PRIORITY_NAMES,
  type Lane,
  type Layout,
} from './model';

/*
 * A board (§9.11): its project's boards as tabs, filters, then the columns (in lanes when the
 * board has them). Cards are dragged with the pointer or moved with the keyboard; each move
 * shows at once and can be undone. The card panel opens beside the board on larger screens and
 * over it on phones.
 */

const CardPanel = lazy(() => import('./CardPanel'));

/** A linked note open beside the board (Shift-click, or "Open beside"). */
function BesidePane({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const index = useNotes();
  const navigate = useNavigate();
  const page = index.page.get(pageId);
  const doc = usePageDoc(page?.id ?? null);
  return (
    <section aria-label="Note beside the board" className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2.5 pl-4 text-sm">
        <b className="min-w-0 flex-1 truncate font-semibold">{page?.title || 'Untitled page'}</b>
        {page && <PageSaveIndicator page={page} doc={doc} compact />}
        {page && (
          <IconButton
            label="Open in the main pane"
            icon={<ArrowLeftRight />}
            onClick={() => void navigate({ to: '/p/$pageId', params: { pageId: page.id } })}
          />
        )}
        <IconButton label="Close the note" icon={<X />} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1">
        {page ? (
          <PageBody key={page.id} page={page} doc={doc} compact />
        ) : (
          <p className="p-4 text-sm text-fg-3">This note isn’t available.</p>
        )}
      </div>
    </section>
  );
}

interface BoardApi {
  board: BoardData;
  shown: Layout;
  labels: ReadonlyMap<string, BoardData['labels'][number]>;
  now: number;
  open: (cardId: string, focus?: string) => void;
  drop: (card: Card, target: CardTarget) => void;
  quickAdd: string | null;
  setQuickAdd: (cell: string | null) => void;
  focused: string | null;
  setFocused: (id: string | null) => void;
}

const BoardContext = createContext<BoardApi | null>(null);
const useBoard = () => useContext(BoardContext)!;

const DESKTOP = '(min-width: 64rem)';

/**
 * A board (`/b/:id`). `embedded` is a board in a pane of the workspace (§9.12): its open card
 * is its own, not the address's.
 */
export default function BoardView({
  boardId,
  embedded = false,
}: {
  boardId: string;
  embedded?: boolean;
}) {
  const { data: board, error } = useQuery(boardQuery(boardId));
  const route = useSearch({ strict: false }) as { card?: string; beside?: string; focus?: string };
  const [own, setOwn] = useState<{ card?: string; focus?: string }>({});
  const search: { card?: string; beside?: string; focus?: string } = embedded ? own : route;
  const navigate = useNavigate();
  const desktop = useMediaQuery(DESKTOP);
  const [filter, setFilter] = useState<CardFilter>({});
  const [archived, setArchived] = useState(false);

  const openCard = (cardId: string | null, focus?: string) =>
    embedded
      ? setOwn(cardId ? { card: cardId, ...(focus ? { focus } : {}) } : {})
      : void navigate({
          to: '/b/$boardId',
          params: { boardId },
          search: {
            ...(cardId ? { card: cardId, ...(focus ? { focus } : {}) } : {}),
            ...(search.beside ? { beside: search.beside } : {}),
          },
        });
  const closeBeside = () =>
    void navigate({
      to: '/b/$boardId',
      params: { boardId },
      search: search.card ? { card: search.card } : {},
    });

  if (error) {
    return (
      <section aria-label="Board" className="flex h-full flex-col">
        <EmptyState
          icon={<SquareKanban />}
          title="Board not found"
          description={errorMessage(error)}
        />
      </section>
    );
  }
  if (!board) {
    return (
      <section aria-label="Board" aria-busy="true" className="flex h-full flex-col gap-3 p-5">
        <Skeleton className="h-8 w-56" />
        <div className="flex gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 w-72" />
          ))}
        </div>
      </section>
    );
  }

  const panel = search.card ? (
    <Suspense fallback={null}>
      <CardPanel
        key={search.card}
        cardId={search.card}
        board={board}
        focus={search.focus}
        onClose={() => openCard(null)}
      />
    </Suspense>
  ) : null;

  return (
    <section
      aria-label={embedded ? `Board: ${board.board.name}` : 'Board'}
      className="flex h-full min-h-0"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <BoardHeader
          board={board}
          filter={filter}
          setFilter={setFilter}
          archived={archived}
          setArchived={setArchived}
        />
        {archived ? (
          <ArchiveView boardId={boardId} />
        ) : (
          <BoardGrid board={board} filter={filter} openCard={openCard} />
        )}
      </div>
      {search.beside && desktop && (
        <div className="flex w-[34rem] max-w-[45%] shrink-0 flex-col border-l border-line">
          <BesidePane pageId={search.beside} onClose={closeBeside} />
        </div>
      )}
      {panel && desktop && (
        <aside
          aria-label="Card"
          className="flex w-[27rem] max-w-[45%] shrink-0 flex-col border-l border-line"
        >
          {panel}
        </aside>
      )}
      {!desktop && (
        <Sheet open={!!panel} onOpenChange={(open) => !open && openCard(null)}>
          <SheetContent side="right" title="Card" className="w-full rounded-none">
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </section>
  );
}

// Header: project, board tabs, filters and options

function BoardHeader({
  board,
  filter,
  setFilter,
  archived,
  setArchived,
}: {
  board: BoardData;
  filter: CardFilter;
  setFilter: (f: CardFilter) => void;
  archived: boolean;
  setArchived: (a: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery(projectsQuery).data;
  const boards = (projects?.boards ?? []).filter(
    (b) => b.projectId === board.project.id && (!b.archivedAt || b.id === board.board.id),
  );
  const [renaming, setRenaming] = useState(false);
  const lanes = board.board.settings.lanes;
  const setLanes = (mode: LaneMode) =>
    void updateBoard(queryClient, board.board.id, { lanes: mode });
  const clear = () => setFilter({});
  const toggle = <T,>(list: T[] | undefined, value: T) =>
    list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value];

  const chips: { label: string; onRemove: () => void }[] = [];
  for (const id of filter.labelIds ?? []) {
    const label = board.labels.find((l) => l.id === id);
    if (label)
      chips.push({
        label: `Label: ${label.name}`,
        onRemove: () => setFilter({ ...filter, labelIds: toggle(filter.labelIds, id) }),
      });
  }
  for (const p of filter.priorities ?? []) {
    chips.push({
      label: `Priority: ${PRIORITY_NAMES[p]}`,
      onRemove: () => setFilter({ ...filter, priorities: toggle(filter.priorities, p) }),
    });
  }
  if (filter.due)
    chips.push({
      label: `Due: ${DUE_NAMES[filter.due]}`,
      onRemove: () => setFilter({ ...filter, due: undefined }),
    });
  if (filter.linked)
    chips.push({
      label: 'Has linked notes',
      onRemove: () => setFilter({ ...filter, linked: undefined }),
    });
  if (filter.completed !== undefined) {
    chips.push({
      label: filter.completed ? 'Completed only' : 'Hide completed',
      onRemove: () => setFilter({ ...filter, completed: undefined }),
    });
  }

  return (
    <header className="flex shrink-0 flex-col gap-2.5 px-4 pt-3.5 pb-2 @tablet:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="hue inline-flex shrink-0 items-center gap-1.5 text-xs text-fg-3"
          style={hueStyle(board.project.color)}
        >
          <span aria-hidden className="size-2 rounded-full bg-sec" />
          {board.project.name}
          <span aria-hidden>›</span>
        </span>
        {renaming ? (
          <Input
            aria-label="Board name"
            defaultValue={board.board.name}
            autoFocus
            wrapperClassName="h-8 w-64"
            onBlur={(e) => {
              setRenaming(false);
              const name = e.target.value.trim();
              if (name && name !== board.board.name)
                void updateBoard(queryClient, board.board.id, { name });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <h1
            className="min-w-0 truncate font-display text-2xl font-semibold tracking-tight"
            onDoubleClick={() => setRenaming(true)}
          >
            {board.board.name}
          </h1>
        )}
        {board.board.archivedAt && (
          <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-fg-2">Archived</span>
        )}
        <span className="flex-1" />
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Board options" icon={<Ellipsis />} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<Pencil />} onSelect={() => setRenaming(true)}>
              Rename board
            </MenuItem>
            <MenuSub>
              <MenuSubTrigger icon={<Rows3 />}>Swimlanes</MenuSubTrigger>
              <MenuSubContent>
                <MenuRadioGroup value={lanes} onValueChange={(v) => setLanes(v as LaneMode)}>
                  {LANE_MODES.map((mode) => (
                    <MenuRadioItem key={mode} value={mode}>
                      {LANE_NAMES[mode]}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubContent>
            </MenuSub>
            {lanes === 'custom' && (
              <MenuItem icon={<Plus />} onSelect={() => addLane(queryClient, board.board.id)}>
                Add a lane…
              </MenuItem>
            )}
            <MenuItem icon={<Columns3 />} onSelect={() => addColumn(queryClient, board.board.id)}>
              Add a column…
            </MenuItem>
            <MenuCheckboxItem checked={archived} onCheckedChange={(v) => setArchived(v === true)}>
              Show the archive
            </MenuCheckboxItem>
            <MenuSeparator />
            <MenuItem
              icon={board.board.archivedAt ? <ArchiveRestore /> : <Archive />}
              onSelect={() =>
                void updateBoard(queryClient, board.board.id, { archived: !board.board.archivedAt })
              }
            >
              {board.board.archivedAt ? 'Restore board' : 'Archive board'}
            </MenuItem>
            <MenuItem
              icon={<Trash2 />}
              danger
              onSelect={() =>
                useShell.getState().openDialog({ kind: 'delete-board', boardId: board.board.id })
              }
            >
              Delete board…
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <nav
        aria-label="Boards in this project"
        className="-mb-2 flex items-center gap-0.5 overflow-x-auto border-b border-line [scrollbar-width:none]"
      >
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-current={b.id === board.board.id ? 'page' : undefined}
            onClick={() => void navigate({ to: '/b/$boardId', params: { boardId: b.id } })}
            className={cn(
              '-mb-px h-8 shrink-0 border-b-2 px-3 text-sm whitespace-nowrap',
              b.id === board.board.id
                ? 'border-accent font-semibold text-fg'
                : 'border-transparent text-fg-2 hover:text-fg',
            )}
          >
            {b.name}
          </button>
        ))}
        <IconButton
          label="New board"
          icon={<Plus />}
          size="sm"
          onClick={() =>
            useShell.getState().openDialog({ kind: 'new-board', projectId: board.project.id })
          }
        />
      </nav>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Input
          pill
          icon={<Filter />}
          placeholder="Filter cards"
          aria-label="Filter cards"
          value={filter.text ?? ''}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          wrapperClassName="h-8 w-56 max-w-full"
        />
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost">
              Labels <ChevronDown aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {board.labels.length === 0 && <MenuLabel>No labels yet</MenuLabel>}
            {board.labels.map((l) => (
              <MenuCheckboxItem
                key={l.id}
                checked={!!filter.labelIds?.includes(l.id)}
                onCheckedChange={() =>
                  setFilter({ ...filter, labelIds: toggle(filter.labelIds, l.id) })
                }
                onSelect={(e) => e.preventDefault()}
              >
                {l.name}
              </MenuCheckboxItem>
            ))}
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost">
              Priority <ChevronDown aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {[...PRIORITIES].reverse().map((p) => (
              <MenuCheckboxItem
                key={p}
                checked={!!filter.priorities?.includes(p)}
                onCheckedChange={() =>
                  setFilter({ ...filter, priorities: toggle(filter.priorities, p) })
                }
                onSelect={(e) => e.preventDefault()}
              >
                {PRIORITY_NAMES[p]}
              </MenuCheckboxItem>
            ))}
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost">
              Due <ChevronDown aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuRadioGroup
              value={filter.due ?? 'any'}
              onValueChange={(v) =>
                setFilter({ ...filter, due: v === 'any' ? undefined : (v as DueFilter) })
              }
            >
              <MenuRadioItem value="any">Any time</MenuRadioItem>
              {DUE_FILTERS.map((d) => (
                <MenuRadioItem key={d} value={d}>
                  {DUE_NAMES[d]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost">
              More <ChevronDown aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuCheckboxItem
              checked={!!filter.linked}
              onCheckedChange={(v) => setFilter({ ...filter, linked: v === true || undefined })}
            >
              Has linked notes
            </MenuCheckboxItem>
            <MenuSeparator />
            <MenuRadioGroup
              value={filter.completed === undefined ? 'all' : filter.completed ? 'only' : 'hide'}
              onValueChange={(v) =>
                setFilter({ ...filter, completed: v === 'all' ? undefined : v === 'only' })
              }
            >
              <MenuRadioItem value="all">All cards</MenuRadioItem>
              <MenuRadioItem value="hide">Hide completed</MenuRadioItem>
              <MenuRadioItem value="only">Completed only</MenuRadioItem>
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
        {chips.length > 0 && (
          <ul aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <li
                key={chip.label}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft pr-1 pl-2.5 text-xs font-medium"
              >
                {chip.label}
                <IconButton
                  label={`Remove filter ${chip.label}`}
                  icon={<X />}
                  size="xs"
                  onClick={chip.onRemove}
                />
              </li>
            ))}
          </ul>
        )}
        {hasFilter(filter) && (
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear all
          </Button>
        )}
      </div>
    </header>
  );
}

const DUE_NAMES: Record<DueFilter, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Due this week',
  none: 'No due date',
};

const LANE_NAMES: Record<LaneMode, string> = {
  none: 'No swimlanes',
  custom: 'Own lanes',
  priority: 'By priority',
  label: 'By label',
};

const addColumn = (queryClient: ReturnType<typeof useQueryClient>, boardId: string) =>
  askName('New column', 'Column name', (name) => createColumn(queryClient, boardId, name));

const addLane = (queryClient: ReturnType<typeof useQueryClient>, boardId: string) =>
  askName('New lane', 'Lane name', (name) => createLane(queryClient, boardId, name));

// The board

interface Undo {
  card: Card;
  back: MoveTarget;
}

function BoardGrid({
  board,
  filter,
  openCard,
}: {
  board: BoardData;
  filter: CardFilter;
  openCard: (id: string | null, focus?: string) => void;
}) {
  const queryClient = useQueryClient();
  const now = useNow();
  const shown = useMemo(() => layout(board, filter, now), [board, filter, now]);
  const labels = useMemo(() => new Map(board.labels.map((l) => [l.id, l])), [board.labels]);
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const undo = useRef<Undo[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const phone = !useMediaQuery('(min-width: 40rem)');
  const [phoneColumn, setPhoneColumn] = useState(0);
  // Undo takes the card as the board has it now.
  const undoLast = async () => {
    const last = undo.current.pop();
    if (!last) return;
    const now = queryClient.getQueryData<BoardData>(boardKey(board.board.id));
    const card = now?.cards.find((c) => c.id === last.card.id);
    if (card) await moveCard(queryClient, card, last.back).catch(() => undefined);
  };

  const move = async (card: Card, target: MoveTarget) => {
    const to = board.columns.find((c) => c.id === target.columnId);
    const from = board.columns.find((c) => c.id === card.columnId);
    // Undo knows the move at once, so Ctrl+Z right away takes back this one.
    const entry = { card, back: moveBack(queryClient, card, target) };
    undo.current = [...undo.current.slice(-19), entry];
    try {
      await moveCard(queryClient, card, target);
      if (to && from && to.id !== from.id) {
        const count =
          board.cards.filter((c) => c.columnId === to.id && !c.archivedAt && c.id !== card.id)
            .length + 1;
        const over = to.wipLimit && count > to.wipLimit;
        toast({
          title: `Moved to ${to.name}`,
          ...(over ? { description: `“${to.name}” is over its limit of ${to.wipLimit}.` } : {}),
          action: { label: 'Undo', onClick: () => void undoLast() },
        });
      }
    } catch {
      // Put back by `moveCard`, with a message.
      undo.current = undo.current.filter((e) => e !== entry);
    }
  };

  const drop = (card: Card, target: CardTarget) => {
    const place = placeOf(board, shown, card);
    if (
      place.lane === target.lane &&
      place.columnId === target.columnId &&
      place.index === target.index
    )
      return;
    void move(card, planMove(board, shown, card, target.lane, target.columnId, target.index));
    setFocused(card.id);
  };

  const api: BoardApi = {
    board,
    shown,
    labels,
    now,
    open: openCard,
    drop,
    quickAdd,
    setQuickAdd,
    focused,
    setFocused,
  };

  // Keyboard: arrows move between cards, with Ctrl/Cmd+Shift they move the card (§9.11).
  const order = (columnId: string) =>
    shown.lanes.flatMap((lane) => shown.cells.get(cellKey(lane.key, columnId)) ?? []);
  // A card moved with the keyboard keeps the focus, wherever it was rendered again.
  // The move shows a moment later (and again when the server answers), so the request
  // lasts a little while.
  const pendingFocus = useRef<{ id: string; until: number } | null>(null);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (Date.now() > pending.until) {
      pendingFocus.current = null;
      return;
    }
    // Only when the focus was lost with the card's old place: never away from where it went.
    const lost = !document.activeElement || document.activeElement === document.body;
    const el = ref.current?.querySelector<HTMLElement>(`[data-kb-card="${pending.id}"]`);
    if (el && lost) el.focus();
  });
  const focusCard = (id: string) => {
    setFocused(id);
    pendingFocus.current = { id, until: Date.now() + 2000 };
    ref.current?.querySelector<HTMLElement>(`[data-kb-card="${id}"]`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"], [role="menu"]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      void undoLast();
      return;
    }
    const id = target.closest<HTMLElement>('[data-kb-card]')?.dataset.kbCard;
    const card = id ? board.cards.find((c) => c.id === id) : undefined;
    if (!mod && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      const columnId = card?.columnId ?? shown.columns[0]?.id;
      const lane = card ? placeOf(board, shown, card).lane : shown.lanes[0]?.key;
      if (columnId && lane) setQuickAdd(cellKey(lane, columnId));
      return;
    }
    if (!card) return;
    const columns = shown.columns;
    const col = columns.findIndex((c) => c.id === card.columnId);
    const list = order(card.columnId);
    const at = list.findIndex((c) => c.id === card.id);
    if (mod && e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const place = placeOf(board, shown, card);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const next = columns[col + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (!next) return;
        const cell = shown.cells.get(cellKey(place.lane, next.id)) ?? [];
        void move(
          card,
          planMove(board, shown, card, place.lane, next.id, Math.min(place.index, cell.length)),
        );
      } else {
        const index = place.index + (e.key === 'ArrowUp' ? -1 : 1);
        const cell = shown.cells.get(cellKey(place.lane, card.columnId)) ?? [];
        if (index < 0 || index >= cell.length) return;
        void move(card, planMove(board, shown, card, place.lane, card.columnId, index));
      }
      focusCard(card.id);
      return;
    }
    if (mod || e.altKey) return;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        const next = list[at + (e.key === 'ArrowUp' ? -1 : 1)];
        if (next) {
          e.preventDefault();
          focusCard(next.id);
        }
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        const other = columns[col + (e.key === 'ArrowLeft' ? -1 : 1)];
        const cards = other ? order(other.id) : [];
        const next = cards[Math.min(at, cards.length - 1)];
        if (next) {
          e.preventDefault();
          focusCard(next.id);
        }
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        openCard(card.id);
        break;
      case 'e':
        e.preventDefault();
        openCard(card.id, 'title');
        break;
      case 'l':
        e.preventDefault();
        openCard(card.id, 'labels');
        break;
      case 'd':
        e.preventDefault();
        openCard(card.id, 'due');
        break;
    }
  };

  // Phones: one column per screen, with dots saying which.
  const onScroll = () => {
    const el = ref.current;
    if (!el || !phone) return;
    setPhoneColumn(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
  };

  const lanesOn = board.board.settings.lanes !== 'none';
  const template = shown.columns
    .map((c): string =>
      c.collapsed ? '2.75rem' : phone ? 'calc(100cqw - 2rem)' : 'minmax(17.5rem, 23rem)',
    )
    .concat(phone ? [] : ['12rem'])
    .join(' ');

  if (!shown.columns.length) {
    return (
      <EmptyState
        icon={<Columns3 />}
        title="No columns yet"
        description="Add a column to start putting cards on this board."
        actions={
          <Button onClick={() => addColumn(queryClient, board.board.id)}>Add a column</Button>
        }
      />
    );
  }

  return (
    <BoardContext.Provider value={api}>
      {phone && (
        <div aria-hidden className="flex justify-center gap-1.5 pb-1">
          {shown.columns.map((c, i) => (
            <span
              key={c.id}
              className={cn(
                'size-1.5 rounded-full',
                i === phoneColumn ? 'bg-fg-2' : 'bg-line-strong',
              )}
            />
          ))}
        </div>
      )}
      {shown.hidden > 0 && (
        <p className="px-5 pb-1 text-xs text-fg-3" aria-live="polite">
          {shown.hidden} {shown.hidden === 1 ? 'card is' : 'cards are'} hidden by the filters.
        </p>
      )}
      <div
        ref={ref}
        data-kb-board
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        className={cn(
          '@container relative min-h-0 flex-1 overflow-auto px-4 pt-1 pb-4 @tablet:px-5',
          phone && 'snap-x snap-mandatory',
        )}
      >
        <div
          className="grid min-h-full gap-x-3"
          style={{
            gridTemplateColumns: template,
            gridTemplateRows: lanesOn ? undefined : 'auto minmax(0, 1fr)',
          }}
        >
          {shown.columns.map((column, i) => (
            <ColumnHead key={column.id} column={column} index={i} />
          ))}
          {!phone && (
            <div style={{ gridColumn: shown.columns.length + 1, gridRow: 1 }} className="pt-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => addColumn(queryClient, board.board.id)}
              >
                <Plus aria-hidden />
                Add column
              </Button>
            </div>
          )}
          {shown.lanes.map((lane, li) => {
            const row = lanesOn ? 2 + li * 2 : 2;
            return (
              <Fragment key={lane.key}>
                {lanesOn && <LaneHead lane={lane} row={row} />}
                <div
                  data-kb-lane={lane.key}
                  aria-hidden
                  className="pointer-events-none"
                  style={{ gridColumn: '1 / -1', gridRow: lanesOn ? `${row} / span 2` : row }}
                />
                {!lane.collapsed &&
                  shown.columns.map((column, ci) => (
                    <Cell
                      key={column.id}
                      lane={lane}
                      column={column}
                      cards={shown.cells.get(cellKey(lane.key, column.id)) ?? []}
                      gridColumn={ci + 1}
                      gridRow={lanesOn ? row + 1 : row}
                      scroll={!lanesOn}
                    />
                  ))}
              </Fragment>
            );
          })}
        </div>
      </div>
    </BoardContext.Provider>
  );
}

function ColumnHead({ column, index }: { column: Column; index: number }) {
  const { shown, board, setQuickAdd } = useBoard();
  const queryClient = useQueryClient();
  const highlighted = useBoardDrag((s) => s.kind === 'card' && s.target?.columnId === column.id);
  const before = useBoardDrag((s) => (s.kind === 'column' ? s.before : undefined));
  const dragging = useBoardDrag((s) => s.kind === 'column' && s.id === column.id);
  const [renaming, setRenaming] = useState(false);
  const [wip, setWip] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const count = shown.counts.get(column.id) ?? 0;
  const total = shown.totals.get(column.id) ?? 0;
  const over = column.wipLimit !== null && total > column.wipLimit;
  const columns = shown.columns;
  const update = (body: Parameters<typeof updateColumn>[2]) =>
    void updateColumn(queryClient, column, body).catch(() => undefined);
  const lanesOn = board.board.settings.lanes !== 'none';
  const firstLane = shown.lanes[0]?.key ?? 'none';
  const showBefore =
    before !== undefined &&
    (before === column.id || (before === null && index === columns.length - 1));

  if (column.collapsed) {
    return (
      <div
        data-kb-column={column.id}
        data-kb-column-head={column.id}
        data-kb-target={highlighted ? '' : undefined}
        style={{ gridColumn: index + 1, gridRow: lanesOn ? '1' : '1 / span 2' }}
        className={cn(
          'hue flex flex-col items-center gap-2 rounded-t-xl bg-hover py-2',
          !lanesOn && 'rounded-b-xl',
          highlighted && 'ring-2 ring-focus',
        )}
        {...(column.color
          ? {
              style: {
                ...hueStyle(column.color),
                gridColumn: index + 1,
                gridRow: lanesOn ? '1' : '1 / span 2',
              },
            }
          : {})}
      >
        <IconButton
          label={`Expand ${column.name}`}
          icon={<ChevronRight />}
          size="xs"
          onClick={() => update({ collapsed: false })}
        />
        <span className="text-xs font-semibold [writing-mode:vertical-rl]">
          {column.name} · {count}
        </span>
      </div>
    );
  }

  return (
    <div
      data-kb-column={column.id}
      data-kb-column-head={column.id}
      data-kb-target={highlighted ? '' : undefined}
      style={{ gridColumn: index + 1, gridRow: 1, ...(column.color ? hueStyle(column.color) : {}) }}
      className={cn(
        'hue relative flex snap-start items-center gap-1.5 rounded-t-xl bg-hover/70 py-1.5 pr-1 pl-3',
        highlighted && 'bg-accent-soft',
        dragging && 'opacity-50',
      )}
    >
      {showBefore && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-1 w-0.5 rounded-full bg-focus',
            before === null ? '-right-2' : '-left-2',
          )}
        />
      )}
      {column.color && <span aria-hidden className="size-2 shrink-0 rounded-full bg-sec" />}
      {renaming ? (
        <Input
          aria-label="Column name"
          defaultValue={column.name}
          autoFocus
          wrapperClassName="h-7 flex-1"
          onBlur={(e) => {
            setRenaming(false);
            const name = e.target.value.trim();
            if (name && name !== column.name) update({ name });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <h2
          className="min-w-0 flex-1 cursor-grab truncate text-sm font-semibold"
          onDoubleClick={() => setRenaming(true)}
          onPointerDown={(e) =>
            startLineDrag(e, 'column', column.id, (beforeId) => {
              if (beforeId !== column.id) update({ beforeId });
            })
          }
        >
          {column.name}
          {column.isDone && (
            <Check aria-label="Done column" className="ml-1 inline size-3.5 text-fg-3" />
          )}
        </h2>
      )}
      <span
        className={cn(
          'shrink-0 rounded-full px-1.5 text-xs tabular-nums',
          over ? 'bg-danger/14 font-semibold text-danger' : 'text-fg-3',
        )}
        title={
          column.wipLimit
            ? `Limit ${column.wipLimit}${column.wipStrict ? ' (strict)' : ''}`
            : undefined
        }
      >
        {count}
        {column.wipLimit !== null && `/${column.wipLimit}`}
        {over && <span className="sr-only">, over the limit</span>}
      </span>
      <IconButton
        label={`Add a card at the top of ${column.name}`}
        icon={<Plus />}
        size="xs"
        onClick={() => setQuickAdd(`top:${cellKey(firstLane, column.id)}`)}
      />
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={`${column.name} options`} icon={<Ellipsis />} size="xs" />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<Pencil />} onSelect={() => setRenaming(true)}>
            Rename
          </MenuItem>
          <MenuSub>
            <MenuSubTrigger icon={<Palette />}>Colour</MenuSubTrigger>
            <MenuSubContent>
              <MenuItem onSelect={() => update({ color: null })}>No colour</MenuItem>
              {COLOR_IDS.map((c) => (
                <MenuItem
                  key={c}
                  icon={<span className="hue size-3 rounded-full bg-sec" style={hueStyle(c)} />}
                  onSelect={() => update({ color: c })}
                >
                  {sectionColor(c).name}
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
          <MenuItem onSelect={() => setWip(true)}>Limit cards (WIP)…</MenuItem>
          <MenuCheckboxItem
            checked={column.isDone}
            onCheckedChange={(v) => update({ isDone: v === true })}
          >
            Done column
          </MenuCheckboxItem>
          <MenuSub>
            <MenuSubTrigger>Sort cards</MenuSubTrigger>
            <MenuSubContent>
              <MenuRadioGroup
                value={column.sort}
                onValueChange={(v) => update({ sort: v as ColumnSort })}
              >
                {COLUMN_SORTS.map((s) => (
                  <MenuRadioItem key={s} value={s}>
                    {SORT_NAMES[s]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubContent>
          </MenuSub>
          <MenuItem icon={<ChevronDown />} onSelect={() => update({ collapsed: true })}>
            Collapse
          </MenuItem>
          <MenuItem
            icon={<ArrowLeft />}
            disabled={index === 0}
            onSelect={() => update({ beforeId: columns[index - 1]!.id })}
          >
            Move left
          </MenuItem>
          <MenuItem
            icon={<ArrowRight />}
            disabled={index === columns.length - 1}
            onSelect={() => update({ beforeId: columns[index + 2]?.id ?? null })}
          >
            Move right
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Archive />} onSelect={() => update({ archived: true })}>
            Archive column
          </MenuItem>
          <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(true)}>
            Delete column…
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={wip} onOpenChange={setWip}>
        {wip && <WipDialog column={column} onDone={() => setWip(false)} />}
      </Dialog>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        {deleting && (
          <DialogContent
            size="sm"
            title={`Delete “${column.name}”?`}
            description={
              total
                ? `Its ${total} ${total === 1 ? 'card is' : 'cards are'} deleted with it, for good. Archive the column to keep them.`
                : 'The column is deleted for good.'
            }
            footer={
              <>
                <Button onClick={() => setDeleting(false)}>Cancel</Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDeleting(false);
                    void deleteColumn(queryClient, column).catch(() => undefined);
                  }}
                >
                  Delete column
                </Button>
              </>
            }
          >
            {null}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

const SORT_NAMES: Record<ColumnSort, string> = {
  manual: 'By hand',
  due: 'By due date',
  priority: 'By priority',
  created: 'Newest first',
};

function WipDialog({ column, onDone }: { column: Column; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(column.wipLimit ? String(column.wipLimit) : '');
  const [strict, setStrict] = useState(column.wipStrict);
  const save = () => {
    const n = Number(limit);
    const wipLimit = limit.trim() && Number.isInteger(n) && n > 0 ? Math.min(n, 999) : null;
    void updateColumn(queryClient, column, { wipLimit, wipStrict: strict }).catch(() => undefined);
    onDone();
  };
  return (
    <DialogContent
      size="sm"
      title={`Limit “${column.name}”`}
      description="Work in progress limits keep a column from filling up. Leave empty for no limit."
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Most cards
          <Input
            type="number"
            min={1}
            max={999}
            value={limit}
            autoFocus
            onChange={(e) => setLimit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            wrapperClassName="w-32"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-semibold">Strict</span>
            <span className="block text-xs text-fg-3">
              A full column takes no more cards; otherwise it only warns.
            </span>
          </span>
          <Switch checked={strict} onCheckedChange={setStrict} aria-label="Strict limit" />
        </label>
      </div>
    </DialogContent>
  );
}

function LaneHead({ lane, row }: { lane: Lane; row: number }) {
  const { board, shown } = useBoard();
  const queryClient = useQueryClient();
  const before = useBoardDrag((s) => (s.kind === 'lane' ? s.before : undefined));
  const count = shown.columns.reduce(
    (n, c) => n + (shown.cells.get(cellKey(lane.key, c.id))?.length ?? 0),
    0,
  );
  const own = lane.swimlaneId;
  const index = board.swimlanes.findIndex((l) => l.id === own);
  return (
    <div
      data-kb-lane-head={own ?? undefined}
      style={{ gridColumn: '1 / -1', gridRow: row }}
      className="relative sticky left-0 flex items-center gap-1.5 pt-3 pb-1.5"
    >
      {own && before === own && (
        <span aria-hidden className="absolute inset-x-0 top-1 h-0.5 rounded-full bg-focus" />
      )}
      {own ? (
        <IconButton
          label={lane.collapsed ? `Expand ${lane.name}` : `Collapse ${lane.name}`}
          icon={lane.collapsed ? <ChevronRight /> : <ChevronDown />}
          size="xs"
          onClick={() =>
            void updateLane(queryClient, board.board.id, own, { collapsed: !lane.collapsed }).catch(
              () => undefined,
            )
          }
        />
      ) : null}
      <h3
        className={cn(
          'text-xs font-semibold tracking-wide text-fg-2 uppercase',
          own && 'cursor-grab',
        )}
        {...(lane.color ? { style: hueStyle(lane.color as never) } : {})}
        onPointerDown={
          own
            ? (e) =>
                startLineDrag(e, 'lane', own, (beforeId) => {
                  if (beforeId !== own)
                    void updateLane(queryClient, board.board.id, own, { beforeId }).catch(
                      () => undefined,
                    );
                })
            : undefined
        }
      >
        {lane.name}
      </h3>
      <span className="text-xs text-fg-3 tabular-nums">{count}</span>
      {own && (
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={`${lane.name} options`} icon={<Ellipsis />} size="xs" />
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<Pencil />}
              onSelect={() =>
                askName(
                  'Rename lane',
                  'Lane name',
                  (name) => updateLane(queryClient, board.board.id, own, { name }),
                  lane.name,
                )
              }
            >
              Rename
            </MenuItem>
            <MenuItem
              disabled={index <= 0}
              onSelect={() =>
                void updateLane(queryClient, board.board.id, own, {
                  beforeId: board.swimlanes[index - 1]!.id,
                })
              }
            >
              Move up
            </MenuItem>
            <MenuItem
              disabled={index === board.swimlanes.length - 1}
              onSelect={() =>
                void updateLane(queryClient, board.board.id, own, {
                  beforeId: board.swimlanes[index + 2]?.id ?? null,
                })
              }
            >
              Move down
            </MenuItem>
            <MenuItem
              icon={<Trash2 />}
              danger
              onSelect={() => void deleteLane(queryClient, board.board.id, own)}
            >
              Delete lane
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    </div>
  );
}

const Cell = memo(function Cell({
  lane,
  column,
  cards,
  gridColumn,
  gridRow,
  scroll,
}: {
  lane: Lane;
  column: Column;
  cards: Card[];
  gridColumn: number;
  gridRow: number;
  scroll: boolean;
}) {
  const { board, labels, now, open, drop, quickAdd, setQuickAdd, focused, setFocused } = useBoard();
  const key = cellKey(lane.key, column.id);
  const placeholder = useBoardDrag((s) =>
    s.kind === 'card' && s.target?.lane === lane.key && s.target.columnId === column.id
      ? s.target.index
      : -1,
  );
  const height = useBoardDrag((s) => s.height);
  const dragged = useBoardDrag((s) => (s.kind === 'card' ? s.id : null));
  const highlighted = useBoardDrag((s) => s.kind === 'card' && s.target?.columnId === column.id);
  const firstFocusable = focused ?? board.cards.find((c) => !c.archivedAt)?.id;
  // The dragged card stays in the page, hidden: a finger's touch events go to the element it
  // pressed, and stop if that element leaves the page.
  const items: ReactNode[] = cards.map((card) => (
    <li key={card.id} hidden={card.id === dragged}>
      <CardFace
        card={card}
        cardKey={card.number ? keyOf(board.project, card) : `${board.project.key}-…`}
        labels={labels}
        now={now}
        tabIndex={card.id === firstFocusable ? 0 : -1}
      />
    </li>
  ));
  // One set of handlers for the cell's cards, so a card re-renders only when it changes.
  const cardAt = (e: SyntheticEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-kb-card]');
    const card = el && cards.find((c) => c.id === el.dataset.kbCard);
    return card && el ? { card, el } : null;
  };
  if (placeholder >= 0) {
    // Before the card at that place among the others, or last.
    const next = cards.filter((c) => c.id !== dragged)[placeholder];
    items.splice(
      next ? cards.indexOf(next) : cards.length,
      0,
      <li
        key="placeholder"
        aria-hidden
        data-kb-placeholder
        style={{ height }}
        className="rounded-lg border-2 border-dashed border-focus/70 bg-focus/8"
      />,
    );
  }
  if (column.collapsed) return null;
  return (
    <div
      data-kb-cell={key}
      data-kb-scroll={scroll ? '' : undefined}
      style={{ gridColumn, gridRow }}
      className={cn(
        'flex min-h-16 flex-col gap-2 bg-hover/70 px-2 pt-1 pb-2 transition-[background-color,box-shadow] duration-(--dur-fast)',
        scroll && 'min-h-0 overflow-y-auto rounded-b-xl',
        !scroll && 'rounded-lg',
        highlighted && 'bg-accent-soft shadow-[inset_0_0_0_2px_var(--focus)]',
      )}
    >
      {quickAdd === `top:${key}` && (
        <QuickAdd lane={lane} column={column} top onClose={() => setQuickAdd(null)} />
      )}
      <ul
        aria-label={`${column.name}${lane.name ? `, ${lane.name}` : ''}`}
        className="flex flex-col gap-2"
        onFocus={(e) => {
          const at = cardAt(e);
          if (at) setFocused(at.card.id);
        }}
        onClick={(e) => {
          const at = cardAt(e);
          if (at) open(at.card.id);
        }}
        onPointerDown={(e) => {
          const at = cardAt(e);
          if (at) startCardDrag(e, at.el, at.card.id, (target) => drop(at.card, target));
        }}
      >
        {items}
      </ul>
      {quickAdd === key ? (
        <QuickAdd lane={lane} column={column} onClose={() => setQuickAdd(null)} />
      ) : (
        <button
          type="button"
          onClick={() => setQuickAdd(key)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-fg-3 hover:bg-hover hover:text-fg [&_svg]:size-4"
        >
          <Plus aria-hidden />
          Add card
          <span className="sr-only">
            {' '}
            to {column.name}
            {lane.name ? `, ${lane.name}` : ''}
          </span>
        </button>
      )}
    </div>
  );
});

/** Type a title, Enter adds it and makes room for the next (§9.11). */
function QuickAdd({
  lane,
  column,
  top,
  onClose,
}: {
  lane: Lane;
  column: Column;
  top?: boolean;
  onClose: () => void;
}) {
  const { board } = useBoard();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const add = async () => {
    const text = title.trim();
    if (!text) return;
    setTitle('');
    const mode = board.board.settings.lanes;
    try {
      const card = await createCard(queryClient, board.board.id, {
        columnId: column.id,
        swimlaneId: mode === 'custom' && lane.swimlaneId ? lane.swimlaneId : null,
        title: text,
        top: !!top,
      });
      if (mode === 'priority' && lane.key !== 'none') {
        await updateCard(queryClient, card, { priority: lane.key as Priority });
      } else if (mode === 'label' && lane.key !== 'none') {
        await updateCard(queryClient, card, { labelIds: [lane.key] });
      }
    } catch {
      // Taken back by createCard, with a message.
    }
  };
  return (
    <div className="rounded-lg border border-line bg-surface p-1.5 shadow-sm">
      <textarea
        ref={ref}
        aria-label={`New card in ${column.name}`}
        placeholder="Card title"
        value={title}
        rows={2}
        maxLength={300}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void add();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        onBlur={() => !title.trim() && onClose()}
        className="w-full resize-none bg-transparent px-1.5 py-1 text-sm outline-none"
      />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto pl-1.5 text-2xs text-fg-3">Enter adds, Esc closes</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void add()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

/** Archived cards and columns, to restore or delete (§9.11). */
function ArchiveView({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient();
  const { data: archive } = useQuery(boardQuery(boardId, true));
  const { data: board } = useQuery(boardQuery(boardId));
  if (!archive || !board) return <Skeleton className="m-5 h-40" />;
  const columns = board.columns.filter((c) => c.archivedAt);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-3">
      <section aria-label="Archived columns">
        <h2 className="mb-2 text-sm font-semibold">Archived columns</h2>
        {columns.length === 0 ? (
          <p className="text-sm text-fg-3">None</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {columns.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{c.name}</span>
                <Button
                  size="sm"
                  onClick={() => void updateColumn(queryClient, c, { archived: false })}
                >
                  <ArchiveRestore aria-hidden />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Archived cards">
        <h2 className="mb-2 text-sm font-semibold">Archived cards</h2>
        {archive.cards.length === 0 ? (
          <p className="text-sm text-fg-3">None</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {archive.cards.map((card) => (
              <li key={card.id} className="flex items-center gap-2">
                <span className="w-16 shrink-0 font-mono text-xs text-fg-3">
                  {keyOf(archive.project, card)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{card.title}</span>
                <span className="hidden text-xs text-fg-3 @tablet:inline">
                  {archive.columns.find((c) => c.id === card.columnId)?.name}
                  {card.archivedAt
                    ? ` · archived ${shortDate(new Date(card.archivedAt).toISOString().slice(0, 10))}`
                    : ''}
                </span>
                <Button
                  size="sm"
                  onClick={() =>
                    void updateCard(queryClient, card, { archived: false }).then(() =>
                      queryClient.invalidateQueries({ queryKey: ['kanban', 'board', boardId] }),
                    )
                  }
                >
                  <ArchiveRestore aria-hidden />
                  Restore
                </Button>
                <IconButton
                  label={`Delete ${keyOf(archive.project, card)} for good`}
                  icon={<Trash2 />}
                  size="sm"
                  onClick={() =>
                    void deleteCard(queryClient, card)
                      .then(() =>
                        queryClient.invalidateQueries({ queryKey: ['kanban', 'board', boardId] }),
                      )
                      .catch(() => undefined)
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
