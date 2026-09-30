import type { BoardData, Card, Column } from '@memora/shared';
import { describe, expect, it } from 'vitest';
import { cellKey, layout, planMove, placeOf } from './model';

const NOW = Date.UTC(2026, 0, 15);

function column(id: string, extra: Partial<Column> = {}): Column {
  return {
    id,
    boardId: 'b',
    name: id.toUpperCase(),
    color: null,
    wipLimit: null,
    wipStrict: false,
    isDone: false,
    collapsed: false,
    sort: 'manual',
    sortKey: id,
    archivedAt: null,
    ...extra,
  };
}

function card(id: string, columnId: string, sortKey: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    boardId: 'b',
    columnId,
    swimlaneId: null,
    number: Number(id.replace(/\D/g, '')) || 1,
    title: `Card ${id}`,
    priority: 'none',
    startDate: null,
    dueDate: null,
    coverColor: null,
    labelIds: [],
    checklist: { done: 0, total: 0 },
    comments: 0,
    attachments: 0,
    pages: 0,
    sortKey,
    completedAt: null,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

function board(cards: Card[], extra: Partial<BoardData> = {}): BoardData {
  return {
    board: {
      id: 'b',
      projectId: 'p',
      name: 'Board',
      description: '',
      sortKey: 'a',
      settings: { lanes: 'none' },
      archivedAt: null,
      createdAt: 0,
      updatedAt: 0,
    },
    project: {
      id: 'p',
      name: 'Web',
      key: 'WEB',
      color: 'blue',
      icon: 'code',
      sortKey: 'a',
      archivedAt: null,
      createdAt: 0,
      updatedAt: 0,
    },
    labels: [],
    columns: [column('todo'), column('doing'), column('done', { isDone: true })],
    swimlanes: [],
    cards,
    ...extra,
  };
}

const ids = (cards: Card[] | undefined) => (cards ?? []).map((c) => c.id);

describe('layout', () => {
  it('puts cards in cells by column, in order, and counts what filters hide', () => {
    const data = board([
      card('c2', 'todo', 'b'),
      card('c1', 'todo', 'a'),
      card('c3', 'doing', 'a', { title: 'Pricing page' }),
      card('c4', 'done', 'a', { archivedAt: 1 }),
    ]);
    const all = layout(data, {}, NOW);
    expect(ids(all.cells.get(cellKey('none', 'todo')))).toEqual(['c1', 'c2']);
    expect(all.totals.get('todo')).toBe(2);
    expect(all.totals.get('done')).toBe(0);
    const filtered = layout(data, { text: 'pricing' }, NOW);
    expect(ids(filtered.cells.get(cellKey('none', 'doing')))).toEqual(['c3']);
    expect(filtered.counts.get('todo')).toBe(0);
    expect(filtered.totals.get('todo')).toBe(2);
    expect(filtered.hidden).toBe(2);
  });

  it('makes lanes from priorities and labels', () => {
    const data = board(
      [
        card('c1', 'todo', 'a', { priority: 'high', labelIds: ['l2'] }),
        card('c2', 'todo', 'b', { labelIds: ['l2', 'l1'] }),
      ],
      {
        labels: [
          { id: 'l1', projectId: 'p', name: 'Bug', color: 'coral' },
          { id: 'l2', projectId: 'p', name: 'Copy', color: 'green' },
        ],
      },
    );
    data.board.settings.lanes = 'priority';
    let shown = layout(data, {}, NOW);
    expect(shown.lanes.map((l) => l.key)).toEqual(['urgent', 'high', 'medium', 'low', 'none']);
    expect(ids(shown.cells.get(cellKey('high', 'todo')))).toEqual(['c1']);
    data.board.settings.lanes = 'label';
    shown = layout(data, {}, NOW);
    // A card goes in the lane of the project's first label it has.
    expect(ids(shown.cells.get(cellKey('l1', 'todo')))).toEqual(['c2']);
    expect(ids(shown.cells.get(cellKey('l2', 'todo')))).toEqual(['c1']);
  });
});

describe('planMove', () => {
  it('goes before the card at the index, or last', () => {
    const data = board([
      card('c1', 'todo', 'a'),
      card('c2', 'todo', 'b'),
      card('c3', 'doing', 'a'),
    ]);
    const shown = layout(data, {}, NOW);
    const c3 = data.cards[2]!;
    expect(planMove(data, shown, c3, 'none', 'todo', 0)).toMatchObject({ beforeId: 'c1' });
    expect(planMove(data, shown, c3, 'none', 'todo', 1)).toMatchObject({ beforeId: 'c2' });
    expect(planMove(data, shown, c3, 'none', 'todo', 2)).toMatchObject({
      columnId: 'todo',
      beforeId: null,
    });
    // Moving down in its own column counts the cell without the card.
    const c1 = data.cards[0]!;
    expect(planMove(data, shown, c1, 'none', 'todo', 1)).toMatchObject({ beforeId: null });
  });

  it('keeps a sorted column sorted', () => {
    const data = board([card('c1', 'todo', 'a'), card('c2', 'doing', 'a')]);
    data.columns[0]!.sort = 'due';
    const shown = layout(data, {}, NOW);
    expect(planMove(data, shown, data.cards[1]!, 'none', 'todo', 0)).toMatchObject({
      beforeId: null,
    });
  });

  it('puts the last card of a lane before the next card in the column', () => {
    const data = board(
      [
        card('c1', 'todo', 'a', { swimlaneId: 'web' }),
        card('c2', 'todo', 'b', { swimlaneId: null }),
        card('c3', 'doing', 'a'),
      ],
      {
        swimlanes: [
          { id: 'web', boardId: 'b', name: 'Web', color: null, collapsed: false, sortKey: 'a' },
        ],
      },
    );
    data.board.settings.lanes = 'custom';
    const shown = layout(data, {}, NOW);
    expect(planMove(data, shown, data.cards[2]!, 'web', 'todo', 1)).toEqual({
      columnId: 'todo',
      swimlaneId: 'web',
      beforeId: 'c2',
    });
    expect(planMove(data, shown, data.cards[2]!, 'none', 'todo', 0)).toMatchObject({
      swimlaneId: null,
      beforeId: 'c2',
    });
  });

  it('sets the priority or label of an automatic lane', () => {
    const data = board([card('c1', 'todo', 'a', { labelIds: ['l1', 'l2'] })], {
      labels: [
        { id: 'l1', projectId: 'p', name: 'Bug', color: 'coral' },
        { id: 'l2', projectId: 'p', name: 'Copy', color: 'green' },
        { id: 'l3', projectId: 'p', name: 'Design', color: 'blue' },
      ],
    });
    const c1 = data.cards[0]!;
    data.board.settings.lanes = 'priority';
    expect(planMove(data, layout(data, {}, NOW), c1, 'urgent', 'doing', 0).patch).toEqual({
      priority: 'urgent',
    });
    data.board.settings.lanes = 'label';
    const shown = layout(data, {}, NOW);
    expect(planMove(data, shown, c1, 'l3', 'todo', 0).patch).toEqual({
      labelIds: ['l3', 'l2'],
    });
    expect(planMove(data, shown, c1, 'none', 'todo', 0).patch).toEqual({ labelIds: ['l2'] });
    expect(planMove(data, shown, c1, 'l1', 'doing', 0).patch).toBeUndefined();
    expect(placeOf(data, shown, c1)).toEqual({ lane: 'l1', columnId: 'todo', index: 0 });
  });
});
