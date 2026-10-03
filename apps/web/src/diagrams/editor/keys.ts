import {
  DIAGRAM_COLOURS,
  FLOW_SHAPES,
  MINDMAP_SHAPES,
  mindmapTopics,
  type DiagramModel,
  type Flowchart,
  type Gantt,
  type Mindmap,
  type Pie,
  type SequenceDiagram,
  type Timeline,
} from '@memora/shared';
import { itemToward, type HitMap } from './hits';
import { textOf } from './labels';
import {
  addBefore,
  addChildTopic,
  addEvent,
  addNode,
  addParticipant,
  addPeriod,
  addSibling,
  addSiblingTopic,
  addSiblingTopicBefore,
  addSlice,
  addTask,
  connectAll,
  copyNodes,
  copyTopic,
  duplicateNodes,
  duplicatePeriod,
  duplicateSlice,
  duplicateStep,
  duplicateTask,
  duplicateTopic,
  freshCopy,
  groupNodes,
  indentStep,
  indentTopic,
  insertAt,
  insertParentTopic,
  moveEvent,
  moveParticipant,
  movePeriod,
  moveSection,
  moveSlice,
  moveStep,
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
  removeEdge,
  removeEvent,
  removeGroup,
  removeNodes,
  removeNodesKeepFlow,
  removeParticipant,
  removePeriod,
  removeSectionKeep,
  removeSectionWhole,
  removeSlice,
  removeStep,
  removeStepWhole,
  removeTask,
  removeTopic,
  removeTopicKeepChildren,
  replyTo,
  stepAt,
  stepOrder,
  topicFamily,
  ungroup,
  updateNode,
  updateTopic,
  wrapInBlock,
  type FlowClip,
  type Slot,
  type StepClip,
  type StepPath,
  type TopicClip,
} from './ops';
import {
  itemsOf,
  selectionOf,
  singleItem,
  type Item,
  type Selectable,
  type Selection,
} from './selection';

/*
 * The diagram editor's keys (§9.4), after MindManager's where they fit: Enter adds the next
 * item at the same level, Shift+Enter one before it, Tab (or Insert) one under it, F2, Space
 * or simply typing edits its words, Delete removes it, the arrows move the selection, Alt and
 * the arrows move the item. Each key is a pure action on the model and the selection, so the
 * editor applies it as one step of its history, and Tab while editing words can keep them and
 * go on in that same step.
 */

export interface EditStart {
  item: Item;
  /** Typed to start: replaces the words. */
  typed?: string;
  caretAtEnd?: boolean;
  /** Where a new item comes from, to place the field until it is drawn. */
  anchor?: Item | null;
}

export interface Outcome {
  model?: DiagramModel;
  select?: Selectable;
  edit?: EditStart;
  announce?: string;
}

export interface KeyLike {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

type Clip = FlowClip | TopicClip | StepClip;
/** What was copied, kept while the app is open: it pastes into another diagram too. */
let clipboard: Clip | null = null;
export const clipboardHolds = (type: Clip['type']) => clipboard?.type === type;

/** Adds something new and starts editing its words. */
const added = (
  model: DiagramModel,
  item: Item,
  announce: string,
  anchor: Item | null = null,
): Outcome => ({ model, select: selectionOf(item), edit: { item, anchor }, announce });

const DIRECTIONS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
} as const;

/** A character typed to start editing: printable, without Ctrl, ⌘ or Alt; not `?` (help). */
export const typesText = (e: KeyLike) =>
  e.key.length === 1 && e.key !== ' ' && e.key !== '?' && !e.ctrlKey && !e.metaKey && !e.altKey;

/** What a key does on the canvas; null when it does nothing there. */
export function keyAction(
  e: KeyLike,
  model: DiagramModel,
  selection: Selection,
  map: HitMap,
): Outcome | null {
  const mod = e.ctrlKey || e.metaKey;
  const plain = !mod && !e.altKey && !e.shiftKey;
  const item = singleItem(selection);

  // Editing words: F2, Space (the cursor at the end), or typing (it replaces them).
  if (item && textOf(model, item)) {
    if (e.key === 'F2' && plain) return { edit: { item } };
    if (e.key === ' ' && plain) return { edit: { item, caretAtEnd: true } };
    if (typesText(e)) return { edit: { item, typed: e.key } };
  }

  switch (model.type) {
    case 'flowchart':
      return flowchartKey(e, model, selection, map);
    case 'mindmap':
      return mindmapKey(e, model, selection, map);
    case 'sequence':
      return sequenceKey(e, model, selection);
    case 'timeline':
      return timelineKey(e, model, selection, map);
    case 'gantt':
      return ganttKey(e, model, selection, map);
    case 'pie':
      return pieKey(e, model, selection);
  }
}

