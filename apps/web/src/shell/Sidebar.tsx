import { COLOR_IDS, type ColorId, type NotebookIcon, type Place } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  Folder,
  FolderInput,
  FolderPlus,
  Inbox,
  LayoutTemplate,
  PanelLeft,
  Palette,
  Pencil,
  Plus,
  Search,
  Settings,
  SquareKanban,
  Share2,
  SquarePlus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  IconButton,
  Kbd,
  PageTree,
  toast,
  type TreeNode,
} from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { dropSpot, startDrag, type DragKind } from '../lib/dnd';
import { shiftBefore, type NotesIndex } from '../notes/model';
import { isFavorite, toggleFavorite } from '../notes/places';
import { saveUiState, useNotesActions, useUiState } from '../notes/queries';
import { hueStyle, sectionColor } from '../theme/sections';
import { useCommands } from './commands';
import { PROJECTS } from './demo';
import { isNotesLevel, useCurrent, useGo } from './location';
import { DropIndicator, InlineRename, NotebookTile } from './parts';
import { FavoritePlaces, RecentPlaces } from './Places';
import { shortcutKeys } from './shortcuts';
import { useShell, type RenameWhere } from './store';

type NavKind = 'notebook' | 'group' | 'section' | 'project' | 'board';

interface NavNode extends TreeNode {
  kind: NavKind;
  color: ColorId;
  icon?: NotebookIcon;
  children?: NavNode[];
}

const DROP_KIND: Partial<Record<NavKind, string>> = {
  notebook: 'nb',
  group: 'grp',
  section: 'sec',
};

/** Notebooks with their sections, then their section groups (as OneNote orders them). */
function notebookNodes(index: NotesIndex): NavNode[] {
  const level = (notebookId: string, groupId: string | null, color: ColorId): NavNode[] => [
    ...index
      .sectionsIn(notebookId, groupId)
      .map((s): NavNode => ({ id: s.id, label: s.name, kind: 'section', color: s.color })),
    ...index.groupsIn(notebookId, groupId).map((g): NavNode => ({
      id: g.id,
      label: g.name,
      kind: 'group',
      color,
      selectable: false,
      children: level(notebookId, g.id, color),
    })),
  ];
  return index.notebooks.map((nb) => ({
    id: nb.id,
    label: nb.name,
    kind: 'notebook',
    color: nb.color,
    icon: nb.icon,
    selectable: false,
    children: level(nb.id, null, nb.color),
  }));
}

function boardNodes(): NavNode[] {
  return PROJECTS.map((p) => ({
    id: p.id,
    label: p.name,
    kind: 'project',
    color: p.color,
    selectable: false,
    children: p.boards.map((b) => ({ id: b.id, label: b.name, kind: 'board', color: p.color })),
  }));
}

function NavRow({ node }: { node: NavNode }) {
  const renaming = useShell((s) =>
    s.renaming?.where === 'nav' && s.renaming.id === node.id ? s.renaming : null,
  );
  const actions = useNotesActions();
  const dropKind = DROP_KIND[node.kind];
  return (
    <span className="hue flex min-w-0 flex-1 items-center gap-2" style={hueStyle(node.color)}>
      {node.kind === 'notebook' && <NotebookTile icon={node.icon ?? 'notebook'} />}
      {node.kind === 'project' && (
        <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-sec text-on-accent">
          <SquareKanban className="size-3" strokeWidth={2.2} />
        </span>
      )}
      {node.kind === 'group' && <Folder className="size-4 shrink-0 text-fg-3" />}
      {(node.kind === 'section' || node.kind === 'board') && (
        <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-sec" />
      )}
      {renaming ? (
        <InlineRename
          value={node.label}
          label={node.kind === 'group' ? 'Section group name' : 'Section name'}
          onDone={(name) => {
            useShell.getState().setRenaming(null);
            if (!name) return;
            if (renaming.kind === 'group') void actions.renameGroup(node.id, name);
            else void actions.updateSection(node.id, { name });
          }}
        />
      ) : (
        <span className="truncate">{node.label}</span>
      )}
      {dropKind && <DropIndicator kind={dropKind} id={node.id} />}
    </span>
  );
}

