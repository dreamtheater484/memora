import {
  parseFlowchart,
  parseGantt,
  parseMindmap,
  parsePie,
  parseSequence,
  parseTimeline,
  printFlowchart,
  printMindmap,
  printSequence,
  type ParseResult,
} from '@memora/shared';
import { describe, expect, it } from 'vitest';
import {
  addBefore,
  addBranch,
  addChildTopic,
  addNode,
  addParticipant,
  addPeriod,
  addSibling,
  addSiblingTopic,
  addSlice,
  addTask,
  connect,
  connectAll,
  copyNodes,
  copyTopic,
  duplicateNodes,
  duplicateStep,
  edgeDomId,
  freshId,
  groupNodes,
  groupTree,
  indentStep,
  indentTopic,
  insertParentTopic,
  insertStep,
  messagePaths,
  moveParticipant,
  movePeriod,
  moveSection,
  moveSlice,
  moveStep,
  moveStepTo,
  moveTask,
  moveToGroup,
  moveTopic,
  moveTopicToEnd,
  newMessage,
  noteFor,
  outdentStep,
  outdentTopic,
  pasteNodes,
  pasteTopic,
  removeBranch,
  removeGroup,
  removeNodes,
  removeNodesKeepFlow,
  removeParticipant,
  removeSectionKeep,
  removeSectionWhole,
  removeStep,
  removeStepWhole,
  removeTask,
  removeTopic,
  removeTopicKeepChildren,
  replyTo,
  reverseEdge,
  samePath,
  stepAt,
  stepOrder,
  stepRows,
  taskId,
  ungroup,
  updateTopic,
  wrapInBlock,
} from './ops';

const model = <T>(result: ParseResult<T>): T => {
  if (!result.ok) throw new Error(result.reason);
  return result.model;
};

const FLOW = model(
  parseFlowchart('flowchart TD\n  n1["Start"] --> n2["Middle"]\n  n2 --> n3["End"]'),
);

