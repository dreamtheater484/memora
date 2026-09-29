import { ChevronRight } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';

export interface TreeNode {
  id: string;
  /** Plain text for type-ahead and the default row. */
  label: string;
  children?: readonly TreeNode[];
  /**
   * False for rows that only group others (a notebook, a section group):
   * clicking or Enter toggles them instead of selecting.
   */
  selectable?: boolean;
  /** Unavailable; still reachable with the keyboard. */
  disabled?: boolean;
}

export interface TreeRowState {
  level: number;
  expanded: boolean;
  selected: boolean;
  hasChildren: boolean;
}

/** Modifier keys held when a row was chosen, for multi-selection. */
export interface SelectModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface PageTreeProps<N extends TreeNode> {
  nodes: readonly N[];
  label: string;
  selectedId?: string | null;
  /** Several selected rows (overrides `selectedId` for the highlight). */
  isSelected?: (node: N) => boolean;
  multiselectable?: boolean;
  onSelect?: (node: N, modifiers: SelectModifiers) => void;
  /** Expanded node ids (controlled). */
  expanded?: ReadonlySet<string>;
  defaultExpanded?: Iterable<string>;
  onExpandedChange?: (expanded: Set<string>) => void;
  /** Row content; defaults to the label. */
  renderRow?: (node: N, state: TreeRowState) => ReactNode;
  /** Classes for each row, on top of the base row style. */
  rowClassName?: (node: N, state: TreeRowState) => string | undefined;
  /** Extra attributes for each row: data attributes, pointer handlers. */
  rowProps?: (node: N, state: TreeRowState) => HTMLAttributes<HTMLDivElement>;
  /** Left padding per level, in rem. */
  indent?: number;
  /** Rows with several lines: align to the top and add vertical padding. */
  multiline?: boolean;
  /**
   * For long lists: build rows only as they scroll into view or the keyboard reaches them.
   * The rows not built yet are a blank gap of this estimated height per row, in rem.
   */
  lazyRowHeight?: number;
  className?: string;
}

