import type { StepPath } from './ops';

/*
 * What is selected in the diagram editor (§9.4), for every kind of diagram: one shape, so
 * the drawing, the panel, the keys and the undo history all speak of the same thing. Each
 * item that has words can also be edited in place on the drawing (`TextTarget`).
 */

export type Selection =
  // Flowcharts
  | { kind: 'nodes'; ids: string[] }
  | { kind: 'edge'; index: number }
  | { kind: 'group'; id: string }
  // Mind maps: topics numbered depth first, the centre is 0.
  | { kind: 'topic'; index: number }
  // Sequence diagrams
  | { kind: 'participant'; id: string }
  | { kind: 'step'; path: StepPath }
  | { kind: 'branch'; path: StepPath; branch: number }
  // Sequence diagrams, timelines, Gantt and pie charts
  | { kind: 'title' }
  // Timelines and Gantt charts
  | { kind: 'section'; section: number }
  | { kind: 'period'; section: number; period: number }
  | { kind: 'event'; section: number; period: number; event: number }
  | { kind: 'task'; section: number; task: number }
  // Pie charts (the value can be edited in place too)
  | { kind: 'slice'; index: number }
  | { kind: 'value'; index: number }
  | null;

/** One item: what a selection ring or an edit in place is about. */
export type Item = Exclude<Selection, null | { kind: 'nodes' }> | { kind: 'node'; id: string };

/** What can be selected: a selection, or one item (a box becomes a selection of one). */
export type Selectable = Selection | Item;

export const toSelection = (value: Selectable): Selection =>
  value?.kind === 'node' ? { kind: 'nodes', ids: [value.id] } : value;

/** A short, stable key for an item: marks its row in the panel (`data-item`). */
export function itemKey(item: Item): string {
  switch (item.kind) {
    case 'node':
      return `node:${item.id}`;
    case 'edge':
      return `edge:${item.index}`;
    case 'group':
      return `group:${item.id}`;
    case 'topic':
      return `topic:${item.index}`;
    case 'participant':
      return `participant:${item.id}`;
    case 'step':
      return `step:${item.path.join('.')}`;
    case 'branch':
      return `branch:${item.path.join('.')}:${item.branch}`;
    case 'title':
      return 'title';
    case 'section':
      return `section:${item.section}`;
    case 'period':
      return `period:${item.section}.${item.period}`;
    case 'event':
      return `event:${item.section}.${item.period}.${item.event}`;
    case 'task':
      return `task:${item.section}.${item.task}`;
    case 'slice':
      return `slice:${item.index}`;
    case 'value':
      return `value:${item.index}`;
  }
}

/** The items a selection is made of. */
export function itemsOf(selection: Selection): Item[] {
  if (!selection) return [];
  if (selection.kind === 'nodes') return selection.ids.map((id) => ({ kind: 'node', id }));
  return [selection];
}

/** The selection of one item. */
export function selectionOf(item: Item | null): Selection {
  if (!item) return null;
  if (item.kind === 'node') return { kind: 'nodes', ids: [item.id] };
  return item;
}

/** The one item selected, if exactly one is. */
export function singleItem(selection: Selection): Item | null {
  const items = itemsOf(selection);
  return items.length === 1 ? items[0]! : null;
}

export const sameItem = (a: Item | null, b: Item | null): boolean =>
  !!a && !!b && itemKey(a) === itemKey(b);

export const isSelected = (selection: Selection, item: Item): boolean =>
  itemsOf(selection).some((i) => sameItem(i, item));
