import { mindmapTopics, type DiagramModel, type Flowchart } from '@memora/shared';
import { edgeDomId, messagePaths, notePaths, stepRows, type StepPath } from './ops';
import { itemKey, type Item } from './selection';

/*
 * Which drawn element is which item (§9.4). Mermaid names some of its elements after the
 * diagram's ids (boxes, arrows, groups, mind map topics, Gantt tasks); others come in the
 * order of the code (messages, notes, blocks, timeline periods, pie slices). Measured once
 * per drawing; clicks, selection rings, editing in place and the arrow keys all use it.
 */

export interface Hit {
  item: Item;
  /** What is drawn for it: a click on any of these is a click on the item. */
  elements: Element[];
  /** Where its words are, for editing them in place (else over the elements). */
  text: Element | null;
}

export interface HitMap {
  hits: Hit[];
  /** The item a drawn element belongs to (the innermost one). */
  itemAt: (element: Element | null) => Item | null;
  /** The hit of an item. */
  hitOf: (item: Item) => Hit | undefined;
}

/** The box a drawn element belongs to. */
export function nodeIdOf(svg: SVGSVGElement, element: Element | null): string | null {
  const node = element?.closest('g.node');
  if (!node?.id) return null;
  const prefix = `${svg.id}-flowchart-`;
  if (!node.id.startsWith(prefix)) return null;
  return node.id.slice(prefix.length).replace(/-\d+$/, '');
}

export function groupIdOf(svg: SVGSVGElement, element: Element | null): string | null {
  const cluster = element?.closest('g.cluster');
  if (!cluster?.id) return null;
  const prefix = `${svg.id}-`;
  return cluster.id.startsWith(prefix) ? cluster.id.slice(prefix.length) : null;
}

const textIn = (element: Element | null | undefined): Element | null =>
  element?.querySelector('text') ?? null;

/** A text element of the drawing's own (not inside an item) with exactly these words. */
function looseText(svg: SVGSVGElement, words: string, selector = 'text'): Element | null {
  if (!words.trim()) return null;
  const want = words.replace(/\s+/g, '');
  for (const text of svg.querySelectorAll(selector)) {
    if ((text.textContent ?? '').replace(/\s+/g, '') === want) return text;
  }
  return null;
}

/** Wide, invisible copies of the arrows, so a thin line is easy to click (made once). */
function addEdgeHitPaths(svg: SVGSVGElement) {
  for (const path of svg.querySelectorAll<SVGPathElement>('path[data-id^="L_"]')) {
    if (path.classList.contains('diagram-hit')) continue;
    const id = path.getAttribute('data-id') ?? '';
    if (path.parentElement?.querySelector(`path.diagram-hit[data-edge-id="${CSS.escape(id)}"]`))
      continue;
    const hit = path.cloneNode(false) as SVGPathElement;
    hit.removeAttribute('id');
    hit.removeAttribute('marker-end');
    hit.removeAttribute('marker-start');
    hit.removeAttribute('style');
    hit.removeAttribute('data-id');
    hit.setAttribute('class', 'diagram-hit');
    hit.setAttribute('data-edge-id', id);
    path.after(hit);
  }
}

function flowchartHits(svg: SVGSVGElement, chart: Flowchart): Hit[] {
  const hits: Hit[] = [];
  addEdgeHitPaths(svg);
  for (const g of svg.querySelectorAll('g.node')) {
    const id = nodeIdOf(svg, g);
    if (id && chart.nodes.some((n) => n.id === id)) {
      hits.push({ item: { kind: 'node', id }, elements: [g], text: g.querySelector('g.label') });
    }
  }
  chart.edges.forEach((_, index) => {
    const id = CSS.escape(edgeDomId(chart, index));
    const elements = [...svg.querySelectorAll(`path[data-id="${id}"], path[data-edge-id="${id}"]`)];
    const label = svg.querySelector(`g.edgeLabel g.label[data-id="${id}"]`)?.closest('g.edgeLabel');
    if (label) elements.push(label);
    if (elements.length) {
      hits.push({
        item: { kind: 'edge', index },
        elements,
        text: label && label.textContent?.trim() ? label : null,
      });
    }
  });
  for (const g of svg.querySelectorAll('g.cluster')) {
    const id = groupIdOf(svg, g);
    if (id && chart.groups.some((group) => group.id === id)) {
      hits.push({
        item: { kind: 'group', id },
        elements: [g],
        text: g.querySelector('.cluster-label'),
      });
    }
  }
  return hits;
}

