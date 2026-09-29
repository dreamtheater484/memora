import type { Section, SectionGroup } from '@memora/shared';
import { ChevronDown, Folder, FolderPlus, Inbox, Plus, SquarePlus } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '../components/ui';
import { cn } from '../lib/cn';
import { dropSpot, startDrag } from '../lib/dnd';
import type { NotesIndex } from '../notes/model';
import { useNotesActions } from '../notes/queries';
import { hueStyle } from '../theme/sections';
import { useCommands } from './commands';
import { useCurrent, useGo } from './location';
import { DropIndicator, InlineRename } from './parts';
import { SectionMenuItems } from './Sidebar';
import { useShell } from './store';

const tabClass = (selected: boolean) =>
  cn(
    'hue relative inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-base font-medium whitespace-nowrap',
    'transition-[background-color,color,box-shadow] duration-(--dur-fast)',
    selected
      ? 'bg-sec-soft font-semibold text-sec-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--sec)_40%,transparent)]'
      : 'text-fg-2 hover:bg-hover hover:text-fg',
  );

const Dot = () => <span aria-hidden className="size-2 shrink-0 rounded-full bg-sec" />;

/** A group's sections and subgroups, as menu items. */
function GroupMenuItems({
  index,
  group,
  currentId,
  onPick,
}: {
  index: NotesIndex;
  group: SectionGroup;
  currentId: string | null;
  onPick: (id: string) => void;
}): ReactNode {
  const sections = index.sectionsIn(group.notebookId, group.id);
  const groups = index.groupsIn(group.notebookId, group.id);
  return (
    <>
      {sections.map((s) => (
        <MenuItem
          key={s.id}
          icon={
            <span
              aria-hidden
              className="hue size-2.5 rounded-full bg-sec"
              style={hueStyle(s.color)}
            />
          }
          onSelect={() => onPick(s.id)}
          className={cn(s.id === currentId && 'font-semibold')}
          aria-current={s.id === currentId || undefined}
        >
          {s.name}
        </MenuItem>
      ))}
      {groups.map((g) => (
        <MenuSub key={g.id}>
          <MenuSubTrigger icon={<Folder />}>{g.name}</MenuSubTrigger>
          <MenuSubContent>
            <GroupMenuItems index={index} group={g} currentId={currentId} onPick={onPick} />
          </MenuSubContent>
        </MenuSub>
      ))}
      {sections.length === 0 && groups.length === 0 && (
        <MenuLabel className="normal-case">No sections yet</MenuLabel>
      )}
    </>
  );
}

function GroupTab({ group }: { group: SectionGroup }) {
  const { index, path, section } = useCurrent();
  const go = useGo();
  const commands = useCommands();
  const actions = useNotesActions();
  const inside = path?.groups.some((g) => g.id === group.id) ?? false;
  const color =
    inside && section ? section.color : (index.notebook.get(group.notebookId)?.color ?? 'slate');
  // The section this tab shows is renamed in place of its name.
  const renaming = useShell(
    (s) =>
      inside &&
      s.renaming?.where === 'tabs' &&
      s.renaming.kind === 'section' &&
      s.renaming.id === section?.id,
  );
  if (renaming && section) {
    return (
      <span className={cn(tabClass(true), 'pr-1.5')} style={hueStyle(color)}>
        <Folder className="size-3.5 shrink-0" />
        {group.name}
        <span className="font-normal">›</span>
        <InlineRename
          value={section.name}
          label="Section name"
          className="w-40"
          onDone={(name) => {
            useShell.getState().setRenaming(null);
            if (name) void actions.updateSection(section.id, { name });
          }}
        />
      </span>
    );
  }
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          data-tab-kind="group"
          data-tab-id={group.id}
          {...dropSpot('gtab', group.id, 'x')}
          onPointerDown={(e) =>
            startDrag(e, () => ({ kind: 'group', ids: [group.id], label: group.name }))
          }
          style={hueStyle(color)}
          aria-label={
            inside && section
              ? `${group.name}, section group, showing ${section.name}`
              : `${group.name}, section group`
          }
          className={tabClass(inside)}
        >
          <Folder className="size-3.5 shrink-0" />
          {group.name}
          {inside && section && path && (
            <>
              {path.groups.slice(path.groups.findIndex((g) => g.id === group.id) + 1).map((g) => (
                <span key={g.id} className="font-normal opacity-80">
                  › {g.name}
                </span>
              ))}
              <span className="font-normal">› {section.name}</span>
            </>
          )}
          <ChevronDown className="size-3.5 shrink-0 opacity-70" />
          <DropIndicator kind="gtab" id={group.id} axis="x" />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <GroupMenuItems
          index={index}
          group={group}
          currentId={section?.id ?? null}
          onPick={go.section}
        />
        <MenuSeparator />
        <MenuItem
          icon={<SquarePlus />}
          onSelect={() => void commands.newSection(group.notebookId, group.id)}
        >
          New section here
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Every section of the notebook, for when the tabs don't fit. */
function OverflowMenu({
  index,
  notebookId,
  currentId,
}: {
  index: NotesIndex;
  notebookId: string;
  currentId: string | null;
}) {
  const go = useGo();
  const sections = index.allSectionsOf(notebookId);
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="All sections" icon={<ChevronDown />} size="sm" round />
      </MenuTrigger>
      <MenuContent align="end" className="max-h-[60vh] overflow-y-auto">
        {sections.map((s) => {
          const path = index.pathOf(s.id);
          return (
            <MenuItem
              key={s.id}
              icon={
                <span
                  aria-hidden
                  className="hue size-2.5 rounded-full bg-sec"
                  style={hueStyle(s.color)}
                />
              }
              onSelect={() => go.section(s.id)}
              className={cn(s.id === currentId && 'font-semibold')}
            >
              {[...(path?.groups.map((g) => g.name) ?? []), s.name].join(' › ')}
            </MenuItem>
          );
        })}
      </MenuContent>
    </Menu>
  );
}

