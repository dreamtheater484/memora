import {
  mindmapTopics,
  type FlowDirection,
  type FlowEdge,
  type FlowGroup,
  type FlowNode,
  type Flowchart,
  type Mindmap,
  type MindmapTopic,
  type SequenceBlock,
  type SequenceDiagram,
  type SequenceStep,
} from '@memora/shared';

/*
 * What the diagram editor does to a diagram (§9.4), as pure functions on its model: each
 * returns a new model and leaves the old one as it was (the editor's undo keeps them).
 */

const clone = <T>(value: T): T => structuredClone(value);

// Flowcharts

/** An id no box or group has yet: n1, n2… */
export function freshId(chart: Flowchart, prefix = 'n'): string {
  const used = new Set([...chart.nodes.map((n) => n.id), ...chart.groups.map((g) => g.id)]);
  let i = 1;
  while (used.has(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
}

export const NEW_BOX = 'New box';

const arrow = (from: string, to: string): FlowEdge => ({
  from,
  to,
  label: '',
  line: 'solid',
  start: 'none',
  end: 'arrow',
  extra: 0,
});

/** A new box; connected from `from` when given, and in its group. */
export function addNode(
  chart: Flowchart,
  options: { from?: string; label?: string; group?: string | null } = {},
): { chart: Flowchart; id: string } {
  const next = clone(chart);
  const id = freshId(next);
  const source = options.from ? next.nodes.find((n) => n.id === options.from) : undefined;
  const node: FlowNode = {
    id,
    label: options.label ?? NEW_BOX,
    shape: 'rect',
    colour: null,
    classes: [],
    group: options.group !== undefined ? options.group : (source?.group ?? null),
  };
  next.nodes.push(node);
  if (options.from) next.edges.push(arrow(options.from, id));
  return { chart: next, id };
}

/** A new box beside one: connected from the same boxes it is connected from. */
export function addSibling(chart: Flowchart, of: string): { chart: Flowchart; id: string } {
  const node = chart.nodes.find((n) => n.id === of);
  const added = addNode(chart, { group: node?.group ?? null });
  const parents = chart.edges.filter((e) => e.to === of).map((e) => e.from);
  for (const parent of parents) added.chart.edges.push(arrow(parent, added.id));
  return added;
}

/** An arrow from one box to another, unless there is one already. */
export function connect(chart: Flowchart, from: string, to: string): Flowchart {
  if (from === to || chart.edges.some((e) => e.from === from && e.to === to)) return chart;
  const next = clone(chart);
  next.edges.push(arrow(from, to));
  return next;
}

export function updateNode(
  chart: Flowchart,
  id: string,
  changes: Partial<Omit<FlowNode, 'id'>>,
): Flowchart {
  const next = clone(chart);
  const node = next.nodes.find((n) => n.id === id);
  if (node) Object.assign(node, changes);
  return next;
}

/** Removes boxes and the arrows on them. */
export function removeNodes(chart: Flowchart, ids: readonly string[]): Flowchart {
  const gone = new Set(ids);
  const next = clone(chart);
  next.nodes = next.nodes.filter((n) => !gone.has(n.id));
  next.edges = next.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
  return next;
}

export function updateEdge(
  chart: Flowchart,
  index: number,
  changes: Partial<Omit<FlowEdge, 'from' | 'to'>>,
): Flowchart {
  const next = clone(chart);
  const edge = next.edges[index];
  if (edge) Object.assign(edge, changes);
  return next;
}

export function reverseEdge(chart: Flowchart, index: number): Flowchart {
  const next = clone(chart);
  const edge = next.edges[index];
  if (edge) {
    [edge.from, edge.to] = [edge.to, edge.from];
    [edge.start, edge.end] = [edge.end, edge.start];
  }
  return next;
}

export function removeEdge(chart: Flowchart, index: number): Flowchart {
  const next = clone(chart);
  next.edges.splice(index, 1);
  return next;
}

/** Puts boxes in a new group, inside the group they share (if any). */
export function groupNodes(
  chart: Flowchart,
  ids: readonly string[],
  label = 'Group',
): { chart: Flowchart; id: string } {
  const next = clone(chart);
  const id = freshId(next, 'g');
  const members = next.nodes.filter((n) => ids.includes(n.id));
  const parents = new Set(members.map((n) => n.group));
  const parent = parents.size === 1 ? [...parents][0]! : null;
  next.groups.push({ id, label, parent, direction: null });
  for (const node of members) node.group = id;
  return { chart: next, id };
}

/** Removes a group, keeping what it held in the group around it. */
export function ungroup(chart: Flowchart, id: string): Flowchart {
  const next = clone(chart);
  const group = next.groups.find((g) => g.id === id);
  if (!group) return chart;
  for (const node of next.nodes) if (node.group === id) node.group = group.parent;
  for (const child of next.groups) if (child.parent === id) child.parent = group.parent;
  next.groups = next.groups.filter((g) => g.id !== id);
  next.edges = next.edges.filter((e) => e.from !== id && e.to !== id);
  return next;
}

export function updateGroup(
  chart: Flowchart,
  id: string,
  changes: Partial<Omit<FlowGroup, 'id'>>,
): Flowchart {
  const next = clone(chart);
  const group = next.groups.find((g) => g.id === id);
  if (group) Object.assign(group, changes);
  return next;
}

export function setDirection(chart: Flowchart, direction: FlowDirection): Flowchart {
  return { ...chart, direction };
}

/** The id Mermaid gives an arrow's drawing: `L_<from>_<to>_<n>` for the nth such arrow. */
export function edgeDomId(chart: Flowchart, index: number): string {
  const edge = chart.edges[index]!;
  const n = chart.edges
    .slice(0, index)
    .filter((e) => e.from === edge.from && e.to === edge.to).length;
  return `L_${edge.from}_${edge.to}_${n}`;
}

// Mind maps: topics are numbered depth first, as Mermaid numbers its drawing (node_0 is the root).

interface Located {
  topic: MindmapTopic;
  parent: MindmapTopic | null;
  /** Its place among its parent's children. */
  at: number;
}

function locate(root: MindmapTopic, index: number): Located | null {
  let count = 0;
  let found: Located | null = null;
  const walk = (topic: MindmapTopic, parent: MindmapTopic | null, at: number) => {
    if (found) return;
    if (count === index) {
      found = { topic, parent, at };
      return;
    }
    count += 1;
    topic.children.forEach((child, i) => walk(child, topic, i));
  };
  walk(root, null, 0);
  return found;
}

const indexOf = (map: Mindmap, topic: MindmapTopic) =>
  mindmapTopics(map).findIndex((t) => t.topic === topic);

export const NEW_TOPIC = 'New topic';

const newTopic = (label = NEW_TOPIC): MindmapTopic => ({
  label,
  shape: 'default',
  id: null,
  decorations: [],
  children: [],
});

export function addChildTopic(map: Mindmap, index: number): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place) return { map, index };
  const topic = newTopic();
  place.topic.children.push(topic);
  return { map: next, index: indexOf(next, topic) };
}