function Heading({
  children,
  onAdd,
  addLabel,
}: {
  children: ReactNode;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div
      className={cn(sectionHeading, 'flex items-center justify-between pt-3.5 pr-1 pb-1 pl-2.5')}
    >
      <h2>{children}</h2>
      <IconButton label={addLabel} icon={<Plus />} size="xs" onClick={onAdd} />
    </div>
  );
}

function Row({
  icon,
  children,
  trailing,
  onClick,
  current,
}: {
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  current?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex h-[1.875rem] w-full items-center gap-2 rounded-sm px-2 text-left text-base whitespace-nowrap [&>svg]:size-4 [&>svg]:shrink-0',
        current
          ? 'bg-active font-semibold text-fg shadow-card'
          : 'text-fg-2 hover:bg-hover hover:text-fg',
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {trailing && <span className="ml-auto">{trailing}</span>}
    </button>
  );
}

const soon = (what: string, phase: number) => () => toast(`${what} arrives in Phase ${phase}.`);

export interface MenuTarget {
  kind: NavKind;
  id: string;
}

/** Right-click (or long-press) menu for the notebook, group or section under the pointer. */
export function NavMenu({
  target,
  where = 'nav',
}: {
  target: MenuTarget | null;
  where?: RenameWhere;
}) {
  const current = useCurrent();
  const { index } = current;
  const commands = useCommands();
  const actions = useNotesActions();
  const go = useGo();
  const shell = useShell.getState;
  if (!target) return null;

  if (target.kind === 'notebook') {
    const nb = index.notebook.get(target.id);
    if (!nb) return null;
    const up = shiftBefore(index.notebooks, nb.id, -1);
    const down = shiftBefore(index.notebooks, nb.id, 1);
    return (
      <>
        <ContextMenuItem
          icon={<SquarePlus />}
          onSelect={() => void commands.newSection(nb.id, null, where)}
        >
          New section
        </ContextMenuItem>
        <ContextMenuItem
          icon={<FolderPlus />}
          onSelect={() => void commands.newGroup(nb.id, null, where)}
        >
          New section group
        </ContextMenuItem>
        <ContextMenuSeparator />
        <FavoriteItem place={{ type: 'notebook', id: nb.id }} />
        <ContextMenuItem icon={<Pencil />} onSelect={() => commands.editNotebook(nb.id)}>
          Rename, colour and icon…
        </ContextMenuItem>
        <ContextMenuItem
          icon={<ArrowUp />}
          disabled={!up}
          onSelect={() => up && void actions.moveNotebook(nb.id, up.beforeId)}
        >
          Move up
        </ContextMenuItem>
        <ContextMenuItem
          icon={<ArrowDown />}
          disabled={!down}
          onSelect={() => down && void actions.moveNotebook(nb.id, down.beforeId)}
        >
          Move down
        </ContextMenuItem>
        <ContextMenuItem
          icon={<Share2 />}
          onSelect={() => shell().openDialog({ kind: 'export', scope: 'notebook', id: nb.id })}
        >
          Export…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Trash2 />} danger onSelect={() => commands.deleteNotebook(nb.id)}>
          Delete notebook
        </ContextMenuItem>
      </>
    );
  }

  if (target.kind === 'group') {
    const group = index.group.get(target.id);
    if (!group) return null;
    return (
      <>
        <ContextMenuItem
          icon={<SquarePlus />}
          onSelect={() => void commands.newSection(group.notebookId, group.id, where)}
        >
          New section
        </ContextMenuItem>
        <ContextMenuItem
          icon={<FolderPlus />}
          onSelect={() => void commands.newGroup(group.notebookId, group.id, where)}
        >
          New section group
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<Pencil />}
          onSelect={() => {
            if (where === 'list') go.group(group.id);
            shell().setRenaming({ kind: 'group', id: group.id, where });
          }}
        >
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          icon={<FolderInput />}
          onSelect={() => shell().openDialog({ kind: 'move', type: 'group', ids: [group.id] })}
        >
          Move to…
        </ContextMenuItem>
        <ContextMenuItem
          icon={<Share2 />}
          onSelect={() => shell().openDialog({ kind: 'export', scope: 'group', id: group.id })}
        >
          Export…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Trash2 />} danger onSelect={() => commands.deleteGroup(group.id)}>
          Delete section group
        </ContextMenuItem>
      </>
    );
  }

  if (target.kind === 'section') {
    const section = index.section.get(target.id);
    if (!section) return null;
    return <SectionMenuItems sectionId={section.id} where={where} />;
  }
  return null;
}