// Flowcharts

function flowchartKey(
  e: KeyLike,
  chart: Flowchart,
  selection: Selection,
  map: HitMap,
): Outcome | null {
  const mod = e.ctrlKey || e.metaKey;
  const ids = selection?.kind === 'nodes' ? selection.ids : [];
  const one = ids.length === 1 ? ids[0]! : null;
  const group = selection?.kind === 'group' ? selection.id : null;
  const edge = selection?.kind === 'edge' ? selection.index : null;
  const direction = DIRECTIONS[e.key as keyof typeof DIRECTIONS];

  if (direction && !mod && !e.altKey) {
    const from =
      singleItem(selection) ?? (ids.length ? { kind: 'node' as const, id: ids.at(-1)! } : null);
    if (!from) {
      const first = chart.nodes[0];
      return first ? { select: { kind: 'nodes', ids: [first.id] } } : null;
    }
    const to = itemToward(map, from, direction, (i) => i.kind === 'node');
    if (!to || to.kind !== 'node') return {};
    if (e.shiftKey && ids.length) {
      return { select: { kind: 'nodes', ids: [...ids.filter((i) => i !== to.id), to.id] } };
    }
    return { select: { kind: 'nodes', ids: [to.id] }, announce: textOf(chart, to)?.text };
  }
  if (e.key === 'Home' || e.key === 'End') {
    const node = e.key === 'Home' ? chart.nodes[0] : chart.nodes.at(-1);
    return node ? { select: { kind: 'nodes', ids: [node.id] } } : null;
  }

  if (e.key === 'Enter' && !mod && !e.altKey) {
    if (one && e.shiftKey) {
      const next = addSibling(chart, one);
      return added(next.chart, { kind: 'node', id: next.id }, 'Added a box beside it', {
        kind: 'node',
        id: one,
      });
    }
    if (!e.shiftKey) {
      const item = singleItem(selection);
      if (item && textOf(chart, item)) return { edit: { item } };
    }
    return null;
  }
  if (e.key === 'Enter' && mod && e.shiftKey && one) {
    const next = addBefore(chart, one);
    return added(next.chart, { kind: 'node', id: next.id }, 'Added a box before it', {
      kind: 'node',
      id: one,
    });
  }
  if ((e.key === 'Tab' && !e.shiftKey && !mod) || (e.key === 'Insert' && !mod && !e.shiftKey)) {
    if (one) {
      const next = addNode(chart, { from: one });
      return added(next.chart, { kind: 'node', id: next.id }, 'Added a connected box', {
        kind: 'node',
        id: one,
      });
    }
    if (group) {
      const next = addNode(chart, { group });
      return added(next.chart, { kind: 'node', id: next.id }, 'Added a box in the group', {
        kind: 'group',
        id: group,
      });
    }
    if (e.key === 'Insert') {
      const next = addNode(chart, { group: null });
      return added(next.chart, { kind: 'node', id: next.id }, 'Added a box');
    }
    return null;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const keep = mod && e.shiftKey;
    if (ids.length) {
      return {
        model: keep ? removeNodesKeepFlow(chart, ids) : removeNodes(chart, ids),
        select: null,
        announce:
          (ids.length === 1 ? 'Deleted the box' : `Deleted ${ids.length} boxes`) +
          (keep ? ', keeping the flow' : ''),
      };
    }
    if (edge !== null) {
      return { model: removeEdge(chart, edge), select: null, announce: 'Deleted the arrow' };
    }
    if (group) {
      return keep
        ? {
            model: ungroup(chart, group),
            select: null,
            announce: 'Removed the group; its boxes stay',
          }
        : {
            model: removeGroup(chart, group),
            select: null,
            announce: 'Deleted the group and what was in it',
          };
    }
    return null;
  }

  if (mod && !e.altKey) {
    switch (e.code) {
      case 'KeyA':
        if (e.shiftKey) return null;
        return { select: { kind: 'nodes', ids: chart.nodes.map((n) => n.id) } };
      case 'KeyD':
        if (!ids.length) return null;
        {
          const copy = duplicateNodes(chart, ids);
          return {
            model: copy.chart,
            select: { kind: 'nodes', ids: copy.ids },
            announce: 'Duplicated',
          };
        }
      case 'KeyC':
      case 'KeyX': {
        const clip = copyNodes(chart, ids);
        if (!clip) return null;
        clipboard = clip;
        if (e.code === 'KeyC') return { announce: 'Copied' };
        return { model: removeNodes(chart, ids), select: null, announce: 'Cut' };
      }
      case 'KeyV': {
        if (clipboard?.type !== 'flowchart') return null;
        const into = group ?? chart.nodes.find((n) => n.id === one)?.group ?? null;
        const pasted = pasteNodes(chart, clipboard, into);
        return {
          model: pasted.chart,
          select: { kind: 'nodes', ids: pasted.ids },
          announce: 'Pasted',
        };
      }
      case 'KeyG':
        if (e.shiftKey) {
          if (group) return { model: ungroup(chart, group), select: null, announce: 'Ungrouped' };
          if (ids.length) {
            return { model: moveToGroup(chart, ids, null), announce: 'Taken out of the group' };
          }
          return null;
        }
        if (!ids.length) return null;
        {
          const grouped = groupNodes(chart, ids);
          return added(grouped.chart, { kind: 'group', id: grouped.id }, 'Grouped the boxes');
        }
      case 'KeyK':
        if (ids.length < 2 || e.shiftKey) return null;
        return { model: connectAll(chart, ids), announce: 'Connected the boxes in order' };
    }
    // Mod+1…9: the selected boxes' shape.
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && ids.length && !e.shiftKey) {
      const shape = FLOW_SHAPES[Number(digit[1]) - 1]!;
      let next = chart;
      for (const id of ids) next = updateNode(next, id, { shape });
      return { model: next };
    }
  }
  // Alt+0…8: their colour (0: none).
  const colourKey = /^Digit([0-8])$/.exec(e.code);
  if (colourKey && e.altKey && !mod && !e.shiftKey && ids.length) {
    const n = Number(colourKey[1]);
    const colour = n === 0 ? null : DIAGRAM_COLOURS[n - 1]!;
    let next = chart;
    for (const id of ids) next = updateNode(next, id, { colour });
    return { model: next };
  }
  return null;
}

