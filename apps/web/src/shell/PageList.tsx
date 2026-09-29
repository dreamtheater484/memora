import type { PageMeta } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Copy,
  Ellipsis,
  FileCode2,
  FilePlus,
  FileText,
  FolderInput,
  IndentDecrease,
  IndentIncrease,
  ListFilter,
  PanelRight,
  Plus,
  Trash2,
} from 'lucide-react';
import { useMemo, useState, type HTMLAttributes } from 'react';
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  PageTree,
  type SelectModifiers,
  type TreeNode,
} from '../components/ui';
import { dropSpot, startDrag } from '../lib/dnd';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useNow } from '../lib/useNow';
import { formatDateTime, formatRelative } from '../lib/time';
import { indentPlace, outdentPlace, type PageRow } from '../notes/model';
import { saveUiState, useNotesActions, useUiState } from '../notes/queries';
import { hueStyle } from '../theme/sections';
import { useCommands } from './commands';
import { useCurrent, useGo } from './location';
import { DropIndicator, InlineRename } from './parts';
import { shortcutKeys } from './shortcuts';
import { useShell } from './store';

interface PageNode extends TreeNode {
  page: PageMeta;
  children?: PageNode[];
}

/** Rows as a tree, keeping only pages that match the filter (and the pages above them). */
function toNodes(rows: readonly PageRow[], filter: string): PageNode[] {
  const q = filter.trim().toLowerCase();
  const matches = (p: PageMeta) =>
    !q || p.title.toLowerCase().includes(q) || p.snippet.toLowerCase().includes(q);
  const top: PageNode[] = [];
  const stack: PageNode[] = [];
  for (const { page, depth } of rows) {
    const node: PageNode = { id: page.id, label: page.title || 'Untitled page', page };
    stack.length = depth - 1;
    const parent = stack[depth - 2];
    if (parent) (parent.children ??= []).push(node);
    else top.push(node);
    stack[depth - 1] = node;
  }
  if (!q) return top;
  const prune = (nodes: PageNode[]): PageNode[] =>
    nodes.flatMap((n) => {
      const children = prune(n.children ?? []);
      if (!matches(n.page) && !children.length) return [];
      return [{ ...n, children: children.length ? children : undefined }];
    });
  return prune(top);
}

function allIds(nodes: readonly PageNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...allIds(n.children ?? [])]);
}

function PageRowView({ page, now }: { page: PageMeta; now: number }) {
  // Rows out of sight skip style and layout until they scroll in, which keeps a section with
  // a thousand pages quick to open. The drop line stays outside, so it isn't clipped.
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col [contain-intrinsic-block-size:auto_3.5rem] [content-visibility:auto]">
        <span className="flex items-center gap-1.5 text-base font-semibold text-fg">
          {page.type === 'markdown' ? (
            <FileCode2 className="size-3.5 shrink-0 text-fg-3" />
          ) : (
            <FileText className="size-3.5 shrink-0 text-fg-3" />
          )}
          <span className={page.title ? 'truncate' : 'truncate text-fg-3 italic'}>
            {page.title || 'Untitled page'}
          </span>
        </span>
        {page.snippet && (
          <span className="mt-0.5 truncate text-sm font-normal text-fg-3">{page.snippet}</span>
        )}
        <span
          className="mt-0.5 text-2xs font-normal text-fg-3"
          title={formatDateTime(page.updatedAt)}
        >
          {formatRelative(page.updatedAt, now)}
        </span>
      </span>
      <DropIndicator kind="page" id={page.id} />
    </>
  );
}