/**
 * OneNote-style coloured section tabs along the top: the notebook's own sections, then its
 * section groups as tabs that open a menu. Arrow keys move between the section tabs; drag a
 * tab to reorder it, or onto the navigation to move it elsewhere.
 */
export function SectionBar({ panelId }: { panelId: string }) {
  const current = useCurrent();
  const { index, notebook, section } = current;
  const go = useGo();
  const commands = useCommands();
  const actions = useNotesActions();
  const renaming = useShell((s) => (s.renaming?.where === 'tabs' ? s.renaming : null));
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const scroller = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [menuTarget, setMenuTarget] = useState<string | null>(null);

  const sections: Section[] = notebook
    ? index.sectionsIn(notebook.id, null)
    : section
      ? [section]
      : [];
  const groups = notebook ? index.groupsIn(notebook.id, null) : [];
  const value = section?.id ?? null;
  const focusable = sections.some((s) => s.id === value) ? value : sections[0]?.id;

  useEffect(() => {
    if (value) refs.current.get(value)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [sections.length, groups.length]);

  function onKeyDown(e: KeyboardEvent, i: number) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % sections.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + sections.length) % sections.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = sections.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = sections[next]?.id;
    if (!id) return;
    refs.current.get(id)?.focus();
    go.section(id);
  }

  const inbox = section?.isInbox;

  return (
    <div
      data-section-tabs
      className="flex shrink-0 items-center gap-1 px-2 pt-2 @tablet:px-3.5 @tablet:pt-3"
    >
      <ContextMenu onOpenChange={(open) => !open && setMenuTarget(null)}>
        <ContextMenuTrigger asChild>
          <div
            ref={scroller}
            onContextMenuCapture={(e) => {
              const tab = (e.target as HTMLElement).closest<HTMLElement>(
                '[data-tab-kind="section"]',
              );
              if (!tab) return e.preventDefault();
              setMenuTarget(tab.dataset.tabId!);
            }}
            className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div
              role="tablist"
              aria-label="Sections"
              aria-orientation="horizontal"
              className="flex items-center gap-1"
            >
              {sections.map((s, i) => {
                const selected = s.id === value;
                if (renaming?.kind === 'section' && renaming.id === s.id) {
                  return (
                    <span
                      key={s.id}
                      className={cn(tabClass(true), 'pr-1.5')}
                      style={hueStyle(s.color)}
                    >
                      <Dot />
                      <InlineRename
                        value={s.name}
                        label="Section name"
                        className="w-40"
                        onDone={(name) => {
                          useShell.getState().setRenaming(null);
                          if (name) void actions.updateSection(s.id, { name });
                        }}
                      />
                    </span>
                  );
                }
                return (
                  <button
                    key={s.id}
                    ref={(el) => {
                      if (el) refs.current.set(s.id, el);
                      else refs.current.delete(s.id);
                    }}
                    type="button"
                    role="tab"
                    id={`sectab-${s.id}`}
                    aria-selected={selected}
                    aria-controls={selected ? panelId : undefined}
                    tabIndex={s.id === focusable ? 0 : -1}
                    data-tab-kind="section"
                    data-tab-id={s.id}
                    {...dropSpot('tab', s.id, 'x')}
                    onClick={() => go.section(s.id)}
                    onDoubleClick={() =>
                      !s.isInbox &&
                      useShell.getState().setRenaming({ kind: 'section', id: s.id, where: 'tabs' })
                    }
                    onKeyDown={(e) => onKeyDown(e, i)}
                    onPointerDown={(e) =>
                      !s.isInbox &&
                      startDrag(e, () => ({ kind: 'section', ids: [s.id], label: s.name }))
                    }
                    style={hueStyle(s.color)}
                    className={tabClass(selected)}
                  >
                    {s.isInbox ? <Inbox className="size-3.5 shrink-0" /> : <Dot />}
                    {s.name}
                    <DropIndicator kind="tab" id={s.id} axis="x" />
                  </button>
                );
              })}
            </div>
            {groups.length > 0 && (
              <span aria-hidden className="mx-1.5 h-[18px] w-px shrink-0 bg-line-strong" />
            )}
            {groups.map((g) => (
              <GroupTab key={g.id} group={g} />
            ))}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {menuTarget && <SectionMenuItems sectionId={menuTarget} where="tabs" />}
        </ContextMenuContent>
      </ContextMenu>
      {!inbox && notebook && (
        <>
          <IconButton
            label="New section"
            icon={<Plus />}
            size="sm"
            round
            onClick={() => void commands.newSection(notebook.id)}
          />
          <span className="hidden @desktop:contents">
            <IconButton
              label="New section group"
              icon={<FolderPlus />}
              size="sm"
              round
              onClick={() => void commands.newGroup(notebook.id)}
            />
          </span>
          {overflowing && <OverflowMenu index={index} notebookId={notebook.id} currentId={value} />}
        </>
      )}
    </div>
  );
}