function mindmapHits(svg: SVGSVGElement, model: DiagramModel & { type: 'mindmap' }): Hit[] {
  const hits: Hit[] = [];
  const count = mindmapTopics(model).length;
  for (const g of svg.querySelectorAll('g.mindmap-node, g.node')) {
    const match = g.id ? /-node_(\d+)$/.exec(g.id) : null;
    const index = match ? Number(match[1]) : -1;
    if (index >= 0 && index < count) {
      hits.push({ item: { kind: 'topic', index }, elements: [g], text: textIn(g) });
    }
  }
  return hits;
}

/** The blocks of a sequence diagram in the order Mermaid finishes drawing them (by their end). */
function blocksByEnd(model: DiagramModel & { type: 'sequence' }): StepPath[] {
  const ends: StepPath[] = [];
  for (const row of stepRows(model)) if (row.kind === 'end') ends.push(row.path);
  return ends;
}

function sequenceHits(svg: SVGSVGElement, model: DiagramModel & { type: 'sequence' }): Hit[] {
  const hits: Hit[] = [];
  for (const p of model.participants) {
    const elements = [
      ...svg.querySelectorAll(`[data-et="participant"][data-id="${CSS.escape(p.id)}"]`),
    ];
    if (elements.length) {
      hits.push({ item: { kind: 'participant', id: p.id }, elements, text: textIn(elements[0]) });
    }
  }
  const lines = [...svg.querySelectorAll('[data-et="message"]')];
  const words = [...svg.querySelectorAll('text.messageText')];
  messagePaths(model).forEach((path, i) => {
    const elements = [lines[i], words[i]].filter((e): e is Element => !!e);
    if (elements.length)
      hits.push({ item: { kind: 'step', path }, elements, text: words[i] ?? null });
  });
  const notes = [...svg.querySelectorAll('[data-et="note"]')];
  notePaths(model).forEach((path, i) => {
    const note = notes[i];
    if (note) hits.push({ item: { kind: 'step', path }, elements: [note], text: textIn(note) });
  });
  const frames = [...svg.querySelectorAll('[data-et="control-structure"]')].sort(
    (a, b) =>
      Number(a.getAttribute('data-id')?.slice(1) ?? 0) -
      Number(b.getAttribute('data-id')?.slice(1) ?? 0),
  );
  blocksByEnd(model).forEach((path, i) => {
    const frame = frames[i];
    if (!frame) return;
    const conditions = [...frame.querySelectorAll('text.sectionTitle')];
    const own = [...frame.children].filter((e) => !e.matches('text.sectionTitle'));
    hits.push({
      item: { kind: 'step', path },
      elements: own,
      text: frame.querySelector('text.loopText') ?? frame.querySelector('text.labelText'),
    });
    conditions.forEach((text, b) => {
      hits.push({ item: { kind: 'branch', path, branch: b + 1 }, elements: [text], text });
    });
  });
  if (model.title) {
    const title = looseText(svg, model.title, 'text:not([class])');
    if (title) hits.push({ item: { kind: 'title' }, elements: [title], text: title });
  }
  return hits;
}

function timelineHits(svg: SVGSVGElement, model: DiagramModel & { type: 'timeline' }): Hit[] {
  const hits: Hit[] = [];
  const nodes = [...svg.querySelectorAll('g.timeline-node')];
  let at = 0;
  const take = (item: Item) => {
    const node = nodes[at++];
    if (node) hits.push({ item, elements: [node], text: textIn(node) });
  };
  model.sections.forEach((s, section) => {
    if (s.label !== null) take({ kind: 'section', section });
    s.periods.forEach((p, period) => {
      take({ kind: 'period', section, period });
      p.events.forEach((_, event) => take({ kind: 'event', section, period, event }));
    });
  });
  const title = looseText(svg, model.title, 'text:not([class])');
  if (title) hits.push({ item: { kind: 'title' }, elements: [title], text: title });
  return hits;
}

function ganttHits(svg: SVGSVGElement, model: DiagramModel & { type: 'gantt' }): Hit[] {
  const hits: Hit[] = [];
  // Mermaid names tasks after their ids; those without one become task1, task2…
  let unnamed = 0;
  model.sections.forEach((s, section) => {
    s.tasks.forEach((task, index) => {
      const id = task.id ?? `task${++unnamed}`;
      const bar = svg.querySelector(`rect.task[id="${CSS.escape(`${svg.id}-${id}`)}"]`);
      const words = svg.querySelector(`text[id="${CSS.escape(`${svg.id}-${id}-text`)}"]`);
      const elements = [bar, words].filter((e): e is Element => !!e);
      if (elements.length) {
        hits.push({ item: { kind: 'task', section, task: index }, elements, text: words ?? bar });
      }
    });
    if (s.label !== null) {
      const title = looseText(svg, s.label, 'text.sectionTitle');
      if (title) hits.push({ item: { kind: 'section', section }, elements: [title], text: title });
    }
  });
  const title = svg.querySelector('text.titleText');
  if (title) hits.push({ item: { kind: 'title' }, elements: [title], text: title });
  return hits;
}