// Mind maps

function mindmapKey(e: KeyLike, map: Mindmap, selection: Selection, hits: HitMap): Outcome | null {
  const mod = e.ctrlKey || e.metaKey;
  const index = selection?.kind === 'topic' ? selection.index : null;
  const topic = (i: number) => ({ kind: 'topic' as const, index: i });
  const direction = DIRECTIONS[e.key as keyof typeof DIRECTIONS];

  if (index === null) {
    if (direction || e.key === 'Home' || e.key === 'Enter') return { select: topic(0) };
    return null;
  }
  const family = topicFamily(map, index);
  const go = (i: number | null | undefined) =>
    i === null || i === undefined ? {} : { select: topic(i) };

  if (direction && !mod && !e.altKey && !e.shiftKey) {
    const to = itemToward(hits, topic(index), direction);
    return to?.kind === 'topic' ? { select: to } : {};
  }
  if (e.key === 'Home' && mod) return go(0);
  if (e.key === 'Home' && !e.altKey && !e.shiftKey) return go(family?.first);
  if (e.key === 'End' && !mod && !e.altKey && !e.shiftKey) return go(family?.last);
  if (e.key === 'Backspace' && mod && !e.shiftKey) return go(family?.parent);

  const result = (r: { map: Mindmap; index: number }, announce?: string) =>
    r.map === map ? {} : { model: r.map, select: topic(r.index), announce };
  const add = (r: { map: Mindmap; index: number }, announce: string) =>
    r.map === map ? {} : added(r.map, topic(r.index), announce, topic(index));

  if (e.key === 'Enter' && !e.altKey) {
    if (mod && e.shiftKey) return add(insertParentTopic(map, index), 'Added a topic above it');
    if (mod) return null;
    return e.shiftKey
      ? add(addSiblingTopicBefore(map, index), 'Added a topic before it')
      : add(addSiblingTopic(map, index), 'Added a topic');
  }
  if ((e.key === 'Tab' || e.key === 'Insert') && !e.shiftKey && !mod && !e.altKey) {
    return add(addChildTopic(map, index), 'Added a topic under it');
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (index === 0) return {};
    const keep = mod && e.shiftKey;
    const next = keep ? removeTopicKeepChildren(map, index) : removeTopic(map, index);
    return {
      model: next,
      select: topic(Math.max(0, family?.previous ?? family?.parent ?? 0)),
      announce: keep ? 'Removed the topic; what was under it stays' : 'Removed the topic',
    };
  }
  if (e.altKey && !mod) {
    if (e.shiftKey && e.key === 'ArrowRight')
      return result(indentTopic(map, index), 'Moved in a level');
    if (e.shiftKey && e.key === 'ArrowLeft')
      return result(outdentTopic(map, index), 'Moved out a level');
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      return result(moveTopicToEnd(map, index, e.key === 'ArrowUp' ? 'first' : 'last'));
    }
    if (!e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      return result(moveTopic(map, index, e.key === 'ArrowUp' ? -1 : 1));
    }
  }
  if (mod && !e.altKey) {
    switch (e.code) {
      case 'KeyD':
        return result(duplicateTopic(map, index), 'Duplicated');
      case 'KeyC':
      case 'KeyX': {
        const clip = copyTopic(map, index);
        if (!clip) return null;
        clipboard = clip;
        if (e.code === 'KeyC' || index === 0) return { announce: 'Copied' };
        return {
          model: removeTopic(map, index),
          select: topic(family?.parent ?? 0),
          announce: 'Cut',
        };
      }
      case 'KeyV':
        if (clipboard?.type !== 'mindmap') return null;
        return result(pasteTopic(map, index, clipboard), 'Pasted under it');
    }
    const digit = /^Digit([1-7])$/.exec(e.code);
    if (digit && !e.shiftKey) {
      const shape = MINDMAP_SHAPES[Number(digit[1]) - 1];
      if (shape) return { model: updateTopic(map, index, { shape }) };
    }
  }
  return null;
}