/** A topic after this one, at its level (a child, for the central topic). */
export function addSiblingTopic(map: Mindmap, index: number): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place) return { map, index };
  if (!place.parent) return addChildTopic(map, index);
  const topic = newTopic();
  place.parent.children.splice(place.at + 1, 0, topic);
  return { map: next, index: indexOf(next, topic) };
}

export function updateTopic(
  map: Mindmap,
  index: number,
  changes: Partial<Pick<MindmapTopic, 'label' | 'shape'>>,
): Mindmap {
  const next = clone(map);
  const place = locate(next.root, index);
  if (place) Object.assign(place.topic, changes);
  return next;
}

/** Removes a topic and what is under it; the central topic stays. */
export function removeTopic(map: Mindmap, index: number): Mindmap {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place?.parent) return map;
  place.parent.children.splice(place.at, 1);
  return next;
}

/** Makes a topic the last child of the one before it. */
export function indentTopic(map: Mindmap, index: number): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place?.parent || place.at === 0) return { map, index };
  const before = place.parent.children[place.at - 1]!;
  place.parent.children.splice(place.at, 1);
  before.children.push(place.topic);
  return { map: next, index: indexOf(next, place.topic) };
}

/** Makes a topic the next sibling of its parent. */
export function outdentTopic(map: Mindmap, index: number): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place?.parent) return { map, index };
  const parent = locate(next.root, indexOf(next, place.parent));
  if (!parent?.parent) return { map, index };
  place.parent.children.splice(place.at, 1);
  parent.parent.children.splice(parent.at + 1, 0, place.topic);
  return { map: next, index: indexOf(next, place.topic) };
}

/** Moves a topic before or after its neighbour at its level. */
export function moveTopic(
  map: Mindmap,
  index: number,
  delta: -1 | 1,
): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place?.parent) return { map, index };
  const to = place.at + delta;
  if (to < 0 || to >= place.parent.children.length) return { map, index };
  const list = place.parent.children;
  [list[place.at], list[to]] = [list[to]!, list[place.at]!];
  return { map: next, index: indexOf(next, place.topic) };
}

// Sequence diagrams: a step is found by its path, [step, branch, step, branch, …, step].

export type StepPath = number[];

/** The list a path's last step is in. */
function listOf(diagram: SequenceDiagram, path: StepPath): SequenceStep[] | null {
  let list = diagram.steps;
  for (let i = 0; i + 1 < path.length; i += 2) {
    const step = list[path[i]!];
    if (step?.kind !== 'block') return null;
    const branch = step.branches[path[i + 1]!];
    if (!branch) return null;
    list = branch.steps;
  }
  return list;
}

export function stepAt(diagram: SequenceDiagram, path: StepPath): SequenceStep | null {
  return listOf(diagram, path)?.[path.at(-1)!] ?? null;
}

