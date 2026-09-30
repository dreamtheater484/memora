import type { ProjectIcon } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pencil, Plus, Settings2, SquarePlus, Trash2 } from 'lucide-react';
import { useMemo, useState, type HTMLAttributes } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
  PageTree,
  type TreeNode,
} from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { useCurrent, useGo } from '../shell/location';
import { useShell } from '../shell/store';
import { hueStyle, type SectionColorId } from '../theme/sections';
import { updateBoard, updateProject } from './api';
import { useProjects } from './projects';
import { askName } from './ask';
import { PROJECT_ICON } from './icons';

/*
 * Projects and their boards in the navigation (§9.11). Archived ones are listed on request.
 */

interface Node extends TreeNode {
  kind: 'project' | 'board';
  color: SectionColorId;
  icon?: ProjectIcon;
  archived: boolean;
}

export function BoardsNav() {
  const data = useProjects();
  const go = useGo();
  const { boardId, level } = useCurrent();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<Node | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const archivedCount =
    data.projects.filter((p) => p.archivedAt).length +
    data.boards.filter((b) => b.archivedAt).length;

  const nodes: Node[] = useMemo(
    () =>
      data.projects
        .filter((p) => showArchived || !p.archivedAt)
        .map((p) => ({
          id: p.id,
          label: p.name,
          kind: 'project' as const,
          color: p.color,
          icon: p.icon,
          archived: !!p.archivedAt,
          selectable: false,
          children: data.boards
            .filter((b) => b.projectId === p.id && (showArchived || !b.archivedAt))
            .map((b) => ({
              id: b.id,
              label: b.name,
              kind: 'board' as const,
              color: p.color,
              archived: !!b.archivedAt,
            })),
        })),
    [data, showArchived],
  );
  const expanded = useMemo(
    () => new Set(nodes.map((n) => n.id).filter((id) => !collapsed.has(id))),
    [nodes, collapsed],
  );

  return (
    <>
      <div
        className={cn(sectionHeading, 'flex items-center justify-between pt-3.5 pr-1 pb-1 pl-2.5')}
      >
        <h2>Boards</h2>
        <IconButton
          label="New project"
          icon={<Plus />}
          size="xs"
          onClick={() => useShell.getState().openDialog({ kind: 'new-project' })}
        />
      </div>
      {nodes.length === 0 ? (
        <p className="px-2.5 pb-2 text-xs text-fg-3">
          No projects yet.{' '}
          <button
            type="button"
            className="font-semibold text-fg-2 underline"
            onClick={() => useShell.getState().openDialog({ kind: 'new-project' })}
          >
            Create one
          </button>
        </p>
      ) : (
        <ContextMenu onOpenChange={(open) => !open && setMenu(null)}>
          <ContextMenuTrigger asChild>
            <div
              onContextMenuCapture={(e) => {
                const row = (e.target as HTMLElement).closest<HTMLElement>('[data-board-nav]');
                if (!row) return e.preventDefault();
                const id = row.dataset.boardNav!;
                const found =
                  nodes.find((n) => n.id === id) ??
                  nodes.flatMap((n) => (n.children ?? []) as Node[]).find((n) => n.id === id);
                setMenu(found ?? null);
              }}
            >
              <PageTree
                label="Boards"
                nodes={nodes}
                selectedId={level === 'board' ? boardId : null}
                expanded={expanded}
                onExpandedChange={(next) =>
                  setCollapsed(new Set(nodes.map((n) => n.id).filter((id) => !next.has(id))))
                }
                onSelect={(n) => go.board(n.id)}
                renderRow={(node) => (
                  <span
                    className={cn(
                      'hue flex min-w-0 flex-1 items-center gap-2',
                      node.archived && 'opacity-60',
                    )}
                    style={hueStyle(node.color)}
                  >
                    {node.kind === 'project' ? (
                      <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-sec text-on-accent [&>svg]:size-3">
                        {PROJECT_ICON[node.icon ?? 'square-kanban']}
                      </span>
                    ) : (
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-sec" />
                    )}
                    <span className="truncate">{node.label}</span>
                    {node.archived && <span className="text-2xs text-fg-3">archived</span>}
                  </span>
                )}
                rowProps={(node) =>
                  ({ 'data-board-nav': node.id }) as HTMLAttributes<HTMLDivElement>
                }
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {menu?.kind === 'project' && (
              <>
                <ContextMenuItem
                  icon={<SquarePlus />}
                  onSelect={() =>
                    useShell.getState().openDialog({ kind: 'new-board', projectId: menu.id })
                  }
                >
                  New board
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<Settings2 />}
                  onSelect={() =>
                    useShell.getState().openDialog({ kind: 'project', projectId: menu.id })
                  }
                >
                  Project settings and labels…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  icon={menu.archived ? <ArchiveRestore /> : <Archive />}
                  onSelect={() =>
                    void updateProject(queryClient, menu.id, { archived: !menu.archived })
                  }
                >
                  {menu.archived ? 'Restore project' : 'Archive project'}
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<Trash2 />}
                  danger
                  onSelect={() =>
                    useShell.getState().openDialog({ kind: 'delete-project', projectId: menu.id })
                  }
                >
                  Delete project…
                </ContextMenuItem>
              </>
            )}
            {menu?.kind === 'board' && (
              <>
                <ContextMenuItem
                  icon={<Pencil />}
                  onSelect={() =>
                    askName(
                      'Rename board',
                      'Board name',
                      (name) => updateBoard(queryClient, menu.id, { name }),
                      menu.label,
                    )
                  }
                >
                  Rename
                </ContextMenuItem>
                <ContextMenuItem
                  icon={menu.archived ? <ArchiveRestore /> : <Archive />}
                  onSelect={() =>
                    void updateBoard(queryClient, menu.id, { archived: !menu.archived })
                  }
                >
                  {menu.archived ? 'Restore board' : 'Archive board'}
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<Trash2 />}
                  danger
                  onSelect={() =>
                    useShell.getState().openDialog({ kind: 'delete-board', boardId: menu.id })
                  }
                >
                  Delete board…
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      )}
      {archivedCount > 0 && (
        <button
          type="button"
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
          className="mx-2.5 mb-2 text-left text-xs text-fg-3 hover:text-fg"
        >
          {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
        </button>
      )}
    </>
  );
}