/** Stars or unstars a section or notebook (§9.9). */
function FavoriteItem({ place }: { place: Place }) {
  const queryClient = useQueryClient();
  const ui = useUiState();
  const on = isFavorite(ui.favorites ?? [], place);
  return (
    <ContextMenuItem
      icon={on ? <StarOff /> : <Star />}
      onSelect={() => toggleFavorite(queryClient, ui, place)}
    >
      {on ? 'Remove from favourites' : 'Add to favourites'}
    </ContextMenuItem>
  );
}

/** Actions for a section, shared by its navigation row and its tab. */
export function SectionMenuItems({ sectionId, where }: { sectionId: string; where: RenameWhere }) {
  const { index } = useCurrent();
  const commands = useCommands();
  const actions = useNotesActions();
  const go = useGo();
  const section = index.section.get(sectionId);
  if (!section) return null;
  const siblings = section.notebookId ? index.sectionsIn(section.notebookId, section.groupId) : [];
  const up = shiftBefore(siblings, section.id, -1);
  const down = shiftBefore(siblings, section.id, 1);
  const move = (to: { beforeId: string | null } | null) =>
    to &&
    section.notebookId &&
    void actions.moveSection(section.id, {
      notebookId: section.notebookId,
      groupId: section.groupId,
      beforeId: to.beforeId,
    });
  return (
    <>
      <ContextMenuItem
        icon={<SquarePlus />}
        onSelect={() => void commands.newPage({ sectionId: section.id })}
      >
        New page
      </ContextMenuItem>
      <FavoriteItem place={{ type: 'section', id: section.id }} />
      {!section.isInbox && (
        <ContextMenuItem
          icon={<Pencil />}
          shortcut="F2"
          onSelect={() => {
            go.section(section.id);
            useShell.getState().setRenaming({ kind: 'section', id: section.id, where });
          }}
        >
          Rename
        </ContextMenuItem>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger icon={<Palette />}>Colour</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {COLOR_IDS.map((color) => (
            <ContextMenuItem
              key={color}
              icon={
                <span
                  aria-hidden
                  className="hue size-3 rounded-full bg-sec"
                  style={hueStyle(color)}
                />
              }
              onSelect={() => void actions.updateSection(section.id, { color })}
              className={cn(section.color === color && 'font-semibold')}
            >
              {sectionColor(color).name}
              {section.color === color ? ' (current)' : ''}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem
        icon={<Share2 />}
        onSelect={() =>
          useShell.getState().openDialog({ kind: 'export', scope: 'section', id: section.id })
        }
      >
        Export…
      </ContextMenuItem>
      {!section.isInbox && (
        <>
          <ContextMenuItem
            icon={<FolderInput />}
            onSelect={() =>
              useShell.getState().openDialog({ kind: 'move', type: 'section', ids: [section.id] })
            }
          >
            Move to…
          </ContextMenuItem>
          <ContextMenuItem icon={<ArrowUp />} disabled={!up} onSelect={() => move(up)}>
            {where === 'tabs' ? 'Move left' : 'Move up'}
          </ContextMenuItem>
          <ContextMenuItem icon={<ArrowDown />} disabled={!down} onSelect={() => move(down)}>
            {where === 'tabs' ? 'Move right' : 'Move down'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<Trash2 />}
            danger
            onSelect={() => commands.deleteSection(section.id)}
          >
            Delete section
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

/** Navigation: quick links, notebooks with section groups, boards, and the footer. */
export function Sidebar() {
  const current = useCurrent();
  const { index, level, section, path, boardId } = current;
  const commands = useCommands();
  const go = useGo();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ui = useUiState();
  const setPaletteOpen = useShell((s) => s.setPaletteOpen);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);

  const nodes = useMemo(() => notebookNodes(index), [index]);
  const boards = useMemo(() => boardNodes(), []);
  const expanded = useMemo(() => new Set(ui.expanded ?? []), [ui.expanded]);
  const [boardsExpanded, setBoardsExpanded] = useState(() => new Set([PROJECTS[0]!.id]));

  // The way to the open section stays unfolded.
  const sectionId = section?.id;
  useEffect(() => {
    if (!path?.notebook) return;
    const needed = [path.notebook.id, ...path.groups.map((g) => g.id)];
    if (needed.every((id) => expanded.has(id))) return;
    saveUiState(queryClient, { expanded: [...new Set([...expanded, ...needed])] });
    // Only when another section opens; folding the current notebook stays possible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const selected = level === 'board' ? null : (section?.id ?? null);

  const dragItem = (node: NavNode) => {
    const kind: DragKind | undefined =
      node.kind === 'notebook' || node.kind === 'group' || node.kind === 'section'
        ? node.kind
        : undefined;
    return kind ? { kind, ids: [node.id], label: node.label } : null;
  };

  return (
    <nav aria-label="Navigation" className="flex h-full min-h-0 flex-col">
      <div data-drop-scroll className="min-h-0 flex-1 overflow-auto px-2 pt-2.5 pb-3">
        <Row
          icon={<Search />}
          onClick={() => setPaletteOpen(true)}
          trailing={<Kbd>{shortcutKeys('palette')}</Kbd>}
        >
          Search
        </Row>
        <div className="relative" {...dropSpot('sec', index.inbox.id)}>
          <Row
            icon={<Inbox />}
            onClick={() => go.section(index.inbox.id)}
            current={section?.isInbox && level !== 'board'}
            trailing={
              <span className="text-xs text-fg-3 tabular-nums">
                {index.pagesOf(index.inbox.id).length || ''}
              </span>
            }
          >
            Inbox
          </Row>
          <DropIndicator kind="sec" id={index.inbox.id} />
        </div>
        <RecentPlaces />
        <FavoritePlaces />

        <Heading addLabel="New notebook" onAdd={commands.newNotebook}>
          Notebooks
        </Heading>
        {nodes.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-fg-3">
            No notebooks yet.{' '}
            <button
              type="button"
              className="font-semibold text-accent"
              onClick={commands.newNotebook}
            >
              Create one
            </button>
          </p>
        ) : (
          <ContextMenu onOpenChange={(open) => !open && setMenuTarget(null)}>
            <ContextMenuTrigger asChild>
              <div
                onContextMenuCapture={(e) => {
                  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-nav-kind]');
                  if (!row) return e.preventDefault();
                  setMenuTarget({ kind: row.dataset.navKind as NavKind, id: row.dataset.navId! });
                }}
              >
                <PageTree
                  label="Notebooks"
                  nodes={nodes}
                  selectedId={section?.isInbox ? null : selected}
                  expanded={expanded}
                  onExpandedChange={(next) => saveUiState(queryClient, { expanded: [...next] })}
                  onSelect={(n) => go.section(n.id)}
                  renderRow={(node) => <NavRow node={node} />}
                  rowProps={(node) =>
                    ({
                      'data-nav-kind': node.kind,
                      'data-nav-id': node.id,
                      ...(DROP_KIND[node.kind] ? dropSpot(DROP_KIND[node.kind]!, node.id) : {}),
                      onPointerDown: (e) => startDrag(e, () => dragItem(node)),
                    }) as HTMLAttributes<HTMLDivElement>
                  }
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <NavMenu target={menuTarget} />
            </ContextMenuContent>
          </ContextMenu>
        )}

        <Heading addLabel="New project" onAdd={soon('Boards', 10)}>
          Boards
        </Heading>
        <PageTree
          label="Boards"
          nodes={boards}
          selectedId={boardId}
          expanded={boardsExpanded}
          onExpandedChange={setBoardsExpanded}
          onSelect={(n) => go.board(n.id)}
          renderRow={(node) => <NavRow node={node} />}
        />
      </div>
      <div className="shrink-0 border-t border-line px-2 py-1.5">
        <Row
          icon={<LayoutTemplate />}
          onClick={() => useShell.getState().openDialog({ kind: 'templates' })}
        >
          Templates
        </Row>
        <Row icon={<Trash2 />} onClick={go.trash} current={level === 'trash'}>
          Recycle bin
        </Row>
        <Row icon={<Settings />} onClick={() => void navigate({ to: '/settings/account' })}>
          Settings
        </Row>
      </div>
    </nav>
  );
}

/** Tablet navigation: one button per notebook, plus the full navigation as a drawer. */
export function Rail() {
  const { index, notebook, level } = useCurrent();
  const go = useGo();
  const navigate = useNavigate();
  const { setNavOpen, setPaletteOpen } = useShell();
  return (
    <nav
      aria-label="Notebooks"
      className="flex h-full flex-col items-center gap-1.5 overflow-y-auto py-3"
    >
      <IconButton
        label="Show all notebooks and sections"
        icon={<PanelLeft />}
        tooltipSide="right"
        onClick={() => setNavOpen(true)}
      />
      <IconButton
        label="Inbox"
        icon={<Inbox />}
        tooltipSide="right"
        active={isNotesLevel(level) && !notebook}
        onClick={() => go.section(index.inbox.id)}
      />
      <span aria-hidden className="my-1 h-px w-6 shrink-0 bg-line" />
      {index.notebooks.map((nb) => {
        const on = isNotesLevel(level) && nb.id === notebook?.id;
        return (
          <button
            key={nb.id}
            type="button"
            title={nb.name}
            aria-label={nb.name}
            aria-current={on || undefined}
            onClick={() => go.notebook(nb.id)}
            style={hueStyle(nb.color)}
            className={cn(
              'hue grid size-9 shrink-0 place-items-center rounded-[11px]',
              on ? 'bg-sec text-on-accent' : 'bg-sec-soft text-sec-ink',
            )}
          >
            <NotebookTile icon={nb.icon} className="bg-transparent text-current [&>svg]:size-4" />
          </button>
        );
      })}
      <span aria-hidden className="my-1 h-px w-6 shrink-0 bg-line" />
      <IconButton
        label="Boards"
        icon={<SquareKanban />}
        active={level === 'board'}
        tooltipSide="right"
        onClick={() => go.board(PROJECTS[0]!.boards[0]!.id)}
      />
      <IconButton
        label="Search"
        icon={<Search />}
        tooltipSide="right"
        onClick={() => setPaletteOpen(true)}
      />
      <span className="flex-1" />
      <IconButton
        label="Recycle bin"
        icon={<Trash2 />}
        tooltipSide="right"
        active={level === 'trash'}
        onClick={go.trash}
      />
      <IconButton
        label="Settings"
        icon={<Settings />}
        tooltipSide="right"
        onClick={() => void navigate({ to: '/settings/account' })}
      />
    </nav>
  );
}
