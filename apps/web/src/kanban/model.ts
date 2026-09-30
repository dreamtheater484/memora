import {
  PRIORITY_LANES,
  cardKey,
  matchesFilter,
  sortCards,
  type BoardData,
  type Card,
  type CardFilter,
  type Column,
  type Priority,
} from '@memora/shared';
import type { MoveTarget } from './api';

/*
 * How a board is laid out: rows (swimlanes, or one row), columns, and the cards in each cell,
 * filtered and sorted. Lanes can be the board's own, or made from priorities or labels; a
 * card dropped into such a lane takes that priority or label.
 */

export interface Lane {
  /** The lane's key: a swimlane id, a priority, a label id, or `none`. */
  key: string;
  name: string;
  color: string | null;
  /** Only the board's own lanes can be renamed, collapsed or dragged. */
  swimlaneId: string | null;
  collapsed: boolean;
}

export interface Layout {
  lanes: Lane[];
  columns: Column[];
  /** Cards by cell (`<lane key>|<column id>`), in the order shown. */
  cells: Map<string, Card[]>;
  /** Cards in each column, after filters (for counts). */
  counts: Map<string, number>;
  /** Cards in each column, before filters (for WIP limits). */
  totals: Map<string, number>;
  /** How many cards the filters hide. */
  hidden: number;
}

export const cellKey = (lane: string, column: string) => `${lane}|${column}`;

export const PRIORITY_NAMES: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
};

/** The lane a card is in. */
export function laneOf(board: BoardData, card: Card): string {
  switch (board.board.settings.lanes) {
    case 'custom':
      return card.swimlaneId ?? 'none';
    case 'priority':
      return card.priority;
    case 'label': {
      const first = board.labels.find((l) => card.labelIds.includes(l.id));
      return first?.id ?? 'none';
    }
    default:
      return 'none';
  }
}

export function lanesOf(board: BoardData): Lane[] {
  switch (board.board.settings.lanes) {
    case 'custom':
      return [
        ...board.swimlanes.map((l) => ({
          key: l.id,
          name: l.name,
          color: l.color,
          swimlaneId: l.id,
          collapsed: l.collapsed,
        })),
        { key: 'none', name: 'No lane', color: null, swimlaneId: null, collapsed: false },
      ];
    case 'priority':
      return PRIORITY_LANES.map((p) => ({
        key: p,
        name: PRIORITY_NAMES[p],
        color: null,
        swimlaneId: null,
        collapsed: false,
      }));
    case 'label':
      return [
        ...board.labels.map((l) => ({
          key: l.id,
          name: l.name,
          color: l.color,
          swimlaneId: null,
          collapsed: false,
        })),
        { key: 'none', name: 'No label', color: null, swimlaneId: null, collapsed: false },
      ];
    default:
      return [{ key: 'none', name: '', color: null, swimlaneId: null, collapsed: false }];
  }
}

export function layout(board: BoardData, filter: CardFilter, now: number): Layout {
  const lanes = lanesOf(board);
  const columns = board.columns.filter((c) => !c.archivedAt);
  const cells = new Map<string, Card[]>();
  const counts = new Map<string, number>();
  const totals = new Map<string, number>();
  let hidden = 0;
  for (const column of columns) {
    const cards = board.cards.filter((c) => c.columnId === column.id && !c.archivedAt);
    totals.set(column.id, cards.length);
    const shown = sortCards(
      cards.filter((c) => matchesFilter(c, cardKey(board.project, c), filter, now)),
      column.sort,
    );
    hidden += cards.length - shown.length;
    counts.set(column.id, shown.length);
    for (const lane of lanes) cells.set(cellKey(lane.key, column.id), []);
    for (const card of shown) {
      const key = cellKey(laneOf(board, card), column.id);
      (cells.get(key) ?? cells.get(cellKey('none', column.id)))?.push(card);
    }
  }
  return { lanes, columns, cells, counts, totals, hidden };
}

/**
 * The move that puts `card` at `index` in a cell (counting the cell's cards without it):
 * the column, the lane, the card it goes before, and a priority or label for automatic lanes.
 */
export function planMove(
  board: BoardData,
  shown: Layout,
  card: Card,
  laneKey: string,
  columnId: string,
  index: number,
): MoveTarget {
  const cell = (shown.cells.get(cellKey(laneKey, columnId)) ?? []).filter((c) => c.id !== card.id);
  const column = board.columns.find((c) => c.id === columnId);
  // Sorted columns keep their order: the card just joins them.
  const manual = !column || column.sort === 'manual';
  let beforeId: string | null = manual ? (cell[index]?.id ?? null) : null;
  if (manual && !beforeId && cell.length) {
    // Last in the lane: before the first card after it in the column, whatever its lane.
    const all = board.cards
      .filter((c) => c.columnId === columnId && c.id !== card.id && !c.archivedAt)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    const last = cell[cell.length - 1]!;
    beforeId = all[all.findIndex((c) => c.id === last.id) + 1]?.id ?? null;
  }
  const mode = board.board.settings.lanes;
  const target: MoveTarget = {
    columnId,
    swimlaneId: mode === 'custom' ? (laneKey === 'none' ? null : laneKey) : card.swimlaneId,
    beforeId,
  };
  if (mode === 'priority' && laneKey !== card.priority) {
    target.patch = { priority: laneKey as Priority };
  }
  if (mode === 'label') {
    const current = laneOf(board, card);
    if (current !== laneKey) {
      const rest = card.labelIds.filter((id) => id !== current);
      target.patch = { labelIds: laneKey === 'none' ? rest : [laneKey, ...rest] };
    }
  }
  return target;
}

/** Where a card is shown: its lane, column and index in that cell. */
export function placeOf(board: BoardData, shown: Layout, card: Card) {
  const lane = laneOf(board, card);
  const cell = shown.cells.get(cellKey(lane, card.columnId)) ?? [];
  return { lane, columnId: card.columnId, index: cell.findIndex((c) => c.id === card.id) };
}
