import type { ColorId, NotebookIcon } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Folder,
  Inbox,
  LayoutTemplate,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  SquareKanban,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  IconButton,
  Kbd,
  PageTree,
  type TreeNode,
} from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { dropSpot, startDrag, type DragKind } from '../lib/dnd';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import type { NotesIndex } from '../notes/model';
import { saveUiState, useNotesActions, useUiState } from '../notes/queries';
import { hueStyle } from '../theme/sections';
import { BoardsNav } from '../kanban/BoardsNav';
import { useCommands } from './commands';
import { useCurrent, useGo } from './location';
import { NavMenu, type MenuTarget, type NavKind } from './NavMenu';
import { DropIndicator, InlineRename, MoreButton, NotebookTile } from './parts';
import { FavoritePlaces, RecentPlaces } from './Places';
import { shortcutKeys } from './shortcuts';
import { useShell } from './store';

interface NavNode extends TreeNode {
  kind: NavKind;
  color: ColorId;
  icon?: NotebookIcon;
  children?: NavNode[];
}

/** What each kind of row is called in its "…" button's name. */
const MENU_NOUN: Partial<Record<NavKind, string>> = {
  notebook: 'notebook',
  group: 'section group',
  section: 'section',
};

const DROP_KIND: Partial<Record<NavKind, string>> = {
  notebook: 'nb',
  group: 'grp',
  section: 'sec',
};

/** Notebooks with their sections, then their section groups. */
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

/** `onPath`: the notebook or section group that holds the open section. */
function NavRow({ node, onPath }: { node: NavNode; onPath: boolean }) {
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
        <span className={cn('truncate', onPath && 'font-semibold text-fg')}>{node.label}</span>
      )}
      {MENU_NOUN[node.kind] && !renaming && (
        <MoreButton
          inRow
          label={`Actions for ${MENU_NOUN[node.kind]} ${node.label}`}
          className="-mr-1 ml-auto opacity-0 group-hover/nav:opacity-100 pointer-coarse:opacity-100"
        />
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

/** Keeps the navigation open beside the notes, or lets it slide away again. */
function PinButton() {
  const queryClient = useQueryClient();
  const pinned = !!useUiState().navPinned;
  return (
    <IconButton
      label="Keep the navigation open"
      icon={pinned ? <PinOff /> : <Pin />}
      size="sm"
      aria-pressed={pinned}
      onClick={() => {
        // Closed either way: docked, or, unpinned, not sliding back in on its own.
        useShell.getState().setNavOpen(false);
        saveUiState(queryClient, { navPinned: !pinned });
      }}
    />
  );
}

/**
 * Navigation: quick links, notebooks with section groups, boards, and the footer. It slides in
 * over the notes, or stays open beside them when pinned (desktop widths).
 */
export function Sidebar() {
  const current = useCurrent();
  const { index, level, section, path } = current;
  const commands = useCommands();
  const go = useGo();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ui = useUiState();
  const setPaletteOpen = useShell((s) => s.setPaletteOpen);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);

  const nodes = useMemo(() => notebookNodes(index), [index]);
  const expanded = useMemo(() => new Set(ui.expanded ?? []), [ui.expanded]);

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

  const selected = level === 'board' || section?.isInbox ? null : (section?.id ?? null);
  // The notebook and section groups around the open section stand out. When one of them is
  // folded, the outermost folded one is highlighted in the section's place.
  const around = useMemo(
    () => (selected && path?.notebook ? [path.notebook.id, ...path.groups.map((g) => g.id)] : []),
    [selected, path],
  );
  const standIn = around.find((id) => !expanded.has(id)) ?? null;

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
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <Row
              icon={<Search />}
              onClick={() => setPaletteOpen(true)}
              trailing={<Kbd>{shortcutKeys('palette')}</Kbd>}
            >
              Search
            </Row>
          </div>
          {desktop && <PinButton />}
        </div>
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
                  selectedId={selected}
                  isSelected={(n) => n.id === selected || n.id === standIn}
                  expanded={expanded}
                  onExpandedChange={(next) => saveUiState(queryClient, { expanded: [...next] })}
                  onSelect={(n) => go.section(n.id)}
                  renderRow={(node) => <NavRow node={node} onPath={around.includes(node.id)} />}
                  rowProps={(node) =>
                    ({
                      className: 'group/nav',
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

        <BoardsNav />
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