/** Rows a lazy tree builds at first, and beyond what is needed when it builds more. */
const LAZY_CHUNK = 60;

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
  isSelected,
  multiselectable,
  onSelect,
  expanded,
  defaultExpanded,
  onExpandedChange,
  renderRow,
  rowClassName,
  rowProps,
  indent = 1.25,
  multiline,
  lazyRowHeight,
  className,
}: PageTreeProps<N>) {
  const [ownExpanded, setOwnExpanded] = useState(() => new Set(defaultExpanded));
  const open = expanded ?? ownExpanded;
  const visible = useMemo(() => flatten(nodes, open), [nodes, open]);
  const indexOf = useMemo(() => new Map(visible.map((v, i) => [v.node.id, i])), [visible]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  // The row to focus as it mounts: a focused row that remounts after moving under another
  // parent, or a row of a lazy tree that the keyboard reached before it was built.
  const refocus = useRef<string | null>(null);
  // Runs after the rows' refs: forget a row that was removed rather than moved.
  useLayoutEffect(() => {
    refocus.current = null;
  });
  const typeahead = useRef({ text: '', at: 0 });

  // Rows built so far, in the visible order: all of them, or the first `limit` of a lazy tree.
  // Without IntersectionObserver (tests), a lazy tree builds everything.
  const [limit, setLimit] = useState(() =>
    typeof IntersectionObserver === 'undefined' ? Infinity : LAZY_CHUNK,
  );
  const shown = lazyRowHeight ? Math.min(limit, visible.length) : visible.length;
  const rest = visible.length - shown;
  const gap = useRef<HTMLDivElement>(null);
  const built = (id: string | null | undefined) => !!id && (indexOf.get(id) ?? shown) < shown;

  // When the gap comes into view, even deep into it after a scrollbar drag, build the rows down
  // to the bottom of the view and a chunk more. Observing again after each build checks the gap
  // anew, since the rows can be shorter than the estimate.
  useEffect(() => {
    const el = gap.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      const perRow = entry.boundingClientRect.height / rest;
      const needed = (entry.intersectionRect.bottom - entry.boundingClientRect.top) / perRow;
      setLimit((l) => Math.max(l, shown + Math.ceil(needed) + LAZY_CHUNK));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown, rest]);

  // A row not built yet can't be tabbed to; the first row stands in until it is.
  const tabStop = [focusedId, selectedId].find(built) ?? visible[0]?.node.id;

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
    const row = refs.current.get(id);
    if (row) return row.focus();
    // Not built yet (a lazy tree): build down to it, and focus it as it mounts.
    const index = indexOf.get(id);
    if (index === undefined) return;
    refocus.current = id;
    setLimit((l) => Math.max(l, index + 1 + LAZY_CHUNK));
  }

  /** Focuses the visible row at `index`, if there is one. */
  function focusAt(index: number) {
    focus(visible[index]?.node.id);
  }

  function select(node: N, modifiers: SelectModifiers) {
    if (node.disabled) return;
    if (node.selectable === false) {
      if (node.children?.length) setOpen(node.id, !open.has(node.id));
    } else onSelect?.(node, modifiers);
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    const cur = visible[index];
    // Keys with Ctrl, Alt or ⌘ are the app's shortcuts, not the tree's.
    if (!cur || e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
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
        select(cur.node, e);
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
    if (!/^[\p{L}\p{N}]$/u.test(key)) return false;
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
      const index = indexOf.get(node.id) ?? 0;
      if (index >= shown) return null;
      const hasChildren = !!node.children?.length;
      const isOpen = hasChildren && open.has(node.id);
      const state: TreeRowState = {
        level,
        expanded: isOpen,
        selected: isSelected ? isSelected(node) : node.id === selectedId,
        hasChildren,
      };
      const extra = rowProps?.(node, state);
      return (
        <li
          key={node.id}
          ref={(el) => {
            if (el) {
              refs.current.set(node.id, el);
              if (refocus.current === node.id) {
                refocus.current = null;
                if (el !== document.activeElement) el.focus();
              }
            } else {
              // A focused row going away; unless focus is already headed to a row being built.
              if (!refocus.current && refs.current.get(node.id) === document.activeElement)
                refocus.current = node.id;
              refs.current.delete(node.id);
            }
          }}
          role="treeitem"
          aria-level={level}
          aria-setsize={list.length}
          aria-posinset={i + 1}
          aria-expanded={hasChildren ? isOpen : undefined}
          aria-selected={node.selectable === false ? undefined : state.selected}
          aria-disabled={node.disabled || undefined}
          tabIndex={node.id === tabStop ? 0 : -1}
          onKeyDown={(e) => onKeyDown(e, index)}
          onFocus={(e) => {
            if (e.target === e.currentTarget) setFocusedId(node.id);
          }}
          className="outline-none [&:focus-visible>div]:outline-2 [&:focus-visible>div]:-outline-offset-2 [&:focus-visible>div]:outline-focus"
        >
          <div
            {...extra}
            onClick={(e: MouseEvent<HTMLDivElement>) => {
              focus(node.id);
              select(node, e);
            }}
            style={{ paddingLeft: `${0.5 + (level - 1) * indent}rem` }}
            className={cn(
              'relative flex min-h-[1.875rem] cursor-default gap-2 rounded-sm pr-2 select-none',
              multiline ? 'items-start py-2' : 'items-center',
              state.selected
                ? 'bg-active font-semibold text-fg shadow-card'
                : 'text-fg-2 hover:bg-hover hover:text-fg',
              rowClassName?.(node, state),
              extra?.className,
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
          {/* The first child comes right after its parent in the visible order. */}
          {isOpen && index + 1 < shown && (
            <ul role="group" className="flex flex-col gap-px pt-px">
              {renderLevel(node.children as readonly N[], level + 1)}
            </ul>
          )}
        </li>
      );
    });
  }

  return (
    <>
      <ul
        role="tree"
        aria-label={label}
        aria-multiselectable={multiselectable || undefined}
        className={cn('flex flex-col gap-px', className)}
      >
        {renderLevel(nodes, 1)}
      </ul>
      {rest > 0 && (
        // No scroll anchoring on the gap: rows built above a view that is inside it fill that view
        // instead of pushing it further down.
        <div
          ref={gap}
          aria-hidden
          className="shrink-0 [overflow-anchor:none]"
          style={{ height: `${rest * lazyRowHeight!}rem` }}
        />
      )}
    </>
  );
}
