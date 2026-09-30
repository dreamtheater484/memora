import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  PANE_LIMIT,
  defaultWorkspace,
  evenSizes,
  fromLayout,
  movedTab,
  resized,
  splitWith,
  tidy,
  toLayout,
  withPane,
  withTab,
  withoutPane,
  withoutTab,
  type Workspace,
} from './model';

const page = (id: string) => ({ kind: 'page' as const, target: id });
const sum = (sizes: number[]) => Math.round(sizes.reduce((a, b) => a + b, 0));
const targets = (ws: Workspace) => ws.panes.map((p) => p.tabs.map((t) => t.target));

describe('panes', () => {
  it('are added up to the device’s limit, sharing the width', () => {
    let ws = withPane(EMPTY, [page('a')], PANE_LIMIT.ultra);
    expect(ws.sizes).toHaveLength(2);
    ws = withPane(ws, [page('b')], PANE_LIMIT.ultra, ws.panes[0]!.id);
    ws = withPane(ws, [page('c')], PANE_LIMIT.ultra, ws.panes[1]!.id);
    expect(targets(ws)).toEqual([['a'], ['b'], ['c']]);
    expect(sum(ws.sizes)).toBe(100);
    expect(withPane(ws, [page('d')], PANE_LIMIT.ultra)).toBe(ws);
    expect(withPane(withPane(EMPTY, [], 1), [], 1).panes).toHaveLength(1);
  });

  it('give their width to the left when closed', () => {
    let ws = withPane(EMPTY, [page('a')], 3);
    ws = withPane(ws, [page('b')], 3, ws.panes[0]!.id);
    ws = { ...ws, sizes: [50, 30, 20] };
    const closed = withoutPane(ws, ws.panes[1]!.id);
    expect(closed.sizes).toEqual([50, 50]);
    expect(targets(closed)).toEqual([['a']]);
  });

  it('resize within limits', () => {
    const ws: Workspace = { ...withPane(EMPTY, [], 3), sizes: [60, 40] };
    expect(resized(ws, 0, 10).sizes).toEqual([70, 30]);
    expect(resized(ws, 0, 60).sizes).toEqual([88, 12]);
    expect(resized(ws, 0, -80).sizes).toEqual([12, 88]);
  });

  it('keep to a smaller device’s limit', () => {
    let ws = withPane(EMPTY, [page('a')], 3);
    ws = withPane(ws, [page('b')], 3, ws.panes[0]!.id);
    const fitted = tidy(ws, PANE_LIMIT.wide);
    expect(targets(fitted)).toEqual([['a']]);
    expect(sum(fitted.sizes)).toBe(100);
  });
});

describe('tabs', () => {
  it('open next to the shown one, and show a thing already open instead of repeating it', () => {
    let ws = withPane(EMPTY, [page('a'), page('b')], 3);
    const pane = ws.panes[0]!.id;
    ws = withTab(ws, pane, page('c'));
    expect(targets(ws)).toEqual([['a', 'c', 'b']]);
    ws = withTab(ws, pane, page('b'));
    expect(ws.panes[0]!.tabs.find((t) => t.id === ws.panes[0]!.active)?.target).toBe('b');
    expect(ws.panes[0]!.tabs).toHaveLength(3);
  });

  it('close, showing a neighbour, and leave an empty pane open', () => {
    let ws = withPane(EMPTY, [page('a'), page('b')], 3);
    const [a, b] = ws.panes[0]!.tabs;
    ws = withoutTab(ws, a!.id);
    expect(ws.panes[0]!.active).toBe(b!.id);
    ws = withoutTab(ws, b!.id);
    expect(ws.panes).toHaveLength(1);
    expect(ws.panes[0]!.active).toBeNull();
  });

  it('move between panes', () => {
    let ws = withPane(EMPTY, [page('a'), page('b')], 3);
    ws = withPane(ws, [page('c')], 3, ws.panes[0]!.id);
    const b = ws.panes[0]!.tabs[1]!;
    ws = movedTab(ws, b.id, ws.panes[1]!.id, 0);
    expect(targets(ws)).toEqual([['a'], ['b', 'c']]);
    expect(ws.panes[1]!.active).toBe(b.id);
    // A pane its last tab leaves closes.
    ws = movedTab(ws, ws.panes[0]!.tabs[0]!.id, ws.panes[1]!.id);
    expect(targets(ws)).toEqual([['b', 'c', 'a']]);
    expect(ws.sizes).toHaveLength(2);
  });

  it('split into a new pane beside the one they are dropped on', () => {
    let ws = withPane(EMPTY, [page('a'), page('b')], 3);
    const b = ws.panes[0]!.tabs[1]!;
    ws = splitWith(ws, b.id, ws.panes[0]!.id, 'after', 3);
    expect(targets(ws)).toEqual([['a'], ['b']]);
    // Beside the main pane: right after it.
    const a = ws.panes[0]!.tabs[0]!;
    ws = splitWith(ws, a.id, 'main', 'before', 3);
    expect(targets(ws)).toEqual([['a'], ['b']]);
    expect(ws.panes).toHaveLength(2);
    // No room: nothing changes.
    const full = withPane(withPane(withPane(EMPTY, [page('x'), page('y')], 3), [], 3), [], 3);
    const y = full.panes.find((p) => p.tabs.length === 2)!.tabs[1]!;
    expect(splitWith(full, y.id, 'main', 'after', 3)).toBe(full);
  });
});

describe('layouts', () => {
  it('are saved and applied again', () => {
    let ws = withPane(EMPTY, [page('a'), page('b')], 3);
    ws = withTab(ws, ws.panes[0]!.id, { kind: 'backlinks', target: null });
    const layout = toLayout(ws, 'Writing');
    expect(layout).toMatchObject({
      name: 'Writing',
      panes: [
        {
          tabs: [page('a'), { kind: 'backlinks', target: null }, page('b')],
          active: 1,
        },
      ],
    });
    const back = fromLayout(layout, 3);
    expect(targets(back)).toEqual([['a', null, 'b']]);
    expect(back.panes[0]!.tabs[1]!.id).toBe(back.panes[0]!.active);
    expect(fromLayout(layout, 0).panes).toEqual([]);
  });

  it('start with a board beside the notes on ultra-wide screens', () => {
    expect(defaultWorkspace('wide', 'b1')).toBe(EMPTY);
    const ultra = defaultWorkspace('ultra', 'b1');
    expect(targets(ultra)).toEqual([[], ['b1']]);
    expect(ultra.sizes).toEqual(evenSizes(2));
    expect(defaultWorkspace('ultra', null).panes).toHaveLength(1);
  });
});