function PageMenu({ pageId }: { pageId: string }) {
  const { index } = useCurrent();
  const commands = useCommands();
  const go = useGo();
  const ultra = useMediaQuery('(min-width: 200rem)');
  const selection = useShell((s) => s.selection);
  const page = index.page.get(pageId);
  if (!page) return null;
  // Right-clicking a selected page acts on the whole selection.
  const ids = selection.includes(pageId) ? selection : [pageId];
  const many = ids.length > 1;
  return (
    <>
      {!many && (
        <>
          <ContextMenuItem
            icon={<FilePlus />}
            onSelect={() => {
              go.page(pageId);
              void commands.newPage({ subpage: true, sectionId: page.sectionId });
            }}
          >
            New subpage
          </ContextMenuItem>
          {ultra && (
            <ContextMenuItem
              icon={<PanelRight />}
              onSelect={() => useShell.getState().setSecondPane(true, pageId)}
            >
              Open in the second pane
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem
        icon={<FolderInput />}
        shortcut={shortcutKeys('move')}
        onSelect={() => commands.movePages(ids)}
      >
        {many ? `Move or copy ${ids.length} pages…` : 'Move or copy…'}
      </ContextMenuItem>
      {!many && (
        <ContextMenuItem icon={<Copy />} onSelect={() => commands.duplicatePage(pageId)}>
          Duplicate
        </ContextMenuItem>
      )}
      <ContextMenuItem
        icon={<IndentIncrease />}
        shortcut="Tab"
        disabled={!indentPlace(index, ids[0]!)}
        onSelect={() => commands.movePagesTo(ids, indentPlace(index, ids[0]!)!)}
      >
        Make subpage
      </ContextMenuItem>
      <ContextMenuItem
        icon={<IndentDecrease />}
        shortcut="Shift Tab"
        disabled={!outdentPlace(index, ids[0]!)}
        onSelect={() => commands.movePagesTo(ids, outdentPlace(index, ids[0]!)!)}
      >
        Move out a level
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<Trash2 />}
        danger
        shortcut="Delete"
        onSelect={() => commands.deletePages(ids)}
      >
        {many ? `Delete ${ids.length} pages` : 'Delete page'}
      </ContextMenuItem>
    </>
  );
}

/** Pages of the current section, subpages nested under their parent. */
export function PageList({ onOpen }: { onOpen?: () => void } = {}) {
  const { index, section, page } = useCurrent();
  const commands = useCommands();
  const go = useGo();
  const queryClient = useQueryClient();
  const ui = useUiState();
  const { selection, anchor, select } = useShell();
  const [filter, setFilter] = useState('');
  const [menuTarget, setMenuTarget] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const actions = useNotesActions();
  const renaming = useShell(
    (s) =>
      s.renaming?.where === 'list' &&
      s.renaming.kind === 'section' &&
      s.renaming.id === section?.id,
  );

  const rows = useMemo(() => (section ? index.pagesOf(section.id) : []), [index, section]);
  const nodes = useMemo(() => toNodes(rows, filter), [rows, filter]);
  const expanded = useMemo(() => {
    const all = new Set(allIds(nodes));
    for (const id of collapsed) if (!filter) all.delete(id);
    return all;
  }, [nodes, collapsed, filter]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const now = useNow();

  if (!section) return null;
  const side = ui.pageListSide ?? 'right';

  function onSelect(node: PageNode, mods: SelectModifiers) {
    const visible = allIds(nodes);
    if (mods.shiftKey) {
      const from = visible.indexOf(anchor ?? page?.id ?? node.id);
      const to = visible.indexOf(node.id);
      const [a, b] = from < to ? [from, to] : [to, from];
      select(visible.slice(Math.max(a, 0), b + 1));
      return;
    }
    if (mods.ctrlKey || mods.metaKey) {
      const base = selection.length ? selection : page ? [page.id] : [];
      select(
        base.includes(node.id) ? base.filter((id) => id !== node.id) : [...base, node.id],
        node.id,
      );
      return;
    }
    select([], node.id);
    go.page(node.id);
    onOpen?.();
  }

  return (
    <aside
      aria-label="Pages"
      className="hue flex h-full min-h-0 flex-col"
      style={hueStyle(section.color)}
    >
      <div className="flex shrink-0 items-center gap-1.5 pt-3.5 pr-3 pb-2.5 pl-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-md font-semibold">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-sec" />
            {renaming ? (
              <InlineRename
                value={section.name}
                label="Section name"
                onDone={(name) => {
                  useShell.getState().setRenaming(null);
                  if (name) void actions.updateSection(section.id, { name });
                }}
              />
            ) : (
              <span className="truncate">{section.name}</span>
            )}
          </h2>
          <span className="text-xs text-fg-3" aria-live="polite">
            {selection.length > 1
              ? `${selection.length} selected`
              : `${rows.length} ${rows.length === 1 ? 'page' : 'pages'}`}
          </span>
        </div>
        <span className="flex-1" />
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Page list options" icon={<Ellipsis />} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem
              icon={side === 'right' ? <ArrowLeftToLine /> : <ArrowRightToLine />}
              onSelect={() =>
                saveUiState(queryClient, { pageListSide: side === 'right' ? 'left' : 'right' })
              }
            >
              {side === 'right'
                ? 'Show the page list on the left'
                : 'Show the page list on the right'}
            </MenuItem>
          </MenuContent>
        </Menu>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void commands.newPage({ sectionId: section.id })}
        >
          <Plus /> Page
        </Button>
      </div>
      <Input
        pill
        icon={<ListFilter />}
        placeholder="Filter pages"
        aria-label="Filter pages"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        wrapperClassName="mx-3 mb-2 shrink-0"
      />
      <ContextMenu onOpenChange={(open) => !open && setMenuTarget(null)}>
        <ContextMenuTrigger asChild>
          <div
            data-page-list
            data-drop-scroll
            onContextMenuCapture={(e) => {
              const row = (e.target as HTMLElement).closest<HTMLElement>('[data-page-id]');
              if (!row) return e.preventDefault();
              setMenuTarget(row.dataset.pageId!);
            }}
            onKeyDown={(e) => {
              // Leave the list with Escape, since Tab indents pages here.
              if (e.key === 'Escape' && !e.defaultPrevented) {
                if (selection.length) select([], null);
                else document.getElementById('page-panel')?.focus();
              }
            }}
            className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pb-3.5"
          >
            {nodes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-fg-3">
                {filter ? 'No pages match this filter' : 'No pages yet'}
              </p>
            ) : (
              <PageTree
                key={section.id}
                label={`Pages in ${section.name}`}
                nodes={nodes}
                selectedId={page?.id ?? null}
                isSelected={(n) => (selection.length ? selected.has(n.id) : n.id === page?.id)}
                multiselectable
                expanded={expanded}
                onExpandedChange={(next) => {
                  setCollapsed(new Set(allIds(nodes).filter((id) => !next.has(id))));
                }}
                onSelect={onSelect}
                indent={1.125}
                multiline
                renderRow={({ page: p }) => <PageRowView page={p} now={now} />}
                rowProps={(node) =>
                  ({
                    'data-page-id': node.id,
                    ...dropSpot('page', node.id),
                    onPointerDown: (e) =>
                      startDrag(e, () => {
                        const ids = selected.has(node.id) ? selection : [node.id];
                        const label =
                          ids.length > 1
                            ? `${ids.length} pages`
                            : node.page.title || 'Untitled page';
                        return { kind: 'page', ids, label };
                      }),
                  }) as HTMLAttributes<HTMLDivElement>
                }
              />
            )}
            {/* Dropping here puts pages at the end of the section. */}
            <div
              {...dropSpot('pages-end', section.id)}
              className="relative min-h-10 flex-1 rounded-sm"
            >
              <DropIndicator kind="pages-end" id={section.id} />
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>{menuTarget && <PageMenu pageId={menuTarget} />}</ContextMenuContent>
      </ContextMenu>
    </aside>
  );
}
