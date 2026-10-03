import {
  parseFlowchart,
  parseMindmap,
  parseSequence,
  printFlowchart,
  printMindmap,
  printSequence,
  type ParseResult,
} from '@memora/shared';
import { describe, expect, it } from 'vitest';
import {
  addBranch,
  addChildTopic,
  addNode,
  addSibling,
  addSiblingTopic,
  connect,
  edgeDomId,
  freshId,
  groupNodes,
  indentTopic,
  insertStep,
  messagePaths,
  moveStep,
  moveTopic,
  outdentTopic,
  removeBranch,
  removeNodes,
  removeParticipant,
  removeStep,
  removeTopic,
  reverseEdge,
  samePath,
  stepAt,
  stepRows,
  ungroup,
  updateTopic,
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
