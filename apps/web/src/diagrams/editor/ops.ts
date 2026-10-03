import {
  mindmapTopics,
  type FlowDirection,
  type FlowEdge,
  type FlowGroup,
  type FlowNode,
  type Flowchart,
  type Gantt,
  type GanttTask,
  type Mindmap,
  type MindmapTopic,
  type Pie,
  type SequenceBlock,
  type SequenceBlockKind,
  type SequenceDiagram,
  type SequenceMessage,
  type SequenceStep,
  type Timeline,
} from '@memora/shared';

/*
 * What the diagram editor does to a diagram (§9.4), as pure functions on its model: each
 * returns a new model and leaves the old one as it was (the editor's undo keeps them).
 */

const clone = <T>(value: T): T => structuredClone(value);

/**
 * A copy of items to put in a diagram as new ones (duplicated, copied, pasted): without the
 * places they were read from in the code (`origin`), which only the items themselves keep.
 */
export function freshCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const strip = (item: unknown) => {
    if (Array.isArray(item)) item.forEach(strip);
    else if (item && typeof item === 'object') {
      delete (item as { origin?: number }).origin;
      Object.values(item).forEach(strip);
    }
  };
  strip(copy);
  return copy;
}

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

/** A new box before one: it takes the arrows that came in, and leads to the box. */
export function addBefore(chart: Flowchart, of: string): { chart: Flowchart; id: string } {
  const node = chart.nodes.find((n) => n.id === of);
  const added = addNode(chart, { group: node?.group ?? null });
  for (const edge of added.chart.edges) if (edge.to === of) edge.to = added.id;
  added.chart.edges.push(arrow(added.id, of));
  return added;
}

/** An arrow from one box to another, unless there is one already. */
export function connect(chart: Flowchart, from: string, to: string): Flowchart {
  if (from === to || chart.edges.some((e) => e.from === from && e.to === to)) return chart;
  const next = clone(chart);
  next.edges.push(arrow(from, to));
  return next;
}