// Sequence diagrams

/** Where a new step goes for a selection: after a step, inside a block or a branch, or last. */
function slotFor(diagram: SequenceDiagram, selection: Selection, before = false): Slot {
  if (selection?.kind === 'step') {
    const step = stepAt(diagram, selection.path);
    const container = selection.path.slice(0, -1);
    const at = selection.path.at(-1)!;
    if (before) return { container, index: at };
    // A selected block takes the new step inside, at the end of its first branch.
    if (step?.kind === 'block') {
      return { container: [...selection.path, 0], index: step.branches[0]!.steps.length };
    }
    return { container, index: at + 1 };
  }
  if (selection?.kind === 'branch') {
    const step = stepAt(diagram, selection.path);
    const steps = step?.kind === 'block' ? step.branches[selection.branch]?.steps : undefined;
    return {
      container: [...selection.path, selection.branch],
      index: before ? 0 : (steps?.length ?? 0),
    };
  }
  return { container: [], index: before ? 0 : diagram.steps.length };
}

function sequenceKey(e: KeyLike, diagram: SequenceDiagram, selection: Selection): Outcome | null {
  const mod = e.ctrlKey || e.metaKey;
  const step = selection?.kind === 'step' ? stepAt(diagram, selection.path) : null;
  const path = selection?.kind === 'step' ? selection.path : null;
  const participant = selection?.kind === 'participant' ? selection.id : null;
  const order = stepOrder(diagram);
  const ids = diagram.participants.map((p) => p.id);
  const stepItem = (p: StepPath): Item => ({ kind: 'step', path: p });
  const moved = (r: { diagram: SequenceDiagram; path: StepPath }, announce?: string) =>
    r.diagram === diagram ? {} : { model: r.diagram, select: stepItem(r.path), announce };

  // Moving the selection: steps up and down as they read, participants left and right.
  if (!mod && !e.altKey && !e.shiftKey) {
    const at = path ? order.findIndex((p) => p.join() === path.join()) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (participant || !selection) {
        if (e.key === 'ArrowDown' && order[0]) return { select: stepItem(order[0]) };
        if (e.key === 'ArrowUp' && diagram.title) return { select: { kind: 'title' } };
        return participant ? {} : ids[0] ? { select: { kind: 'participant', id: ids[0] } } : null;
      }
      if (selection.kind === 'title') {
        return e.key === 'ArrowDown' && ids[0]
          ? { select: { kind: 'participant', id: ids[0] } }
          : {};
      }
      if (selection.kind === 'branch') {
        const rowOf = order.findIndex((p) => p.join() === selection.path.join());
        const next = order[rowOf + (e.key === 'ArrowDown' ? 1 : 0)];
        return next ? { select: stepItem(next) } : {};
      }
      const next = order[at + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) return { select: stepItem(next) };
      if (e.key === 'ArrowUp' && ids[0]) return { select: { kind: 'participant', id: ids[0] } };
      return {};
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const from = participant ?? (step?.kind === 'message' ? step.from : null) ?? ids[0];
      if (!from) return null;
      const i = ids.indexOf(from) + (participant ? (e.key === 'ArrowLeft' ? -1 : 1) : 0);
      const to = ids[Math.max(0, Math.min(ids.length - 1, i))];
      return to ? { select: { kind: 'participant', id: to } } : null;
    }
    if (e.key === 'Home' && order[0]) return { select: stepItem(order[0]) };
    if (e.key === 'End' && order.at(-1)) return { select: stepItem(order.at(-1)!) };
  }
  if (e.key === 'Backspace' && mod && !e.shiftKey && path && path.length > 1) {
    return { select: stepItem(path.slice(0, -2)) };
  }

  // Adding.
  if (e.key === 'Enter' && !mod && !e.altKey) {
    if (participant && !e.shiftKey) {
      const message = newMessage(diagram, null, participant);
      const r = insertAt(diagram, message, { container: [], index: diagram.steps.length });
      return added(r.diagram, stepItem(r.path), 'Added a message');
    }
    if (selection?.kind === 'title' || participant) return null;
    const like = step?.kind === 'message' ? step : null;
    const r = insertAt(diagram, newMessage(diagram, like), slotFor(diagram, selection, e.shiftKey));
    return added(
      r.diagram,
      stepItem(r.path),
      e.shiftKey ? 'Added a message before it' : 'Added a message',
      path ? stepItem(path) : null,
    );
  }
  if (e.key === 'Enter' && e.altKey && !mod) {
    const r = insertAt(diagram, noteFor(step, diagram), slotFor(diagram, selection));
    return added(r.diagram, stepItem(r.path), 'Added a note', path ? stepItem(path) : null);
  }
  if (e.key === 'Enter' && mod && e.shiftKey && path) {
    const r = wrapInBlock(diagram, path);
    return added(r.diagram, stepItem(r.path), 'Put it in a loop');
  }
  if ((e.key === 'Tab' || e.key === 'Insert') && !e.shiftKey && !mod && !e.altKey) {
    if (participant) {
      const r = addParticipant(diagram, participant);
      return added(r.diagram, { kind: 'participant', id: r.id }, 'Added a participant');
    }
    if (step?.kind === 'message' && path) {
      const r = insertAt(diagram, replyTo(step), slotFor(diagram, selection));
      return added(r.diagram, stepItem(r.path), 'Added the reply', stepItem(path));
    }
    if (e.key === 'Insert') {
      const r = insertAt(diagram, newMessage(diagram, null), slotFor(diagram, selection));
      return added(r.diagram, stepItem(r.path), 'Added a message');
    }
    return null;
  }

  // Removing.
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (participant) {
      return {
        model: removeParticipant(diagram, participant),
        select: null,
        announce: 'Removed the participant and its messages',
      };
    }
    if (selection?.kind === 'branch') {
      return {
        model: removeBranch(diagram, selection.path, selection.branch),
        select: stepItem(selection.path),
        announce: 'Removed the branch; its steps stay',
      };
    }
    if (path && step) {
      const whole = mod && e.shiftKey;
      const next = whole ? removeStepWhole(diagram, path) : removeStep(diagram, path);
      const at = order.findIndex((p) => p.join() === path.join());
      const after = stepOrder(next);
      const select = after[Math.min(at, after.length - 1)];
      return {
        model: next,
        select: select ? stepItem(select) : null,
        announce:
          step.kind === 'block' && !whole
            ? 'Removed the block; its steps stay'
            : 'Removed the step',
      };
    }
    return null;
  }

  // Moving items.
  if (e.altKey && !mod) {
    if (participant && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const next = moveParticipant(diagram, participant, e.key === 'ArrowLeft' ? -1 : 1);
      return next === diagram ? {} : { model: next };
    }
    if (path && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      return moved(moveStep(diagram, path, e.key === 'ArrowUp' ? -1 : 1));
    }
    if (path && e.shiftKey && e.key === 'ArrowRight')
      return moved(indentStep(diagram, path), 'Moved into the block');
    if (path && e.shiftKey && e.key === 'ArrowLeft')
      return moved(outdentStep(diagram, path), 'Moved out of the block');
  }

  if (mod && !e.altKey && path) {
    switch (e.code) {
      case 'KeyD':
        return moved(duplicateStep(diagram, path), 'Duplicated');
      case 'KeyC':
      case 'KeyX':
        if (!step) return null;
        clipboard = { type: 'sequence', step: freshCopy(step) };
        return e.code === 'KeyC'
          ? { announce: 'Copied' }
          : { model: removeStepWhole(diagram, path), select: null, announce: 'Cut' };
    }
  }
  if (mod && !e.altKey && e.code === 'KeyV' && clipboard?.type === 'sequence') {
    const r = insertAt(diagram, freshCopy(clipboard.step), slotFor(diagram, selection));
    return { model: r.diagram, select: stepItem(r.path), announce: 'Pasted' };
  }
  return null;
}

