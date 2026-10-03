import {
  parseFlowchart,
  parseGantt,
  parseMindmap,
  parsePie,
  parseSequence,
  parseTimeline,
  type DiagramModel,
  type ParseResult,
} from '@memora/shared';
import { describe, expect, it } from 'vitest';
import { hitMap } from './hits';
import { afterEdit, keyAction, stillThere, typesText, type KeyLike, type Outcome } from './keys';
import { textOf, withText } from './labels';
import { stepAt } from './ops';
import type { Selection } from './selection';

const model = <T>(result: ParseResult<T>): T => {
  if (!result.ok) throw new Error(result.reason);
  return result.model;
};

/** A key as the canvas gets it: "Mod+Shift+Enter", "Alt+ArrowUp", "a". */
function key(spec: string): KeyLike {
  const parts = spec.split('+');
  const name = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  const code = /^[a-z]$/i.test(name)
    ? `Key${name.toUpperCase()}`
    : /^\d$/.test(name)
      ? `Digit${name}`
      : name;
  return {
    key: name,
    code,
    shiftKey: has('Shift'),
    altKey: has('Alt'),
    ctrlKey: has('Mod'),
    metaKey: false,
  };
}

const NOWHERE = hitMap(null, null);
const press = (spec: string, m: DiagramModel, selection: Selection): Outcome | null =>
  keyAction(key(spec), m, selection, NOWHERE);

const FLOW = model(
  parseFlowchart('flowchart TD\n  n1["Start"] --> n2["Middle"]\n  n2 --> n3["End"]'),
);
const MAP = model(parseMindmap('mindmap\n  root((Plan))\n    Goals\n      Fast\n    Risks'));
const SEQ = model(
  parseSequence('sequenceDiagram\n  A->>B: Hello\n  loop Every minute\n    A->>B: Ping\n  end'),
);

describe('editing words', () => {
  it('starts with F2, Space or typing (which replaces the words); never on ? or with Ctrl', () => {
    const box: Selection = { kind: 'nodes', ids: ['n2'] };
    expect(press('F2', FLOW, box)).toEqual({ edit: { item: { kind: 'node', id: 'n2' } } });
    expect(press(' ', FLOW, box)?.edit).toMatchObject({ caretAtEnd: true });
    expect(press('x', FLOW, box)?.edit).toMatchObject({ typed: 'x' });
    expect(typesText(key('?'))).toBe(false);
    expect(typesText(key('Mod+x'))).toBe(false);
  });

  it('reads and writes the words of every kind of item, quotes and all', () => {
    const renamed = withText(FLOW, { kind: 'node', id: 'n1' }, 'Say "hi" & go');
    expect(textOf(renamed, { kind: 'node', id: 'n1' })?.text).toBe('Say "hi" & go');
    const message = withText(SEQ, { kind: 'step', path: [1, 0, 0] }, 'Ping again');
    expect(stepAt(message, [1, 0, 0])).toMatchObject({ text: 'Ping again' });
    const loop = withText(SEQ, { kind: 'step', path: [1] }, 'Every hour');
    expect(textOf(loop, { kind: 'step', path: [1] })?.text).toBe('Every hour');
    const pie = model(parsePie('pie\n  "A" : 1'));
    expect(withText(pie, { kind: 'value', index: 0 }, '2,5').slices[0]!.value).toBe(2.5);
    // Not a number: the value stays.
    expect(withText(pie, { kind: 'value', index: 0 }, 'many').slices[0]!.value).toBe(1);
  });
});

describe('flowchart keys', () => {
  const one: Selection = { kind: 'nodes', ids: ['n2'] };

  it('Tab adds a connected box and edits its words; Shift+Enter one beside it', () => {
    const tab = press('Tab', FLOW, one)!;
    const chart = tab.model as typeof FLOW;
    expect(chart.nodes).toHaveLength(4);
    expect(chart.edges.some((e) => e.from === 'n2' && e.to === 'n4')).toBe(true);
    expect(tab.edit).toEqual({
      item: { kind: 'node', id: 'n4' },
      anchor: { kind: 'node', id: 'n2' },
    });
    const beside = press('Shift+Enter', FLOW, one)!.model as typeof FLOW;
    expect(beside.edges.some((e) => e.from === 'n1' && e.to === 'n4')).toBe(true);
  });

  it('Delete removes; Mod+Shift+Delete keeps the flow', () => {
    expect((press('Delete', FLOW, one)!.model as typeof FLOW).edges).toHaveLength(0);
    const kept = press('Mod+Shift+Delete', FLOW, one)!.model as typeof FLOW;
    expect(kept.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['n1>n3']);
  });

  it('selects every box, groups them, gives them a shape and a colour', () => {
    expect(press('Mod+a', FLOW, null)?.select).toEqual({ kind: 'nodes', ids: ['n1', 'n2', 'n3'] });
    const two: Selection = { kind: 'nodes', ids: ['n1', 'n2'] };
    const grouped = press('Mod+g', FLOW, two)!;
    expect((grouped.model as typeof FLOW).groups).toHaveLength(1);
    const shaped = press('Mod+2', FLOW, one)!.model as typeof FLOW;
    expect(shaped.nodes[1]!.shape).not.toBe(FLOW.nodes[1]!.shape);
    const coloured = press('Alt+1', FLOW, one)!.model as typeof FLOW;
    expect(coloured.nodes[1]!.colour).not.toBeNull();
  });

  it('copies and pastes boxes', () => {
    expect(press('Mod+c', FLOW, one)).toEqual({ announce: 'Copied' });
    const pasted = press('Mod+v', FLOW, null)!;
    expect((pasted.model as typeof FLOW).nodes).toHaveLength(4);
  });

  it('Tab while editing keeps the words and goes on, in one change', () => {
    const renamed = withText(FLOW, { kind: 'node', id: 'n3' }, 'Finish');
    const next = afterEdit(renamed, { kind: 'node', id: 'n3' }, NOWHERE)!;
    const chart = next.model as typeof FLOW;
    expect(chart.nodes.find((n) => n.id === 'n3')?.label).toBe('Finish');
    expect(chart.edges.some((e) => e.from === 'n3' && e.to === 'n4')).toBe(true);
  });
});