describe('flowcharts', () => {
  it('adds boxes with fresh ids, connected to where they came from', () => {
    expect(freshId(FLOW)).toBe('n4');
    const { chart, id } = addNode(FLOW, { from: 'n3', label: 'After' });
    expect(id).toBe('n4');
    expect(printFlowchart(chart)).toContain('n3 --> n4');
    expect(chart.nodes.at(-1)).toMatchObject({ id: 'n4', label: 'After', shape: 'rect' });
    // The model it came from is left as it was (undo keeps it).
    expect(FLOW.nodes).toHaveLength(3);
  });

  it('adds a box beside another, from the same boxes', () => {
    const { chart, id } = addSibling(FLOW, 'n3');
    expect(chart.edges.some((e) => e.from === 'n2' && e.to === id)).toBe(true);
  });

  it('connects once, never a box to itself', () => {
    expect(connect(FLOW, 'n1', 'n1')).toBe(FLOW);
    expect(connect(FLOW, 'n1', 'n2')).toBe(FLOW);
    expect(printFlowchart(connect(FLOW, 'n3', 'n1'))).toContain('n3 --> n1');
  });

  it('removes boxes with their arrows; reverses arrows with their ends', () => {
    const removed = removeNodes(FLOW, ['n2']);
    expect(removed.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
    expect(removed.edges).toEqual([]);
    const reversed = reverseEdge(connect(FLOW, 'n1', 'n3'), 2);
    expect(reversed.edges[2]).toMatchObject({ from: 'n3', to: 'n1', start: 'arrow', end: 'none' });
  });

  it('groups boxes and ungroups them, keeping them in the group around', () => {
    const { chart, id } = groupNodes(FLOW, ['n1', 'n2'], 'Team');
    expect(id).toBe('g1');
    expect(chart.nodes.filter((n) => n.group === 'g1').map((n) => n.id)).toEqual(['n1', 'n2']);
    const inner = groupNodes(chart, ['n2']);
    expect(inner.chart.groups.at(-1)).toMatchObject({ parent: 'g1' });
    const flat = ungroup(inner.chart, inner.id);
    expect(flat.nodes.find((n) => n.id === 'n2')!.group).toBe('g1');
  });

  it('names arrows as Mermaid draws them', () => {
    const twice = { ...FLOW, edges: [...FLOW.edges, { ...FLOW.edges[0]! }] };
    expect(edgeDomId(twice, 0)).toBe('L_n1_n2_0');
    expect(edgeDomId(twice, 2)).toBe('L_n1_n2_1');
  });
});

const MAP = model(parseMindmap('mindmap\n  root((Plan))\n    Goals\n      Fast\n    Risks'));

describe('mind maps', () => {
  // Topics are numbered depth first: 0 Plan, 1 Goals, 2 Fast, 3 Risks.
  it('adds children and siblings, numbered as drawn', () => {
    const child = addChildTopic(MAP, 1);
    expect(child.index).toBe(3);
    const sibling = addSiblingTopic(MAP, 1);
    expect(sibling.index).toBe(3);
    expect(sibling.map.root.children.map((t) => t.label)).toEqual(['Goals', 'New topic', 'Risks']);
    // A sibling of the centre is a child of it.
    expect(addSiblingTopic(MAP, 0).map.root.children).toHaveLength(3);
  });

  it('indents, outdents and moves topics, never the centre', () => {
    const indented = indentTopic(MAP, 3);
    expect(indented.map.root.children.map((t) => t.label)).toEqual(['Goals']);
    expect(indented.map.root.children[0]!.children.map((t) => t.label)).toEqual(['Fast', 'Risks']);
    const back = outdentTopic(indented.map, indented.index);
    expect(back.map.root.children.map((t) => t.label)).toEqual(['Goals', 'Risks']);
    expect(moveTopic(MAP, 3, -1).map.root.children.map((t) => t.label)).toEqual(['Risks', 'Goals']);
    expect(removeTopic(MAP, 0)).toBe(MAP);
    expect(removeTopic(MAP, 1).root.children.map((t) => t.label)).toEqual(['Risks']);
  });

  it('prints what was changed', () => {
    const renamed = updateTopic(MAP, 2, { label: 'Fast (very)', shape: 'rounded' });
    expect(printMindmap(renamed)).toContain('("Fast (very)")');
  });
});

const SEQ = model(
  parseSequence(
    'sequenceDiagram\n  A->>B: Hello\n  loop Every minute\n    A->>B: Ping\n  end\n  B-->>A: Bye',
  ),
);

describe('sequence diagrams', () => {
  it('lists steps with their paths, blocks and their ends', () => {
    expect(stepRows(SEQ).map((r) => [r.kind, r.path.join('.')])).toEqual([
      ['step', '0'],
      ['step', '1'],
      ['step', '1.0.0'],
      ['end', '1'],
      ['step', '2'],
    ]);
    expect(messagePaths(SEQ)).toEqual([[0], [1, 0, 0], [2]]);
    expect(stepAt(SEQ, [1, 0, 0])).toMatchObject({ kind: 'message', text: 'Ping' });
    expect(samePath([1, 0, 0], [1, 0, 0])).toBe(true);
    expect(samePath([1], null)).toBe(false);
  });

  it('inserts after a step in its block, and moves steps within it', () => {
    const message = {
      kind: 'message' as const,
      from: 'B',
      to: 'A',
      arrow: '-->>' as const,
      text: 'Pong',
      activation: null,
    };
    const { diagram, path } = insertStep(SEQ, message, [1, 0, 0]);
    expect(path).toEqual([1, 0, 1]);
    // Written as the code around it is: in the block, at its indent.
    expect(printSequence(diagram)).toContain('    A->>B: Ping\n    B-->>A: Pong\n  end');
    const moved = moveStep(diagram, [1, 0, 1], -1);
    expect(moved.path).toEqual([1, 0, 0]);
    expect(stepAt(moved.diagram, [1, 0, 0])).toMatchObject({ text: 'Pong' });
  });

  it('removing a block keeps its steps; branches join the one before', () => {
    expect(removeStep(SEQ, [1]).steps.map((s) => (s.kind === 'message' ? s.text : s.kind))).toEqual(
      ['Hello', 'Ping', 'Bye'],
    );
    const alt = addBranch(SEQ, [1]);
    const block = stepAt(alt, [1]);
    expect(block?.kind === 'block' && block.branches).toHaveLength(2);
    const joined = removeBranch(alt, [1], 1);
    const after = stepAt(joined, [1]);
    expect(after?.kind === 'block' && after.branches).toHaveLength(1);
  });

  it('removing a participant removes its messages', () => {
    const without = removeParticipant(SEQ, 'B');
    expect(messagePaths(without)).toEqual([]);
    expect(without.participants.map((p) => p.id)).toEqual(['A']);
  });
});

describe('flowcharts: more', () => {
  it('adds a box before another, taking over the arrows into it', () => {
    const { chart, id } = addBefore(FLOW, 'n2');
    expect(chart.edges.some((e) => e.from === 'n1' && e.to === id)).toBe(true);
    expect(chart.edges.some((e) => e.from === id && e.to === 'n2')).toBe(true);
    expect(chart.edges.some((e) => e.from === 'n1' && e.to === 'n2')).toBe(false);
  });

  it('connects boxes in the order they were selected', () => {
    const chart = connectAll(FLOW, ['n3', 'n1']);
    expect(chart.edges.some((e) => e.from === 'n3' && e.to === 'n1')).toBe(true);
  });

  it('removes a box keeping the flow through it', () => {
    const chart = removeNodesKeepFlow(FLOW, ['n2']);
    expect(chart.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
    expect(chart.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['n1>n3']);
  });

  it('moves boxes into and out of groups; removes a group with what is in it', () => {
    const grouped = groupNodes(FLOW, ['n1', 'n2']);
    expect([...groupTree(grouped.chart, grouped.id)]).toEqual([grouped.id]);
    const out = moveToGroup(grouped.chart, ['n1'], null);
    expect(out.nodes.find((n) => n.id === 'n1')?.group).toBeNull();
    const gone = removeGroup(grouped.chart, grouped.id);
    expect(gone.nodes.map((n) => n.id)).toEqual(['n3']);
    expect(gone.groups).toHaveLength(0);
  });

  it('copies, pastes and duplicates boxes with the arrows between them, under new ids', () => {
    const clip = copyNodes(FLOW, ['n1', 'n2'])!;
    const pasted = pasteNodes(FLOW, clip, null);
    expect(pasted.ids).toHaveLength(2);
    expect(pasted.ids.every((id) => !['n1', 'n2', 'n3'].includes(id))).toBe(true);
    expect(pasted.chart.edges.some((e) => e.from === pasted.ids[0] && e.to === pasted.ids[1])).toBe(
      true,
    );
    const copy = duplicateNodes(FLOW, ['n3']);
    expect(copy.chart.nodes.find((n) => n.id === copy.ids[0])?.label).toBe('End');
  });

  it('copies are new items: they don’t take the place in the code of what they copy', () => {
    const copy = duplicateNodes(FLOW, ['n3']);
    const original = copy.chart.nodes.find((n) => n.id === 'n3')!;
    const duplicate = copy.chart.nodes.find((n) => n.id === copy.ids[0])!;
    expect(original.origin).toBeDefined();
    expect(duplicate.origin).toBeUndefined();
    expect(printFlowchart(copy.chart)).toMatch(
      /^flowchart TD\n {2}n1\["Start"\] --> n2\["Middle"\]/,
    );
    const step = duplicateStep(SEQ, [0]);
    expect(stepAt(step.diagram, [1])).not.toHaveProperty('origin');
  });
});

describe('mind maps: more', () => {
  it('puts a new topic above one, and removes one keeping what is under it', () => {
    const parent = insertParentTopic(MAP, 2);
    const goals = parent.map.root.children[0]!;
    expect(goals.children.map((t) => t.label)).toEqual(['New topic']);
    expect(goals.children[0]!.children.map((t) => t.label)).toEqual(['Fast']);
    const kept = removeTopicKeepChildren(MAP, 1);
    expect(kept.root.children.map((t) => t.label)).toEqual(['Fast', 'Risks']);
  });

  it('moves a topic first or last among its siblings', () => {
    expect(moveTopicToEnd(MAP, 1, 'last').map.root.children.map((t) => t.label)).toEqual([
      'Risks',
      'Goals',
    ]);
  });

  it('copies a topic with what is under it, and pastes it under another', () => {
    const clip = copyTopic(MAP, 1)!;
    const pasted = pasteTopic(MAP, 3, clip);
    const risks = pasted.map.root.children[1]!;
    expect(risks.children[0]!.label).toBe('Goals');
    expect(risks.children[0]!.children[0]!.label).toBe('Fast');
  });
});

const ALT = model(
  parseSequence(
    'sequenceDiagram\n  A->>B: One\n  alt Yes\n    A->>B: Two\n  else No\n    B->>A: Three\n  end\n  A->>B: Four',
  ),
);

describe('sequence diagrams: moving through blocks', () => {
  const texts = (d: typeof ALT) =>
    stepOrder(d).map((p) => {
      const s = stepAt(d, p)!;
      return s.kind === 'message' ? s.text : s.kind === 'block' ? s.block : s.kind;
    });

  it('moves a step down into a block, through its branches and out again', () => {
    let at = { diagram: ALT, path: [0] };
    at = moveStep(at.diagram, at.path, 1);
    expect(at.path).toEqual([0, 0, 0]);
    expect(texts(at.diagram)).toEqual(['alt', 'One', 'Two', 'Three', 'Four']);
    at = moveStep(at.diagram, at.path, 1);
    at = moveStep(at.diagram, at.path, 1);
    expect(at.path).toEqual([0, 1, 0]);
    at = moveStep(at.diagram, at.path, 1);
    at = moveStep(at.diagram, at.path, 1);
    expect(at.path).toEqual([1]);
    expect(texts(at.diagram)).toEqual(['alt', 'Two', 'Three', 'One', 'Four']);
  });

  it('moves a step up into the block above, as its last step', () => {
    const up = moveStep(ALT, [2], -1);
    expect(up.path).toEqual([1, 1, 1]);
    expect(texts(up.diagram)).toEqual(['One', 'alt', 'Two', 'Three', 'Four']);
  });

  it('indents into the block above and outdents after its block', () => {
    const into = indentStep(ALT, [2]);
    expect(into.path).toEqual([1, 1, 1]);
    const out = outdentStep(into.diagram, into.path);
    expect(out.path).toEqual([2]);
    // No block above: nothing changes.
    expect(indentStep(ALT, [1]).diagram).toBe(ALT);
  });

  it('moves a step to a slot by dragging, never into itself', () => {
    const moved = moveStepTo(ALT, [2], { container: [1, 0], index: 0 });
    expect(moved.path).toEqual([1, 0, 0]);
    expect(texts(moved.diagram)).toEqual(['One', 'alt', 'Four', 'Two', 'Three']);
    expect(moveStepTo(ALT, [1], { container: [1, 0], index: 0 }).diagram).toBe(ALT);
  });

  it('wraps a step in a loop; removes a block with or without its steps', () => {
    const wrapped = wrapInBlock(ALT, [0]);
    expect(stepAt(wrapped.diagram, [0])).toMatchObject({ kind: 'block', block: 'loop' });
    expect(stepAt(wrapped.diagram, [0, 0, 0])).toMatchObject({ text: 'One' });
    expect(texts(removeStepWhole(ALT, [1]))).toEqual(['One', 'Four']);
    expect(texts(removeStep(ALT, [1]))).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('adds and moves participants, replies and notes', () => {
    const added = addParticipant(ALT, 'A');
    expect(added.diagram.participants.map((p) => p.id)).toEqual(['A', added.id, 'B']);
    expect(moveParticipant(ALT, 'B', -1).participants.map((p) => p.id)).toEqual(['B', 'A']);
    expect(moveParticipant(ALT, 'A', -1)).toBe(ALT);
    const one = stepAt(ALT, [0])!;
    if (one.kind !== 'message') throw new Error('a message');
    expect(replyTo(one)).toMatchObject({ from: 'B', to: 'A', arrow: '-->>' });
    expect(newMessage(ALT, one)).toMatchObject({ from: 'A', to: 'B' });
    expect(newMessage(ALT, null, 'B')).toMatchObject({ from: 'B', to: 'A' });
    expect(noteFor(one, ALT)).toMatchObject({ kind: 'note', side: 'over', of: ['A', 'B'] });
  });
});

describe('timelines, Gantt and pie charts', () => {
  const TIME = model(
    parseTimeline(
      'timeline\n  section One\n    2024 : Start\n    2025 : Grow\n  section Two\n    2026 : Ship',
    ),
  );
  const GANTT = model(
    parseGantt(
      'gantt\n  dateFormat YYYY-MM-DD\n  section Plan\n    Research :r, 2026-01-01, 3d\n    Design :d, after r, 2d\n  section Build\n    Code :after d, 5d',
    ),
  );
  const PIE = model(parsePie('pie\n  "A" : 1\n  "B" : 2'));

  it('adds periods and moves them across sections', () => {
    const added = addPeriod(TIME, 0, 0, 'after');
    expect(added.period).toBe(1);
    const moved = movePeriod(TIME, 0, 1, 1)!;
    expect(moved).toMatchObject({ section: 1, period: 0 });
    expect(moved.model.sections[1]!.periods.map((p) => p.label)).toEqual(['2025', '2026']);
    expect(moveSection(TIME, 0, 1)!.model.sections.map((s) => s.label)).toEqual(['Two', 'One']);
  });

  it('removes a section keeping or with what it holds', () => {
    expect(removeSectionKeep(TIME, 1).sections[0]!.periods).toHaveLength(3);
    expect(removeSectionWhole(TIME, 1).sections).toHaveLength(1);
  });

  it('adds tasks after the one above; removing one keeps those after it in place', () => {
    const added = addTask(GANTT, 0, 1, 'after');
    expect(added.model.sections[0]!.tasks[2]!.start).toEqual({ kind: 'previous' });
    const gone = removeTask(GANTT, 0, 1);
    // Code started after Design; it now starts where Design started (after Research).
    expect(gone.sections[1]!.tasks[0]!.start).toEqual({ kind: 'after', ids: ['r'] });
    const wholly = removeSectionWhole(GANTT, 0);
    expect(wholly.sections[0]!.tasks[0]!.start.kind).not.toBe('after');
  });

  it('moves tasks across sections and gives tasks ids when needed', () => {
    const moved = moveTask(GANTT, 0, 1, 1)!;
    expect(moved).toMatchObject({ section: 1, task: 0 });
    const copy = structuredClone(GANTT);
    expect(taskId(copy, copy.sections[1]!.tasks[0]!)).toBe('t1');
  });

  it('adds and moves pie slices', () => {
    expect(addSlice(PIE, 0).model.slices.map((s) => s.label)).toEqual(['A', 'Slice 3', 'B']);
    expect(moveSlice(PIE, 1, -1)!.model.slices.map((s) => s.label)).toEqual(['B', 'A']);
    expect(moveSlice(PIE, 0, -1)).toBeNull();
  });
});