// Timelines

function timelineKey(
  e: KeyLike,
  model: Timeline,
  selection: Selection,
  map: HitMap,
): Outcome | null {
  const mod = e.ctrlKey || e.metaKey;
  const direction = DIRECTIONS[e.key as keyof typeof DIRECTIONS];
  if (!selection) {
    if (direction || e.key === 'Home') {
      const s = model.sections.findIndex((x) => x.periods.length);
      return s >= 0 ? { select: { kind: 'period' as const, section: s, period: 0 } } : null;
    }
    return null;
  }
  if (direction && !mod && !e.altKey && !e.shiftKey) {
    const from = singleItem(selection);
    const to = from ? itemToward(map, from, direction) : null;
    return to ? { select: selectionOf(to) } : {};
  }
  const sel = selection;
  const before = e.shiftKey;
  if (e.key === 'Enter' && !mod && !e.altKey) {
    if (sel.kind === 'period') {
      const r = addPeriod(model, sel.section, sel.period, before ? 'before' : 'after');
      return added(
        r.model,
        { kind: 'period', section: r.section, period: r.period },
        'Added a period',
        sel,
      );
    }
    if (sel.kind === 'event') {
      const r = addEvent(model, sel.section, sel.period, sel.event, before ? 'before' : 'after');
      return added(
        r.model,
        { kind: 'event', section: sel.section, period: sel.period, event: r.event },
        'Added an event',
        sel,
      );
    }
    if (sel.kind === 'section') {
      const r = addPeriod(model, sel.section, 0, 'end');
      return added(
        r.model,
        { kind: 'period', section: r.section, period: r.period },
        'Added a period',
        sel,
      );
    }
    return null;
  }
  if ((e.key === 'Tab' || e.key === 'Insert') && !e.shiftKey && !mod && !e.altKey) {
    if (sel.kind === 'period' || sel.kind === 'event') {
      const r = addEvent(model, sel.section, sel.period, 0, 'end');
      return added(
        r.model,
        { kind: 'event', section: sel.section, period: sel.period, event: r.event },
        'Added an event',
        sel,
      );
    }
    if (sel.kind === 'section') {
      const r = addPeriod(model, sel.section, 0, 'end');
      return added(
        r.model,
        { kind: 'period', section: r.section, period: r.period },
        'Added a period',
        sel,
      );
    }
    return null;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (sel.kind === 'period') {
      return {
        model: removePeriod(model, sel.section, sel.period),
        select: null,
        announce: 'Removed the period',
      };
    }
    if (sel.kind === 'event') {
      return {
        model: removeEvent(model, sel.section, sel.period, sel.event),
        select: { kind: 'period', section: sel.section, period: sel.period },
        announce: 'Removed the event',
      };
    }
    if (sel.kind === 'section') {
      const whole = mod && e.shiftKey;
      return {
        model: whole
          ? removeSectionWhole(model, sel.section)
          : removeSectionKeep(model, sel.section),
        select: null,
        announce: whole
          ? 'Removed the section and its periods'
          : 'Removed the section; its periods stay',
      };
    }
    return null;
  }
  if (e.altKey && !mod && !e.shiftKey && direction) {
    const delta = direction === 'up' || direction === 'left' ? -1 : 1;
    if (sel.kind === 'period') {
      const r = movePeriod(model, sel.section, sel.period, delta);
      return r
        ? { model: r.model, select: { kind: 'period', section: r.section, period: r.period } }
        : {};
    }
    if (sel.kind === 'event') {
      const r = moveEvent(model, sel.section, sel.period, sel.event, delta);
      return r ? { model: r.model, select: { ...sel, event: r.event } } : {};
    }
    if (sel.kind === 'section') {
      const r = moveSection(model, sel.section, delta);
      return r ? { model: r.model, select: { kind: 'section', section: r.section } } : {};
    }
  }
  if (mod && !e.altKey && e.code === 'KeyD' && sel.kind === 'period') {
    const r = duplicatePeriod(model, sel.section, sel.period);
    return r
      ? {
          model: r.model,
          select: { kind: 'period', section: r.section, period: r.period },
          announce: 'Duplicated',
        }
      : {};
  }
  return null;
}