function pieHits(svg: SVGSVGElement, model: DiagramModel & { type: 'pie' }): Hit[] {
  const hits: Hit[] = [];
  // Slices of 0 have no wedge and no share, but are in the legend.
  const wedges = [...svg.querySelectorAll('path.pieCircle')];
  const shares = [...svg.querySelectorAll('text.slice')];
  const legend = [...svg.querySelectorAll('g.legend')];
  let drawn = 0;
  model.slices.forEach((slice, index) => {
    const key = legend[index];
    const elements: Element[] = key ? [key] : [];
    let share: Element | undefined;
    if (slice.value > 0) {
      const wedge = wedges[drawn];
      share = shares[drawn];
      drawn += 1;
      if (wedge) elements.push(wedge);
    }
    if (elements.length) {
      hits.push({ item: { kind: 'slice', index }, elements, text: key ? textIn(key) : null });
    }
    if (share) hits.push({ item: { kind: 'value', index }, elements: [share], text: share });
  });
  const title = svg.querySelector('text.pieTitleText');
  if (title) hits.push({ item: { kind: 'title' }, elements: [title], text: title });
  return hits;
}

export function hitMap(svg: SVGSVGElement | null, model: DiagramModel | null): HitMap {
  let hits: Hit[] = [];
  if (svg && model) {
    switch (model.type) {
      case 'flowchart':
        hits = flowchartHits(svg, model);
        break;
      case 'mindmap':
        hits = mindmapHits(svg, model);
        break;
      case 'sequence':
        hits = sequenceHits(svg, model);
        break;
      case 'timeline':
        hits = timelineHits(svg, model);
        break;
      case 'gantt':
        hits = ganttHits(svg, model);
        break;
      case 'pie':
        hits = pieHits(svg, model);
        break;
    }
  }
  const owner = new Map<Element, Item>();
  // Later hits are more specific (a branch's words inside its block): they win.
  for (const hit of hits) for (const element of hit.elements) owner.set(element, hit.item);
  const byKey = new Map(hits.map((hit) => [itemKey(hit.item), hit]));
  return {
    hits,
    itemAt: (element) => {
      for (let e = element; e && e !== svg; e = e.parentElement) {
        const item = owner.get(e);
        if (item) return item;
      }
      return null;
    },
    hitOf: (item) => byKey.get(itemKey(item)),
  };
}

/** Where an item is on the screen, for the arrow keys: its centre. */
export function centreOf(hit: Hit): { x: number; y: number } | null {
  const boxes = hit.elements
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width || r.height);
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const right = Math.max(...boxes.map((b) => b.right));
  const top = Math.min(...boxes.map((b) => b.top));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * The item the arrow key points to from `from`: the nearest one that way, weighing distance
 * across the direction double (as in a flowchart's boxes, a mind map's topics, a timeline).
 */
export function itemToward(
  map: HitMap,
  from: Item,
  direction: 'up' | 'down' | 'left' | 'right',
  accept: (item: Item) => boolean = () => true,
): Item | null {
  const start = map.hitOf(from);
  const origin = start ? centreOf(start) : null;
  if (!origin) return null;
  const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction] as [
    number,
    number,
  ];
  let best: Item | null = null;
  let bestScore = Infinity;
  for (const hit of map.hits) {
    if (itemKey(hit.item) === itemKey(from) || !accept(hit.item)) continue;
    const c = centreOf(hit);
    if (!c) continue;
    const along = (c.x - origin.x) * dx + (c.y - origin.y) * dy;
    if (along <= 1) continue;
    const across = Math.abs((c.x - origin.x) * dy - (c.y - origin.y) * dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = hit.item;
    }
  }
  return best;
}

/** The boxes inside a rectangle on the screen (a Shift-drag). */
export function boxesWithin(map: HitMap, rect: DOMRect): string[] {
  const ids: string[] = [];
  for (const hit of map.hits) {
    if (hit.item.kind !== 'node') continue;
    const r = hit.elements[0]?.getBoundingClientRect();
    if (
      r &&
      r.right > rect.left &&
      r.left < rect.right &&
      r.bottom > rect.top &&
      r.top < rect.bottom
    ) {
      ids.push(hit.item.id);
    }
  }
  return ids;
}