describe('mind map keys', () => {
  const goals: Selection = { kind: 'topic', index: 1 };

  it('Enter adds a topic after it, Tab one under it, Mod+Shift+Enter one above it', () => {
    expect(press('Enter', MAP, goals)?.select).toEqual({ kind: 'topic', index: 3 });
    expect(press('Tab', MAP, goals)?.select).toEqual({ kind: 'topic', index: 3 });
    const above = press('Mod+Shift+Enter', MAP, goals)!.model as typeof MAP;
    expect(above.root.children[0]!.label).toBe('New topic');
  });

  it('moves topics with Alt and the arrows; never deletes the centre', () => {
    const down = press('Alt+ArrowDown', MAP, goals)!.model as typeof MAP;
    expect(down.root.children.map((t) => t.label)).toEqual(['Risks', 'Goals']);
    expect(press('Delete', MAP, { kind: 'topic', index: 0 })).toEqual({});
    expect(press('Mod+Backspace', MAP, { kind: 'topic', index: 2 })?.select).toEqual(goals);
  });
});

describe('sequence diagram keys', () => {
  const hello: Selection = { kind: 'step', path: [0] };

  it('Enter adds a message after it, Tab the reply, Alt+Enter a note', () => {
    const enter = press('Enter', SEQ, hello)!;
    expect(enter.select).toEqual({ kind: 'step', path: [1] });
    const reply = press('Tab', SEQ, hello)!;
    expect(stepAt(reply.model as typeof SEQ, [1])).toMatchObject({ from: 'B', to: 'A' });
    const note = press('Alt+Enter', SEQ, hello)!;
    expect(stepAt(note.model as typeof SEQ, [1])).toMatchObject({ kind: 'note' });
  });

  it('a new step in a selected block goes inside it', () => {
    const inside = press('Enter', SEQ, { kind: 'step', path: [1] })!;
    expect(inside.select).toEqual({ kind: 'step', path: [1, 0, 1] });
  });

  it('moves steps into blocks, wraps them in a loop, moves participants', () => {
    const down = press('Alt+ArrowDown', SEQ, hello)!;
    expect(down.select).toEqual({ kind: 'step', path: [0, 0, 0] });
    const wrapped = press('Mod+Shift+Enter', SEQ, hello)!;
    expect(stepAt(wrapped.model as typeof SEQ, [0])).toMatchObject({ kind: 'block' });
    const moved = press('Alt+ArrowRight', SEQ, { kind: 'participant', id: 'A' })!;
    expect((moved.model as typeof SEQ).participants.map((p) => p.id)).toEqual(['B', 'A']);
  });

  it('the arrows go through the steps as they read', () => {
    expect(press('ArrowDown', SEQ, hello)?.select).toEqual({ kind: 'step', path: [1] });
    expect(press('ArrowDown', SEQ, { kind: 'step', path: [1] })?.select).toEqual({
      kind: 'step',
      path: [1, 0, 0],
    });
    expect(press('Mod+Backspace', SEQ, { kind: 'step', path: [1, 0, 0] })?.select).toEqual({
      kind: 'step',
      path: [1],
    });
  });
});

describe('timeline, Gantt and pie keys', () => {
  const TIME = model(parseTimeline('timeline\n  2024 : Start\n  2025 : Grow'));
  const GANTT = model(
    parseGantt('gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2026-01-01, 3d\n  B :after a, 2d'),
  );
  const PIE = model(parsePie('pie\n  "A" : 1\n  "B" : 2'));

  it('Enter adds the next period, task or slice, ready to type', () => {
    const period = press('Enter', TIME, { kind: 'period', section: 0, period: 0 })!;
    expect(period.edit?.item).toEqual({ kind: 'period', section: 0, period: 1 });
    const event = press('Tab', TIME, { kind: 'period', section: 0, period: 0 })!;
    expect(event.edit?.item).toEqual({ kind: 'event', section: 0, period: 0, event: 1 });
    const task = press('Enter', GANTT, { kind: 'task', section: 0, task: 0 })!;
    expect(task.edit?.item).toEqual({ kind: 'task', section: 0, task: 1 });
    const slice = press('Enter', PIE, { kind: 'slice', index: 1 })!;
    expect(slice.edit?.item).toEqual({ kind: 'slice', index: 2 });
  });

  it('Delete removes and selects what is next; Alt+↑ moves', () => {
    const gone = press('Delete', PIE, { kind: 'slice', index: 1 })!;
    expect(gone.select).toEqual({ kind: 'slice', index: 0 });
    const up = press('Alt+ArrowUp', GANTT, { kind: 'task', section: 0, task: 1 })!;
    expect((up.model as typeof GANTT).sections[0]!.tasks.map((t) => t.name)).toEqual(['B', 'A']);
  });
});

describe('the selection after a change', () => {
  it('keeps only what is still there', () => {
    const fewer = model(parseFlowchart('flowchart TD\n  n1["Start"]'));
    expect(stillThere(fewer, { kind: 'nodes', ids: ['n1', 'n2'] })).toEqual({
      kind: 'nodes',
      ids: ['n1'],
    });
    expect(stillThere(fewer, { kind: 'nodes', ids: ['n2'] })).toBeNull();
    expect(stillThere(SEQ, { kind: 'step', path: [5] })).toBeNull();
  });
});