// Gantt charts

function ganttKey(e: KeyLike, model: Gantt, selection: Selection, map: HitMap): Outcome | null {
  const mod = e.ctrlKey || e.metaKey;
  const tasks = model.sections.flatMap((s, section) =>
    s.tasks.map((_, task) => ({ section, task })),
  );
  const taskItem = (t: { section: number; task: number }): Item => ({
    kind: 'task',
    section: t.section,
    task: t.task,
  });
  const direction = DIRECTIONS[e.key as keyof typeof DIRECTIONS];
  if (!selection) {
    if ((direction || e.key === 'Home') && tasks[0]) return { select: taskItem(tasks[0]) };
    return null;
  }
  const sel = selection;
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod && !e.altKey && !e.shiftKey) {
    if (sel.kind === 'task') {
      const at = tasks.findIndex((t) => t.section === sel.section && t.task === sel.task);
      const next = tasks[at + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) return { select: taskItem(next) };
      return e.key === 'ArrowUp' && model.title ? { select: { kind: 'title' } } : {};
    }
    if (sel.kind === 'title' && e.key === 'ArrowDown' && tasks[0])
      return { select: taskItem(tasks[0]) };
  }
  if (direction && !mod && !e.altKey && !e.shiftKey) {
    const from = singleItem(selection);
    const to = from ? itemToward(map, from, direction) : null;
    return to ? { select: selectionOf(to) } : {};
  }
  if (e.key === 'Home' && !mod && tasks[0]) return { select: taskItem(tasks[0]) };
  if (e.key === 'End' && !mod && tasks.at(-1)) return { select: taskItem(tasks.at(-1)!) };

  if (e.key === 'Enter' && !mod && !e.altKey) {
    if (sel.kind === 'task') {
      const r = addTask(model, sel.section, sel.task, e.shiftKey ? 'before' : 'after');
      return added(r.model, taskItem(r), 'Added a task', sel);
    }
    if (sel.kind === 'section') {
      const r = addTask(model, sel.section, 0, 'end');
      return added(r.model, taskItem(r), 'Added a task', sel);
    }
    return null;
  }
  if (
    (e.key === 'Tab' || e.key === 'Insert') &&
    !e.shiftKey &&
    !mod &&
    !e.altKey &&
    sel.kind === 'section'
  ) {
    const r = addTask(model, sel.section, 0, 'end');
    return added(r.model, taskItem(r), 'Added a task', sel);
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (sel.kind === 'task') {
      const at = tasks.findIndex((t) => t.section === sel.section && t.task === sel.task);
      const next = removeTask(model, sel.section, sel.task);
      const left = next.sections.flatMap((s, section) =>
        s.tasks.map((_, task) => ({ section, task })),
      );
      const pick = left[Math.min(at, left.length - 1)];
      return { model: next, select: pick ? taskItem(pick) : null, announce: 'Removed the task' };
    }
    if (sel.kind === 'section') {
      const whole = mod && e.shiftKey;
      return {
        model: whole
          ? removeSectionWhole(model, sel.section)
          : removeSectionKeep(model, sel.section),
        select: null,
        announce: whole
          ? 'Removed the section and its tasks'
          : 'Removed the section; its tasks stay',
      };
    }
    return null;
  }
  if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const delta = e.key === 'ArrowUp' ? -1 : 1;
    if (sel.kind === 'task') {
      const r = moveTask(model, sel.section, sel.task, delta);
      return r ? { model: r.model, select: taskItem(r) } : {};
    }
    if (sel.kind === 'section') {
      const r = moveSection(model, sel.section, delta);
      return r ? { model: r.model, select: { kind: 'section', section: r.section } } : {};
    }
  }
  if (mod && !e.altKey && e.code === 'KeyD' && sel.kind === 'task') {
    const r = duplicateTask(model, sel.section, sel.task);
    return r ? { model: r.model, select: taskItem(r), announce: 'Duplicated' } : {};
  }
  return null;
}