/** Connects boxes one after the other, in the order given. */
export function connectAll(chart: Flowchart, ids: readonly string[]): Flowchart {
  let next = chart;
  for (let i = 0; i + 1 < ids.length; i += 1) next = connect(next, ids[i]!, ids[i + 1]!);
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

/** Removes boxes but keeps the flow: what led to a box now leads to where it led. */
export function removeNodesKeepFlow(chart: Flowchart, ids: readonly string[]): Flowchart {
  const gone = new Set(ids);
  let next = clone(chart);
  for (const id of ids) {
    const into = next.edges.filter((e) => e.to === id && e.from !== id).map((e) => e.from);
    const out = next.edges.filter((e) => e.from === id && e.to !== id).map((e) => e.to);
    for (const from of into) for (const to of out) next = connect(next, from, to);
  }
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

/** A group and the groups inside it, however deep. */
export function groupTree(chart: Flowchart, id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of chart.groups) {
      if (g.parent && ids.has(g.parent) && !ids.has(g.id)) {
        ids.add(g.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Removes a group with everything in it: its boxes, the groups inside, their arrows. */
export function removeGroup(chart: Flowchart, id: string): Flowchart {
  const groups = groupTree(chart, id);
  const boxes = chart.nodes.filter((n) => n.group && groups.has(n.group)).map((n) => n.id);
  const next = removeNodes(chart, boxes);
  next.groups = next.groups.filter((g) => !groups.has(g.id));
  next.edges = next.edges.filter((e) => !groups.has(e.from) && !groups.has(e.to));
  return next;
}

/** Moves boxes into a group, or out of every group (null). */
export function moveToGroup(chart: Flowchart, ids: readonly string[], group: string | null) {
  const next = clone(chart);
  for (const node of next.nodes) if (ids.includes(node.id)) node.group = group;
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

/** Boxes copied with the arrows between them, for pasting (here or in another diagram). */
export interface FlowClip {
  type: 'flowchart';
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function copyNodes(chart: Flowchart, ids: readonly string[]): FlowClip | null {
  const nodes = chart.nodes.filter((n) => ids.includes(n.id));
  if (!nodes.length) return null;
  const edges = chart.edges.filter((e) => ids.includes(e.from) && ids.includes(e.to));
  return { type: 'flowchart', nodes: freshCopy(nodes), edges: freshCopy(edges) };
}

/** Pastes copied boxes with new ids, into `group` (null: no group). */
export function pasteNodes(
  chart: Flowchart,
  clip: FlowClip,
  group: string | null,
): { chart: Flowchart; ids: string[] } {
  let next = clone(chart);
  const ids = new Map<string, string>();
  for (const node of clip.nodes) {
    const id = freshId(next);
    ids.set(node.id, id);
    next.nodes.push({ ...freshCopy(node), id, group });
  }
  for (const edge of clip.edges) {
    next = clone(next);
    next.edges.push({ ...freshCopy(edge), from: ids.get(edge.from)!, to: ids.get(edge.to)! });
  }
  return { chart: next, ids: [...ids.values()] };
}

/** Copies of boxes (with the arrows between them) beside them, in their group. */
export function duplicateNodes(chart: Flowchart, ids: readonly string[]) {
  const clip = copyNodes(chart, ids);
  if (!clip) return { chart, ids: [] as string[] };
  const group = chart.nodes.find((n) => n.id === ids[0])?.group ?? null;
  return pasteNodes(chart, clip, group);
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

/** A topic before this one, at its level (the first child, for the central topic). */
export function addSiblingTopicBefore(
  map: Mindmap,
  index: number,
): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place) return { map, index };
  const topic = newTopic();
  if (!place.parent) place.topic.children.unshift(topic);
  else place.parent.children.splice(place.at, 0, topic);
  return { map: next, index: indexOf(next, topic) };
}

/** A new topic in this one's place, holding it (not for the central topic). */
export function insertParentTopic(map: Mindmap, index: number): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place?.parent) return { map, index };
  const topic = newTopic();
  topic.children.push(place.topic);
  place.parent.children.splice(place.at, 1, topic);
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

/** Removes a topic; what was under it takes its place. */
export function removeTopicKeepChildren(map: Mindmap, index: number): Mindmap {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place?.parent) return map;
  place.parent.children.splice(place.at, 1, ...place.topic.children);
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

/** Moves a topic to the first or last place among its siblings. */
export function moveTopicToEnd(
  map: Mindmap,
  index: number,
  end: 'first' | 'last',
): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place?.parent) return { map, index };
  const list = place.parent.children;
  list.splice(place.at, 1);
  if (end === 'first') list.unshift(place.topic);
  else list.push(place.topic);
  return { map: next, index: indexOf(next, place.topic) };
}

/** A topic copied with what is under it. */
export interface TopicClip {
  type: 'mindmap';
  topic: MindmapTopic;
}

export function copyTopic(map: Mindmap, index: number): TopicClip | null {
  const place = locate(map.root, index);
  return place ? { type: 'mindmap', topic: freshCopy(place.topic) } : null;
}

/** Pastes a topic (and what is under it) as the last child of another. */
export function pasteTopic(
  map: Mindmap,
  index: number,
  clip: TopicClip,
): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place) return { map, index };
  const topic = freshCopy(clip.topic);
  // A pasted centre keeps its words, not its id.
  topic.id = null;
  place.topic.children.push(topic);
  return { map: next, index: indexOf(next, topic) };
}

/** A copy of a topic and what is under it, after it (not for the central topic). */
export function duplicateTopic(map: Mindmap, index: number): { map: Mindmap; index: number } {
  const next = clone(map);
  const place = locate(next.root, index);
  if (!place?.parent) return { map, index };
  const copy = freshCopy(place.topic);
  copy.id = null;
  place.parent.children.splice(place.at + 1, 0, copy);
  return { map: next, index: indexOf(next, copy) };
}

/** Topics around one, for moving the selection: its parent, first child, siblings. */
export function topicFamily(map: Mindmap, index: number) {
  const place = locate(map.root, index);
  if (!place) return null;
  const siblings = place.parent?.children ?? [place.topic];
  const at = (topic: MindmapTopic | undefined) => (topic ? indexOf(map, topic) : null);
  return {
    parent: at(place.parent ?? undefined),
    firstChild: at(place.topic.children[0]),
    previous: at(siblings[place.at - 1]),
    next: at(siblings[place.at + 1]),
    first: at(siblings[0]),
    last: at(siblings.at(-1)),
  };
}

// Sequence diagrams: a step is found by its path, [step, branch, step, branch, …, step].

export type StepPath = number[];

/** The list of steps at a container path: [] is the diagram, [step, branch, …] a branch. */
function stepsIn(diagram: SequenceDiagram, container: StepPath): SequenceStep[] | null {
  let list = diagram.steps;
  for (let i = 0; i + 1 < container.length; i += 2) {
    const step = list[container[i]!];
    if (step?.kind !== 'block') return null;
    const branch = step.branches[container[i + 1]!];
    if (!branch) return null;
    list = branch.steps;
  }
  return container.length % 2 === 0 ? list : null;
}

/** The list a path's last step is in. */
function listOf(diagram: SequenceDiagram, path: StepPath): SequenceStep[] | null {
  return stepsIn(diagram, path.slice(0, -1));
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

/** A place for a step: in the list at `container`, before the step now at `index`. */
export interface Slot {
  container: StepPath;
  index: number;
}

export function insertAt(
  diagram: SequenceDiagram,
  step: SequenceStep,
  slot: Slot,
): { diagram: SequenceDiagram; path: StepPath } {
  const next = clone(diagram);
  const list = stepsIn(next, slot.container) ?? next.steps;
  const container = list === next.steps ? [] : slot.container;
  const index = Math.max(0, Math.min(slot.index, list.length));
  list.splice(index, 0, step);
  return { diagram: next, path: [...container, index] };
}

/** Inserts a step after `after` (in the same list), or at the end. */
export function insertStep(
  diagram: SequenceDiagram,
  step: SequenceStep,
  after: StepPath | null,
): { diagram: SequenceDiagram; path: StepPath } {
  if (after && listOf(diagram, after)) {
    return insertAt(diagram, step, { container: after.slice(0, -1), index: after.at(-1)! + 1 });
  }
  return insertAt(diagram, step, { container: [], index: diagram.steps.length });
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

/** Removes a step; a block goes with everything in it. */
export function removeStepWhole(diagram: SequenceDiagram, path: StepPath): SequenceDiagram {
  const next = clone(diagram);
  const list = listOf(next, path);
  if (!list?.[path.at(-1)!]) return diagram;
  list.splice(path.at(-1)!, 1);
  return next;
}

/** Takes a step out (the paths of the steps after it in its list shift up). */
function takeStep(diagram: SequenceDiagram, path: StepPath): SequenceStep | null {
  const list = listOf(diagram, path);
  const at = path.at(-1)!;
  if (!list?.[at]) return null;
  return list.splice(at, 1)[0]!;
}

/**
 * Moves a step one place up or down through the diagram as it reads: into a block it meets
 * (as its first or last step), from one branch to the next, and out of a block at its ends.
 */
export function moveStep(
  diagram: SequenceDiagram,
  path: StepPath,
  delta: -1 | 1,
): { diagram: SequenceDiagram; path: StepPath } {
  const next = clone(diagram);
  const container = path.slice(0, -1);
  const at = path.at(-1)!;
  const step = takeStep(next, path);
  const list = stepsIn(next, container);
  if (!step || !list) return { diagram, path };
  let slot: Slot | null = null;
  if (delta === 1) {
    const neighbour = list[at];
    if (neighbour?.kind === 'block') slot = { container: [...container, at, 0], index: 0 };
    else if (neighbour) slot = { container, index: at + 1 };
    else if (container.length) {
      const outer = container.slice(0, -2);
      const blockAt = container.at(-2)!;
      const branch = container.at(-1)!;
      const block = stepsIn(next, outer)![blockAt] as SequenceBlock;
      slot =
        branch + 1 < block.branches.length
          ? { container: [...outer, blockAt, branch + 1], index: 0 }
          : { container: outer, index: blockAt + 1 };
    }
  } else {
    const neighbour = list[at - 1];
    if (neighbour?.kind === 'block') {
      const last = neighbour.branches.length - 1;
      slot = {
        container: [...container, at - 1, last],
        index: neighbour.branches[last]!.steps.length,
      };
    } else if (neighbour) slot = { container, index: at - 1 };
    else if (container.length) {
      const outer = container.slice(0, -2);
      const blockAt = container.at(-2)!;
      const branch = container.at(-1)!;
      const block = stepsIn(next, outer)![blockAt] as SequenceBlock;
      slot =
        branch > 0
          ? {
              container: [...outer, blockAt, branch - 1],
              index: block.branches[branch - 1]!.steps.length,
            }
          : { container: outer, index: blockAt };
    }
  }
  if (!slot) return { diagram, path };
  const list2 = stepsIn(next, slot.container)!;
  list2.splice(slot.index, 0, step);
  return { diagram: next, path: [...slot.container, slot.index] };
}

/** Moves a step into the block just before it, as that block's last step. */
export function indentStep(
  diagram: SequenceDiagram,
  path: StepPath,
): { diagram: SequenceDiagram; path: StepPath } {
  const before = stepAt(diagram, [...path.slice(0, -1), path.at(-1)! - 1]);
  if (before?.kind !== 'block') return { diagram, path };
  return moveStep(diagram, path, -1);
}

/** Moves a step out of its block, to just after it. */
export function outdentStep(
  diagram: SequenceDiagram,
  path: StepPath,
): { diagram: SequenceDiagram; path: StepPath } {
  if (path.length < 3) return { diagram, path };
  const next = clone(diagram);
  const step = takeStep(next, path);
  if (!step) return { diagram, path };
  const outer = path.slice(0, -3);
  const blockAt = path.at(-3)!;
  const list = stepsIn(next, outer)!;
  list.splice(blockAt + 1, 0, step);
  return { diagram: next, path: [...outer, blockAt + 1] };
}

/** Moves a step to a slot (dragging a row); the slot is where it would be before the move. */
export function moveStepTo(
  diagram: SequenceDiagram,
  path: StepPath,
  slot: Slot,
): { diagram: SequenceDiagram; path: StepPath } {
  // Not into itself.
  if (slot.container.length >= path.length && path.every((n, i) => slot.container[i] === n)) {
    return { diagram, path };
  }
  const next = clone(diagram);
  const target = stepsIn(next, slot.container);
  const step = stepAt(next, path);
  if (!target || !step) return { diagram, path };
  // Mark the place, take the step out, then insert at the mark.
  const mark: SequenceStep = { kind: 'raw', text: '' };
  target.splice(slot.index, 0, mark);
  const list = listOf(next, path)!;
  list.splice(list.indexOf(step), 1);
  const found = findStep(next, mark)!;
  const holder = listOf(next, found)!;
  holder.splice(found.at(-1)!, 1, step);
  return { diagram: next, path: found };
}

function findStep(diagram: SequenceDiagram, wanted: SequenceStep): StepPath | null {
  const walk = (list: SequenceStep[], base: StepPath): StepPath | null => {
    for (let i = 0; i < list.length; i += 1) {
      const step = list[i]!;
      if (step === wanted) return [...base, i];
      if (step.kind === 'block') {
        for (let b = 0; b < step.branches.length; b += 1) {
          const found = walk(step.branches[b]!.steps, [...base, i, b]);
          if (found) return found;
        }
      }
    }
    return null;
  };
  return walk(diagram.steps, []);
}

/** Puts a step inside a new block of its own (a loop, by default). */
export function wrapInBlock(
  diagram: SequenceDiagram,
  path: StepPath,
  block: SequenceBlockKind = 'loop',
  text = BLOCK_TEXT[block],
): { diagram: SequenceDiagram; path: StepPath } {
  const next = clone(diagram);
  const list = listOf(next, path);
  const at = path.at(-1)!;
  const step = list?.[at];
  if (!list || !step) return { diagram, path };
  list[at] = { kind: 'block', block, branches: [{ text, steps: [step] }] };
  return { diagram: next, path };
}

/** The words a new block starts with. */
export const BLOCK_TEXT: Record<SequenceBlockKind, string> = {
  loop: 'Every time',
  alt: 'If so',
  opt: 'If needed',
  par: 'At the same time',
  critical: 'Must happen',
  break: 'When it fails',
  rect: 'rgb(200, 220, 255)',
};

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

/** Moves a participant one place left (-1) or right (1). */
export function moveParticipant(diagram: SequenceDiagram, id: string, delta: -1 | 1) {
  const at = diagram.participants.findIndex((p) => p.id === id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= diagram.participants.length) return diagram;
  const next = clone(diagram);
  const list = next.participants;
  [list[at], list[to]] = [list[to]!, list[at]!];
  return next;
}

/** Adds a participant after `after` (or last), named "Participant n". */
export function addParticipant(
  diagram: SequenceDiagram,
  after: string | null,
): { diagram: SequenceDiagram; id: string } {
  const next = clone(diagram);
  const id = freshParticipant(next);
  const at = after ? next.participants.findIndex((p) => p.id === after) : -1;
  const participant = {
    id,
    label: `Participant ${next.participants.length + 1}`,
    kind: 'participant' as const,
  };
  if (at >= 0) next.participants.splice(at + 1, 0, participant);
  else next.participants.push(participant);
  return { diagram: next, id };
}

/** A new message: like the one given (its ends), or from one participant to the next. */
export function newMessage(
  diagram: SequenceDiagram,
  like: SequenceStep | null,
  from?: string,
): SequenceMessage {
  const ids = diagram.participants.map((p) => p.id);
  let a = ids[0] ?? 'A';
  let b = ids[1] ?? a;
  if (like?.kind === 'message') {
    a = like.from;
    b = like.to;
  } else if (from) {
    const at = ids.indexOf(from);
    a = from;
    b = ids[at + 1] ?? ids[at - 1] ?? from;
  }
  return { kind: 'message', from: a, to: b, arrow: '->>', text: 'Message', activation: null };
}

/** The answer to a message: the other way, dashed. */
export function replyTo(message: SequenceMessage): SequenceMessage {
  return {
    kind: 'message',
    from: message.to,
    to: message.from,
    arrow: '-->>',
    text: 'Reply',
    activation: null,
  };
}

/** A note over a message's two ends (or one). */
export function noteFor(step: SequenceStep | null, diagram: SequenceDiagram): SequenceStep {
  const first = diagram.participants[0]?.id ?? 'A';
  if (step?.kind === 'message') {
    return {
      kind: 'note',
      side: 'over',
      of: step.from === step.to ? [step.from] : [step.from, step.to],
      text: 'Note',
    };
  }
  return { kind: 'note', side: 'over', of: [first], text: 'Note' };
}

/** A copy of a step after it. */
export function duplicateStep(
  diagram: SequenceDiagram,
  path: StepPath,
): { diagram: SequenceDiagram; path: StepPath } {
  const step = stepAt(diagram, path);
  if (!step) return { diagram, path };
  return insertStep(diagram, freshCopy(step), path);
}

export interface StepClip {
  type: 'sequence';
  step: SequenceStep;
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

/** Steps as they read, for the arrow keys: every step, blocks included, depth first. */
export function stepOrder(diagram: SequenceDiagram): StepPath[] {
  return stepRows(diagram)
    .filter((r) => r.kind === 'step')
    .map((r) => r.path);
}

export const samePath = (a: StepPath | null, b: StepPath | null) =>
  !!a && !!b && a.length === b.length && a.every((n, i) => n === b[i]);

export type { SequenceBlock };

// Lists: timelines, Gantt charts and pie charts.

function swap<T>(list: T[], at: number, to: number): boolean {
  if (at < 0 || to < 0 || at >= list.length || to >= list.length) return false;
  [list[at], list[to]] = [list[to]!, list[at]!];
  return true;
}

/**
 * Moves an item of a list of sections one place up or down; past the end of its section, it
 * moves to the next section (or the previous). Returns its new place, or null when it can't.
 */
function moveAcross<T>(
  sections: { items: T[] }[],
  section: number,
  at: number,
  delta: -1 | 1,
): { section: number; at: number } | null {
  const list = sections[section]?.items;
  if (!list || at < 0 || at >= list.length) return null;
  if (swap(list, at, at + delta)) return { section, at: at + delta };
  const other = sections[section + delta];
  if (!other) return null;
  const [item] = list.splice(at, 1);
  if (delta === 1) {
    other.items.unshift(item!);
    return { section: section + 1, at: 0 };
  }
  other.items.push(item!);
  return { section: section - 1, at: other.items.length - 1 };
}

export const NEW_PERIOD = 'When';
export const NEW_EVENT = 'What happens';

/** A new period after (or before) one, in its section. */
export function addPeriod(
  model: Timeline,
  section: number,
  at: number,
  where: 'before' | 'after' | 'end' = 'after',
): { model: Timeline; section: number; period: number } {
  const next = clone(model);
  if (!next.sections.length) next.sections.push({ label: null, periods: [] });
  const s = Math.min(section, next.sections.length - 1);
  const list = next.sections[s]!.periods;
  const index = where === 'end' ? list.length : where === 'after' ? at + 1 : at;
  list.splice(index, 0, { label: NEW_PERIOD, events: [NEW_EVENT] });
  return { model: next, section: s, period: index };
}

export function addEvent(
  model: Timeline,
  section: number,
  period: number,
  at: number,
  where: 'before' | 'after' | 'end' = 'after',
): { model: Timeline; event: number } {
  const next = clone(model);
  const p = next.sections[section]?.periods[period];
  if (!p) return { model, event: at };
  const index = where === 'end' ? p.events.length : where === 'after' ? at + 1 : at;
  p.events.splice(index, 0, 'Event');
  return { model: next, event: index };
}

export function addTimelineSection(model: Timeline, after: number | null) {
  const next = clone(model);
  const named = next.sections.filter((x) => x.label !== null).length;
  const index = after === null ? next.sections.length : after + 1;
  next.sections.splice(index, 0, {
    label: `Section ${named + 1}`,
    periods: [{ label: NEW_PERIOD, events: [NEW_EVENT] }],
  });
  return { model: next, section: index };
}

export function movePeriod(model: Timeline, section: number, period: number, delta: -1 | 1) {
  const next = clone(model);
  const moved = moveAcross(
    next.sections.map((s) => ({ items: s.periods })),
    section,
    period,
    delta,
  );
  return moved ? { model: next, section: moved.section, period: moved.at } : null;
}

export function moveEvent(
  model: Timeline,
  section: number,
  period: number,
  event: number,
  delta: -1 | 1,
) {
  const next = clone(model);
  const events = next.sections[section]?.periods[period]?.events;
  return events && swap(events, event, event + delta)
    ? { model: next, event: event + delta }
    : null;
}

/** Moves a named section; the periods before any section stay first. */
export function moveSection<M extends Timeline | Gantt>(model: M, section: number, delta: -1 | 1) {
  const to = section + delta;
  if (model.sections[to]?.label === null || model.sections[section]?.label === null) return null;
  const next = clone(model);
  return swap(next.sections as unknown[], section, to) ? { model: next, section: to } : null;
}

export function removePeriod(model: Timeline, section: number, period: number): Timeline {
  const next = clone(model);
  next.sections[section]?.periods.splice(period, 1);
  return next;
}

export function removeEvent(model: Timeline, section: number, period: number, event: number) {
  const next = clone(model);
  next.sections[section]?.periods[period]?.events.splice(event, 1);
  return next;
}

/** Removes a section; its periods (or tasks) join the section before it, or the one after. */
export function removeSectionKeep<M extends Timeline | Gantt>(model: M, section: number): M {
  const next = clone(model) as Timeline | Gantt;
  if (next.type === 'timeline') {
    const [gone] = next.sections.splice(section, 1);
    const into = next.sections[section - 1] ?? next.sections[section];
    if (gone && into) {
      if (into === next.sections[section - 1]) into.periods.push(...gone.periods);
      else into.periods.unshift(...gone.periods);
    }
  } else {
    const [gone] = next.sections.splice(section, 1);
    const into = next.sections[section - 1] ?? next.sections[section];
    if (gone && into) {
      if (into === next.sections[section - 1]) into.tasks.push(...gone.tasks);
      else into.tasks.unshift(...gone.tasks);
    }
  }
  return next as M;
}

/** Removes a section with what it holds. */
export function removeSectionWhole<M extends Timeline | Gantt>(model: M, section: number): M {
  const next = clone(model) as Timeline | Gantt;
  if (next.type === 'gantt') {
    for (const task of next.sections[section]?.tasks ?? []) {
      if (task.id) detachTask(next, task.id);
    }
  }
  next.sections.splice(section, 1);
  return next as M;
}

export const NEW_TASK = 'New task';
const today = () => new Date().toISOString().slice(0, 10);

/** A new task after (or before) one, starting after the task above it. */
export function addTask(
  model: Gantt,
  section: number,
  at: number,
  where: 'before' | 'after' | 'end' = 'after',
): { model: Gantt; section: number; task: number } {
  const next = clone(model);
  if (!next.sections.length) next.sections.push({ label: null, tasks: [] });
  const s = Math.min(Math.max(section, 0), next.sections.length - 1);
  const list = next.sections[s]!.tasks;
  const index = where === 'end' ? list.length : where === 'after' ? at + 1 : at;
  const first = !next.sections.some((x) => x.tasks.length);
  const task: GanttTask = {
    name: NEW_TASK,
    tags: [],
    id: null,
    start:
      first || (s === 0 && index === 0) ? { kind: 'date', value: today() } : { kind: 'previous' },
    end: { kind: 'duration', value: '3d' },
  };
  list.splice(index, 0, task);
  return { model: next, section: s, task: index };
}

export function addGanttSection(model: Gantt, after: number | null) {
  const next = clone(model);
  const named = next.sections.filter((x) => x.label !== null).length;
  const index = after === null ? next.sections.length : after + 1;
  next.sections.splice(index, 0, {
    label: `Section ${named + 1}`,
    tasks: [
      {
        name: NEW_TASK,
        tags: [],
        id: null,
        start: next.sections.some((x) => x.tasks.length)
          ? { kind: 'previous' }
          : { kind: 'date', value: today() },
        end: { kind: 'duration', value: '3d' },
      },
    ],
  });
  return { model: next, section: index };
}

export function moveTask(model: Gantt, section: number, task: number, delta: -1 | 1) {
  const next = clone(model);
  const moved = moveAcross(
    next.sections.map((s) => ({ items: s.tasks })),
    section,
    task,
    delta,
  );
  return moved ? { model: next, section: moved.section, task: moved.at } : null;
}

/**
 * Lets other tasks stop depending on one that is going: those that started after it start
 * where it started, those that lasted until it end where it ended.
 */
function detachTask(gantt: Gantt, id: string) {
  const all = gantt.sections.flatMap((s) => s.tasks);
  const gone = all.find((t) => t.id === id);
  if (!gone) return;
  for (const task of all) {
    if (task === gone) continue;
    if (task.start.kind === 'after' && task.start.ids.includes(id)) {
      const rest = task.start.ids.filter((x) => x !== id);
      task.start = rest.length ? { kind: 'after', ids: rest } : clone(gone.start);
    }
    if (task.end.kind === 'until' && task.end.ids.includes(id)) {
      const rest = task.end.ids.filter((x) => x !== id);
      task.end = rest.length ? { kind: 'until', ids: rest } : { kind: 'duration', value: '1d' };
    }
  }
}

export function removeTask(model: Gantt, section: number, task: number): Gantt {
  const next = clone(model);
  const target = next.sections[section]?.tasks[task];
  if (!target) return model;
  if (target.id) detachTask(next, target.id);
  next.sections[section]!.tasks.splice(task, 1);
  return next;
}

export function duplicateTask(model: Gantt, section: number, task: number) {
  const next = clone(model);
  const list = next.sections[section]?.tasks;
  const source = list?.[task];
  if (!list || !source) return null;
  // Ids are unique: the copy has none (nothing depends on it yet).
  list.splice(task + 1, 0, { ...freshCopy(source), id: null });
  return { model: next, section, task: task + 1 };
}

/** An id for a task others can start after (made up when it has none). */
export function taskId(gantt: Gantt, task: GanttTask): string {
  if (task.id) return task.id;
  const used = new Set(gantt.sections.flatMap((s) => s.tasks.map((t) => t.id)).filter(Boolean));
  let i = 1;
  while (used.has(`t${i}`)) i += 1;
  task.id = `t${i}`;
  return task.id;
}

export function addSlice(model: Pie, at: number | null, where: 'before' | 'after' = 'after') {
  const next = clone(model);
  const index = at === null ? next.slices.length : where === 'after' ? at + 1 : at;
  next.slices.splice(index, 0, { label: `Slice ${next.slices.length + 1}`, value: 10 });
  return { model: next, index };
}

export function moveSlice(model: Pie, index: number, delta: -1 | 1) {
  const next = clone(model);
  return swap(next.slices, index, index + delta) ? { model: next, index: index + delta } : null;
}

export function removeSlice(model: Pie, index: number): Pie {
  const next = clone(model);
  next.slices.splice(index, 1);
  return next;
}

export function duplicateSlice(model: Pie, index: number) {
  const next = clone(model);
  const source = next.slices[index];
  if (!source) return null;
  next.slices.splice(index + 1, 0, freshCopy(source));
  return { model: next, index: index + 1 };
}

export function duplicatePeriod(model: Timeline, section: number, period: number) {
  const next = clone(model);
  const list = next.sections[section]?.periods;
  const source = list?.[period];
  if (!list || !source) return null;
  list.splice(period + 1, 0, freshCopy(source));
  return { model: next, section, period: period + 1 };
}