/** The rows of the step list: each step, and each further branch of a block. */
export type StepRow =
  | { kind: 'step'; path: StepPath; step: SequenceStep; depth: number }
  | { kind: 'branch'; path: StepPath; branch: number; depth: number }
  | { kind: 'end'; path: StepPath; depth: number };

export function stepRows(diagram: SequenceDiagram): StepRow[] {
  const rows: StepRow[] = [];
  const walk = (list: SequenceStep[], base: StepPath, depth: number) => {
    list.forEach((step, i) => {
      const path = [...base, i];
      rows.push({ kind: 'step', path, step, depth });
      if (step.kind === 'block') {
        step.branches.forEach((branch, b) => {
          if (b > 0) rows.push({ kind: 'branch', path, branch: b, depth });
          walk(branch.steps, [...path, b], depth + 1);
        });
        rows.push({ kind: 'end', path, depth });
      }
    });
  };
  walk(diagram.steps, [], 0);
  return rows;
}

/** Inserts a step after `after` (in the same list), or at the end. */
export function insertStep(
  diagram: SequenceDiagram,
  step: SequenceStep,
  after: StepPath | null,
): { diagram: SequenceDiagram; path: StepPath } {
  const next = clone(diagram);
  if (after) {
    const list = listOf(next, after);
    if (list) {
      const at = after.at(-1)! + 1;
      list.splice(at, 0, step);
      return { diagram: next, path: [...after.slice(0, -1), at] };
    }
  }
  next.steps.push(step);
  return { diagram: next, path: [next.steps.length - 1] };
}

export function updateStep(
  diagram: SequenceDiagram,
  path: StepPath,
  change: (step: SequenceStep) => void,
): SequenceDiagram {
  const next = clone(diagram);
  const step = stepAt(next, path);
  if (step) change(step);
  return next;
}

/** Removes a step; a block's steps stay, in its place. */
export function removeStep(diagram: SequenceDiagram, path: StepPath): SequenceDiagram {
  const next = clone(diagram);
  const list = listOf(next, path);
  const at = path.at(-1)!;
  const step = list?.[at];
  if (!list || !step) return diagram;
  const kept = step.kind === 'block' ? step.branches.flatMap((b) => b.steps) : [];
  list.splice(at, 1, ...kept);
  return next;
}

/** Moves a step up or down in its list. */
export function moveStep(
  diagram: SequenceDiagram,
  path: StepPath,
  delta: -1 | 1,
): { diagram: SequenceDiagram; path: StepPath } {
  const next = clone(diagram);
  const list = listOf(next, path);
  const at = path.at(-1)!;
  const to = at + delta;
  if (!list || to < 0 || to >= list.length) return { diagram, path };
  [list[at], list[to]] = [list[to]!, list[at]!];
  return { diagram: next, path: [...path.slice(0, -1), to] };
}

/** Adds a branch (else, and, option) to a block that can have more. */
export function addBranch(diagram: SequenceDiagram, path: StepPath): SequenceDiagram {
  return updateStep(diagram, path, (step) => {
    if (step.kind === 'block') step.branches.push({ text: '', steps: [] });
  });
}

export function removeBranch(diagram: SequenceDiagram, path: StepPath, branch: number) {
  return updateStep(diagram, path, (step) => {
    if (step.kind !== 'block' || branch === 0) return;
    const [gone] = step.branches.splice(branch, 1);
    // Its steps join the branch before it.
    if (gone) step.branches[branch - 1]!.steps.push(...gone.steps);
  });
}

/** The participants a diagram uses, with a fresh id for a new one. */
export function freshParticipant(diagram: SequenceDiagram): string {
  const used = new Set(diagram.participants.map((p) => p.id));
  let i = 1;
  while (used.has(`P${i}`)) i += 1;
  return `P${i}`;
}

/** Removes a participant and the messages and notes that involve it. */
export function removeParticipant(diagram: SequenceDiagram, id: string): SequenceDiagram {
  const next = clone(diagram);
  next.participants = next.participants.filter((p) => p.id !== id);
  const keep = (steps: SequenceStep[]): SequenceStep[] =>
    steps.filter((step) => {
      if (step.kind === 'message') return step.from !== id && step.to !== id;
      if (step.kind === 'note') return !step.of.includes(id);
      if (step.kind === 'block') {
        for (const branch of step.branches) branch.steps = keep(branch.steps);
      }
      return true;
    });
  next.steps = keep(next.steps);
  return next;
}

/** Every message, in the order Mermaid draws them, with its path. */
export function messagePaths(diagram: SequenceDiagram): StepPath[] {
  return stepRows(diagram)
    .filter((r) => r.kind === 'step' && r.step.kind === 'message')
    .map((r) => r.path);
}

export function notePaths(diagram: SequenceDiagram): StepPath[] {
  return stepRows(diagram)
    .filter((r) => r.kind === 'step' && r.step.kind === 'note')
    .map((r) => r.path);
}

export const samePath = (a: StepPath | null, b: StepPath | null) =>
  !!a && !!b && a.length === b.length && a.every((n, i) => n === b[i]);

export type { SequenceBlock };