// Pie charts

function pieKey(e: KeyLike, model: Pie, selection: Selection): Outcome | null {
  const mod = e.ctrlKey || e.metaKey;
  const index = selection?.kind === 'slice' || selection?.kind === 'value' ? selection.index : null;
  const slice = (i: number): Item => ({ kind: 'slice', index: i });
  if (
    (e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight') &&
    !mod &&
    !e.altKey &&
    !e.shiftKey
  ) {
    if (index === null) return model.slices.length ? { select: slice(0) } : null;
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const to = index + (forward ? 1 : -1);
    if (to >= 0 && to < model.slices.length) return { select: slice(to) };
    return !forward && model.title ? { select: { kind: 'title' } } : {};
  }
  if (e.key === 'Home' && !mod && model.slices.length) return { select: slice(0) };
  if (e.key === 'End' && !mod && model.slices.length)
    return { select: slice(model.slices.length - 1) };
  if (e.key === 'Enter' && !mod && !e.altKey) {
    if (index === null) {
      if (selection?.kind !== 'title') return null;
      const r = addSlice(model, null);
      return added(r.model, slice(r.index), 'Added a slice');
    }
    const r = addSlice(model, index, e.shiftKey ? 'before' : 'after');
    return added(r.model, slice(r.index), 'Added a slice', slice(index));
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && index !== null) {
    const next = removeSlice(model, index);
    return {
      model: next,
      select: next.slices.length ? slice(Math.min(index, next.slices.length - 1)) : null,
      announce: 'Removed the slice',
    };
  }
  if (
    e.altKey &&
    !mod &&
    !e.shiftKey &&
    index !== null &&
    (e.key === 'ArrowUp' || e.key === 'ArrowDown')
  ) {
    const r = moveSlice(model, index, e.key === 'ArrowUp' ? -1 : 1);
    return r ? { model: r.model, select: slice(r.index) } : {};
  }
  if (mod && !e.altKey && e.code === 'KeyD' && index !== null) {
    const r = duplicateSlice(model, index);
    return r ? { model: r.model, select: slice(r.index), announce: 'Duplicated' } : {};
  }
  return null;
}

/** Tab while editing words: keep them, then do what Tab does on the item (one history step). */
export function afterEdit(model: DiagramModel, item: Item, map: HitMap): Outcome | null {
  const tab: KeyLike = {
    key: 'Tab',
    code: 'Tab',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  };
  return keyAction(tab, model, selectionOf(item), map);
}

/** The first thing to select in a diagram, for the arrow keys with nothing selected. */
export function firstItem(model: DiagramModel): Item | null {
  switch (model.type) {
    case 'flowchart':
      return model.nodes[0] ? { kind: 'node', id: model.nodes[0].id } : null;
    case 'mindmap':
      return mindmapTopics(model).length ? { kind: 'topic', index: 0 } : null;
    case 'sequence':
      return model.participants[0] ? { kind: 'participant', id: model.participants[0].id } : null;
    case 'timeline':
      return model.sections[0]?.periods[0] ? { kind: 'period', section: 0, period: 0 } : null;
    case 'gantt':
      return model.sections[0]?.tasks[0] ? { kind: 'task', section: 0, task: 0 } : null;
    case 'pie':
      return model.slices[0] ? { kind: 'slice', index: 0 } : null;
  }
}

/** Selected items that still exist after a change (an undo can take them away). */
export function stillThere(model: DiagramModel, selection: Selection): Selection {
  const items = itemsOf(selection).filter((item) => {
    if (item.kind === 'node')
      return model.type === 'flowchart' && model.nodes.some((n) => n.id === item.id);
    return (
      !!textOf(model, item) ||
      (item.kind === 'step' && model.type === 'sequence' && !!stepAt(model, item.path))
    );
  });
  if (!items.length) return null;
  if (selection?.kind === 'nodes')
    return { kind: 'nodes', ids: items.map((i) => (i as { id: string }).id) };
  return selectionOf(items[0]!);
}
