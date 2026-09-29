import { ChevronRight } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TreeNode {
  id: string;
  /** Plain text for type-ahead and the default row. */
  label: string;
  children?: readonly TreeNode[];
  /** Not selectable (for example a section-group heading); still navigable. */
  disabled?: boolean;
}

export interface TreeRowState {
  level: number;
  expanded: boolean;
  selected: boolean;
  hasChildren: boolean;
}

export interface PageTreeProps<N extends TreeNode> {
  nodes: readonly N[];
  label: string;
  selectedId?: string | null;
  onSelect?: (node: N) => void;
  /** Expanded node ids (controlled). */
  expanded?: ReadonlySet<string>;
  defaultExpanded?: Iterable<string>;
  onExpandedChange?: (expanded: Set<string>) => void;
  /** Row content; defaults to the label. */
  renderRow?: (node: N, state: TreeRowState) => ReactNode;
  /** Classes for each row, on top of the base row style. */
  rowClassName?: (node: N, state: TreeRowState) => string | undefined;
  /** Left padding per level, in rem. */
  indent?: number;
  className?: string;
}

interface Visible<N> {
  node: N;
  level: number;
  parentId: string | null;
}

function flatten<N extends TreeNode>(nodes: readonly N[], open: ReadonlySet<string>): Visible<N>[] {
  const out: Visible<N>[] = [];
  const walk = (list: readonly N[], level: number, parentId: string | null) => {
    for (const node of list) {
      out.push({ node, level, parentId });
      if (node.children?.length && open.has(node.id))
        walk(node.children as readonly N[], level + 1, node.id);
    }
  };
  walk(nodes, 1, null);
  return out;
}

/**
 * Accessible tree for notebooks, section groups and pages with subpages.
 * Keys: Up/Down move, Right expands or enters, Left collapses or goes to the
 * parent, Home/End jump, Enter/Space select, letters jump by name.
 */
export function PageTree<N extends TreeNode>({
  nodes,
  label,
  selectedId,
  onSelect,
  expanded,
  defaultExpanded,
  onExpandedChange,
  renderRow,
  rowClassName,
  indent = 1.25,
  className,
}: PageTreeProps<N>) {
  const [ownExpanded, setOwnExpanded] = useState(() => new Set(defaultExpanded));
  const open = expanded ?? ownExpanded;
  const visible = useMemo(() => flatten(nodes, open), [nodes, open]);
  const indexOf = useMemo(() => new Map(visible.map((v, i) => [v.node.id, i])), [visible]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const typeahead = useRef({ text: '', at: 0 });

  const tabStop =
    visible.find((v) => v.node.id === focusedId)?.node.id ??
    visible.find((v) => v.node.id === selectedId)?.node.id ??
    visible[0]?.node.id;

  function setOpen(id: string, value: boolean) {
    const next = new Set(open);
    if (value) next.add(id);
    else next.delete(id);
    if (!expanded) setOwnExpanded(next);
    onExpandedChange?.(next);
  }

  function focus(id: string | undefined) {
    if (!id) return;
    setFocusedId(id);
    refs.current.get(id)?.focus();
  }

  /** Focuses the visible row at `index`, if there is one. */
  function focusAt(index: number) {
    focus(visible[index]?.node.id);
  }

  function select(node: N) {
    if (!node.disabled) onSelect?.(node);
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    const cur = visible[index];
    if (!cur) return;
    const hasChildren = !!cur.node.children?.length;
    const isOpen = open.has(cur.node.id);
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index - 1);
        break;
      case 'ArrowRight':
        if (hasChildren && !isOpen) setOpen(cur.node.id, true);
        else if (hasChildren) focusAt(index + 1);
        break;
      case 'ArrowLeft':
        if (hasChildren && isOpen) setOpen(cur.node.id, false);
        else focus(cur.parentId ?? undefined);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(visible.length - 1);
        break;
      case 'Enter':
      case ' ':
        select(cur.node);
        break;
      default:
        handled = typeAhead(e.key, index, e.timeStamp);
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function typeAhead(key: string, index: number, now: number): boolean {
    if (key.length !== 1 || key === ' ') return false;
    const t = typeahead.current;
    t.text = now - t.at > 600 ? key.toLowerCase() : t.text + key.toLowerCase();
    t.at = now;
    // Search forward from the next row (or the current one while typing a word).
    const start = t.text.length > 1 ? index : index + 1;
    for (let i = 0; i < visible.length; i++) {
      const v = visible[(start + i) % visible.length];
      if (v?.node.label.toLowerCase().startsWith(t.text)) {
        focus(v.node.id);
        break;
      }
    }
    return true;
  }

  function renderLevel(list: readonly N[], level: number): ReactNode {
    return list.map((node, i) => {
      const hasChildren = !!node.children?.length;
      const isOpen = hasChildren && open.has(node.id);
      const state: TreeRowState = {
        level,
        expanded: isOpen,
        selected: node.id === selectedId,
        hasChildren,
      };
      const index = indexOf.get(node.id) ?? 0;
      return (
        <li
          key={node.id}
          ref={(el) => {
            if (el) refs.current.set(node.id, el);
            else refs.current.delete(node.id);
          }}
          role="treeitem"
          aria-level={level}
          aria-setsize={list.length}
          aria-posinset={i + 1}
          aria-expanded={hasChildren ? isOpen : undefined}
          aria-selected={node.disabled ? undefined : state.selected}
          aria-disabled={node.disabled || undefined}
          tabIndex={node.id === tabStop ? 0 : -1}
          onKeyDown={(e) => onKeyDown(e, index)}
          onFocus={(e) => {
            if (e.target === e.currentTarget) setFocusedId(node.id);
          }}
          className="outline-none [&:focus-visible>div]:outline-2 [&:focus-visible>div]:-outline-offset-2 [&:focus-visible>div]:outline-focus"
        >
          <div
            onClick={() => {
              focus(node.id);
              if (node.disabled && hasChildren) setOpen(node.id, !isOpen);
              else select(node);
            }}
            style={{ paddingLeft: `${0.5 + (level - 1) * indent}rem` }}
            className={cn(
              'flex min-h-[1.875rem] cursor-default items-center gap-2 rounded-sm pr-2 select-none',
              state.selected
                ? 'bg-active font-semibold text-fg shadow-card'
                : 'text-fg-2 hover:bg-hover hover:text-fg',
              rowClassName?.(node, state),
            )}
          >
            {hasChildren ? (
              <span
                aria-hidden
                onClick={(e) => {
                  e.stopPropagation();
                  focus(node.id);
                  setOpen(node.id, !isOpen);
                }}
                className="-ml-1 grid size-5 shrink-0 place-items-center rounded-xs text-fg-3 hover:bg-hover hover:text-fg"
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 transition-transform duration-(--dur-fast)',
                    isOpen && 'rotate-90',
                  )}
                />
              </span>
            ) : null}
            {renderRow ? renderRow(node, state) : <span className="truncate">{node.label}</span>}
          </div>
          {isOpen && (
            <ul role="group" className="flex flex-col gap-px pt-px">
              {renderLevel(node.children as readonly N[], level + 1)}
            </ul>
          )}
        </li>
      );
    });
  }

  return (
    <ul role="tree" aria-label={label} className={cn('flex flex-col gap-px', className)}>
      {renderLevel(nodes, 1)}
    </ul>
  );
}
