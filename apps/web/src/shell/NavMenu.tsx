import { COLOR_IDS, type Place } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  FolderInput,
  FolderPlus,
  LayoutTemplate,
  Palette,
  Pencil,
  Share2,
  SquarePlus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '../components/ui';
import { cn } from '../lib/cn';
import { shiftBefore } from '../notes/model';
import { isFavorite, toggleFavorite } from '../notes/places';
import { useNotesActions, useUiState } from '../notes/queries';
import { hueStyle, sectionColor } from '../theme/sections';
import { chooseSectionTemplate, pickTemplate } from '../templates/templates';
import { useCommands } from './commands';
import { useCurrent, useGo } from './location';
import { useShell, type RenameWhere } from './store';

/*
 * The menus of notebooks, section groups and sections: the navigation's rows, the phone's
 * lists and the section tabs share them. Apart from the navigation (Sidebar.tsx), which is
 * loaded when it first slides in.
 */

export type NavKind = 'notebook' | 'group' | 'section' | 'project' | 'board';

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
      <ContextMenuItem
        icon={<LayoutTemplate />}
        onSelect={() =>
          pickTemplate(
            (template) => void commands.newPage({ sectionId: section.id, template }),
            'New page from a template',
          )
        }
      >
        New page from a template…
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
      <ContextMenuItem icon={<LayoutTemplate />} onSelect={() => chooseSectionTemplate(section.id)}>
        Default template…
      </ContextMenuItem>
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
