import { ChevronRight, Folder, FolderPlus, Inbox, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { useNotesActions } from '../notes/queries';
import { hueStyle } from '../theme/sections';
import { useCommands } from './commands';
import { useCurrent, useGo, type Current } from './location';
import { InlineRename, NotebookTile } from './parts';
import { NavMenu, type MenuTarget } from './Sidebar';
import { useShell } from './store';

/*
 * Phone drill-down (§9.12): notebooks → sections → pages → page, one level per screen, each
 * with its own URL so the back button works. Long-press an item for its menu.
 */

function Item({
  icon,
  label,
  meta,
  onClick,
  color,
  target,
}: {
  icon: ReactNode;
  label: string;
  meta?: string;
  onClick: () => void;
  color?: Parameters<typeof hueStyle>[0];
  target?: MenuTarget;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-nav-kind={target?.kind}
        data-nav-id={target?.id}
        style={color ? hueStyle(color) : undefined}
        className="hue flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-md hover:bg-hover active:bg-active"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {meta && <span className="shrink-0 text-xs text-fg-3 tabular-nums">{meta}</span>}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-3" />
      </button>
    </li>
  );
}

/** A list whose items open a menu on long press or right click. */
function MenuList({ children, label }: { children: ReactNode; label: string }) {
  const [target, setTarget] = useState<MenuTarget | null>(null);
  return (
    <ContextMenu onOpenChange={(open) => !open && setTarget(null)}>
      <ContextMenuTrigger asChild>
        <ul
          aria-label={label}
          onContextMenuCapture={(e) => {
            const item = (e.target as HTMLElement).closest<HTMLElement>('[data-nav-kind]');
            if (!item?.dataset.navKind) return e.preventDefault();
            setTarget({
              kind: item.dataset.navKind as MenuTarget['kind'],
              id: item.dataset.navId!,
            });
          }}
        >
          {children}
        </ul>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <NavMenu target={target} where="list" />
      </ContextMenuContent>
    </ContextMenu>
  );
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function NotebookList() {
  const { index } = useCurrent();
  const go = useGo();
  const commands = useCommands();
  return (
    <section
      aria-label="Notebooks"
      className="flex h-full min-h-0 flex-col overflow-auto px-2 pt-2 pb-24"
    >
      <ul>
        <Item
          icon={<Inbox className="size-5 shrink-0 text-fg-2" />}
          label="Inbox"
          meta={String(index.pagesOf(index.inbox.id).length || '')}
          onClick={() => go.section(index.inbox.id)}
        />
      </ul>
      <h2 className={cn(sectionHeading, 'px-3 pt-4 pb-1')}>Notebooks</h2>
      <MenuList label="Notebooks">
        {index.notebooks.map((nb) => (
          <Item
            key={nb.id}
            color={nb.color}
            target={{ kind: 'notebook', id: nb.id }}
            icon={<NotebookTile icon={nb.icon} className="size-7 rounded-[9px] [&>svg]:size-4" />}
            label={nb.name}
            meta={count(index.allSectionsOf(nb.id).length, 'section')}
            onClick={() => go.notebook(nb.id)}
          />
        ))}
      </MenuList>
      {index.notebooks.length === 0 && (
        <p className="px-3 py-4 text-sm text-fg-3">No notebooks yet. Create one to start.</p>
      )}
      <div className="px-3 pt-3">
        <Button onClick={commands.newNotebook}>
          <Plus /> New notebook
        </Button>
      </div>
    </section>
  );
}

/** The sections and section groups of a notebook, or of a group. */
export function ContainerList({ current }: { current: Current }) {
  const { index, notebook, group } = current;
  const go = useGo();
  const commands = useCommands();
  const actions = useNotesActions();
  const groupId = current.level === 'group' ? (group?.id ?? null) : null;
  const renaming = useShell(
    (s) => s.renaming?.where === 'list' && s.renaming.kind === 'group' && s.renaming.id === groupId,
  );
  if (!notebook) return null;
  const sections = index.sectionsIn(notebook.id, groupId);
  const groups = index.groupsIn(notebook.id, groupId);
  return (
    <section
      aria-label={group && groupId ? group.name : notebook.name}
      className="flex h-full min-h-0 flex-col overflow-auto px-2 pt-2 pb-24"
    >
      {renaming && group && (
        <div className="flex px-3 pb-2">
          <InlineRename
            value={group.name}
            label="Section group name"
            className="h-9 text-md"
            onDone={(name) => {
              useShell.getState().setRenaming(null);
              if (name) void actions.renameGroup(group.id, name);
            }}
          />
        </div>
      )}
      <MenuList label="Sections">
        {sections.map((s) => (
          <Item
            key={s.id}
            color={s.color}
            target={{ kind: 'section', id: s.id }}
            icon={<span aria-hidden className="ml-1 size-3 shrink-0 rounded-full bg-sec" />}
            label={s.name}
            meta={count(index.pagesOf(s.id).length, 'page')}
            onClick={() => go.section(s.id)}
          />
        ))}
        {groups.map((g) => (
          <Item
            key={g.id}
            target={{ kind: 'group', id: g.id }}
            icon={<Folder className="size-5 shrink-0 text-fg-3" />}
            label={g.name}
            meta={count(index.allSectionsOf(notebook.id, g.id).length, 'section')}
            onClick={() => go.group(g.id)}
          />
        ))}
      </MenuList>
      {sections.length === 0 && groups.length === 0 && (
        <p className="px-3 py-4 text-sm text-fg-3">No sections here yet.</p>
      )}
      <div className="flex flex-wrap gap-2 px-3 pt-3">
        <Button onClick={() => void commands.newSection(notebook.id, groupId, 'list')}>
          <Plus /> New section
        </Button>
        <Button
          variant="ghost"
          onClick={() => void commands.newGroup(notebook.id, groupId, 'list')}
        >
          <FolderPlus /> New group
        </Button>
      </div>
    </section>
  );
}
