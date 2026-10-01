/*
 * Memora's mind map layout (§9.4): the central topic in the middle, its topics shared between
 * the right and the left (clockwise from the top right, balanced by height), each branch a
 * tidy tree growing outwards, joined by smooth curves that taper away from the centre.
 *
 * Mermaid lays mind maps out with a force simulation (its "cose-bilkent" layout), which
 * scatters topics and loads a large graph library. render.ts registers this module under that
 * name instead. It follows Mermaid's layout contract: draw the nodes with its helpers, measure
 * them, place them, then draw the lines. Anything else asking for that layout (a flowchart
 * with `layout: cose-bilkent`) gets the same tree, with Mermaid's own edges.
 */

import type { InternalHelpers, LayoutData, SVG } from 'mermaid';

type MermaidNode = LayoutData['nodes'][number];
type ShapeNode = Parameters<InternalHelpers['insertNode']>[1];

interface Point {
  x: number;
  y: number;
}

interface Topic {
  data: MermaidNode;
  element: Element;
  width: number;
  /** The drawn shape's top and bottom, around its centre. */
  top: number;
  bottom: number;
  /** Without a shape: drawn as words on a line. */
  plain: boolean;
  children: Topic[];
  depth: number;
  /** The height its branch needs. */
  span: number;
  x: number;
  y: number;
}

/** Space from a topic to its children, from the centre to its topics, and between them. */
const GAP_X = 44;
const GAP_X_CENTRE = 64;
const GAP_Y = 10;
const GAP_BRANCH = 22;

function measure(topic: Topic): number {
  const height = topic.bottom - topic.top;
  if (!topic.children.length) return (topic.span = height);
  const gap = topic.depth === 0 ? GAP_BRANCH : GAP_Y;
  const block =
    topic.children.reduce((sum, child) => sum + measure(child), 0) +
    gap * (topic.children.length - 1);
  return (topic.span = Math.max(height, block));
}

/** Places a topic's branch in the band starting at `top`, growing to `side` (1 or -1). */
function place(topic: Topic, top: number, side: number) {
  const kids = topic.children;
  if (!kids.length) {
    topic.y = top + topic.span / 2 - (topic.top + topic.bottom) / 2;
    return;
  }
  const block = kids.reduce((sum, child) => sum + child.span, 0) + GAP_Y * (kids.length - 1);
  let y = top + (topic.span - block) / 2;
  for (const child of kids) {
    child.x = topic.x + side * (topic.width / 2 + GAP_X + child.width / 2);
    place(child, y, side);
    y += child.span + GAP_Y;
  }
  topic.y = (kids[0]!.y + kids.at(-1)!.y) / 2;
}

/** Shares the centre's topics between the right and the left, so both are about as tall. */
function split(topics: Topic[]): [Topic[], Topic[]] {
  const total = (list: Topic[]) =>
    list.reduce((sum, t) => sum + t.span, 0) + GAP_BRANCH * Math.max(0, list.length - 1);
  let best = topics.length;
  let bestCost = Infinity;
  for (let k = 1; k <= topics.length; k++) {
    const cost = Math.abs(total(topics.slice(0, k)) - total(topics.slice(k)));
    // Ties go to the side that keeps the order clockwise: the right first.
    if (cost < bestCost - 0.5) {
      best = k;
      bestCost = cost;
    }
  }
  return [topics.slice(0, best), topics.slice(best)];
}

function placeSide(centre: Topic, topics: Topic[], side: number) {
  const height =
    topics.reduce((sum, t) => sum + t.span, 0) + GAP_BRANCH * Math.max(0, topics.length - 1);
  let y = centre.y - height / 2;
  for (const topic of topics) {
    topic.x = centre.x + side * (centre.width / 2 + GAP_X_CENTRE + topic.width / 2);
    place(topic, y, side);
    y += topic.span + GAP_BRANCH;
  }
}

/** Where a line leaves `from` (or enters it, from the side `side` faces). */
function anchor(topic: Topic, side: number): Point {
  if (topic.depth === 0) return { x: topic.x, y: topic.y };
  const x = topic.x + (side * topic.width) / 2;
  // Words on a line are joined at the line, so branches run on into it.
  return { x, y: topic.plain && topic.depth > 1 ? topic.y + topic.bottom : topic.y };
}

function curve(from: Point, to: Point): string {
  const bend = (to.x - from.x) / 2;
  const n = (v: number) => Math.round(v * 10) / 10;
  return `M${n(from.x)},${n(from.y)} C${n(from.x + bend)},${n(from.y)} ${n(to.x - bend)},${n(to.y)} ${n(to.x)},${n(to.y)}`;
}

export async function render(data: LayoutData, svg: SVG, helpers: InternalHelpers): Promise<void> {
  const element = svg.select<SVGGElement>('g');
  helpers.insertMarkers(element, data.markers, data.type, data.diagramId);
  const lines = element.insert('g').attr('class', 'edgePaths');
  const labels = element.insert('g').attr('class', 'edgeLabels');
  const nodes = element.insert('g').attr('class', 'nodes');

  const topics = new Map<string, Topic>();
  for (const node of data.nodes) {
    if (node.isGroup) continue;
    const drawn = await helpers.insertNode(nodes, node as ShapeNode, {
      config: data.config,
      dir: (data.direction as string | undefined) ?? 'TB',
    });
    const shape = drawn.node() as SVGGraphicsElement | null;
    if (!shape) continue;
    const box = shape.getBBox();
    topics.set(node.id, {
      data: node,
      element: shape,
      width: box.width,
      top: box.y,
      bottom: box.y + box.height,
      plain: !!shape.querySelector(':scope > line'),
      children: [],
      depth: 0,
      span: 0,
      x: 0,
      y: 0,
    });
  }

  // The tree: each topic under the first line that reaches it.
  const reached = new Set<Topic>();
  for (const edge of data.edges) {
    const from = topics.get(edge.start ?? '');
    const to = topics.get(edge.end ?? '');
    if (!from || !to || from === to || reached.has(to)) continue;
    from.children.push(to);
    reached.add(to);
  }
  const rootId = (data.rootNode as { id?: string | number } | undefined)?.id;
  const named = rootId === undefined ? undefined : topics.get(String(rootId));
  const roots = named
    ? [named, ...[...topics.values()].filter((t) => t !== named && !reached.has(t))]
    : [...topics.values()].filter((t) => !reached.has(t));
  const setDepth = (topic: Topic, depth: number, seen: Set<Topic>) => {
    if (seen.has(topic)) return;
    seen.add(topic);
    topic.depth = depth;
    topic.children = topic.children.filter((child) => !seen.has(child));
    for (const child of topic.children) setDepth(child, depth + 1, seen);
  };
  const seen = new Set<Topic>();
  for (const root of roots) setDepth(root, 0, seen);

  // The centre with its branches either side; anything else (more roots) below it.
  let bottom = 0;
  roots.forEach((root, i) => {
    measure(root);
    root.x = 0;
    if (i === 0 && data.type === 'mindmap') {
      root.y = 0;
      const [right, left] = split(root.children);
      placeSide(root, right, 1);
      placeSide(root, left.reverse(), -1);
      bottom = Math.max(root.span, root.bottom) / 2 + GAP_BRANCH * 2;
    } else {
      place(root, bottom, 1);
      bottom += root.span + GAP_BRANCH * 2;
    }
  });

  for (const topic of topics.values()) {
    topic.element.setAttribute('transform', `translate(${topic.x}, ${topic.y})`);
    topic.data.x = topic.x;
    topic.data.y = topic.y;
    topic.data.width = topic.width;
    topic.data.height = topic.bottom - topic.top;
    const level = topic.depth === 0 ? 'mm-root' : topic.depth === 1 ? 'mm-main' : 'mm-sub';
    topic.element.classList.add(level);
    if (topic.plain) topic.element.classList.add('mm-plain');
  }

  if (data.type !== 'mindmap') {
    // Mermaid's own lines (arrows, labels) between the placed boxes.
    for (const edge of data.edges) {
      const from = topics.get(edge.start ?? '');
      const to = topics.get(edge.end ?? '');
      if (!from || !to) continue;
      await helpers.insertEdgeLabel(labels, edge);
      const placed = {
        ...edge,
        points: [
          { x: from.x, y: from.y },
          { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
          { x: to.x, y: to.y },
        ],
      };
      const paths = helpers.insertEdge(
        lines,
        placed,
        {},
        data.type,
        from.data,
        to.data,
        data.diagramId,
      );
      helpers.positionEdgeLabel(placed, paths);
    }
    return;
  }

  // Branches: from the centre (hidden under it) or a topic's outer side to the child's near one.
  for (const edge of data.edges) {
    const from = topics.get(edge.start ?? '');
    const to = topics.get(edge.end ?? '');
    if (!from || !to || !from.children.includes(to)) continue;
    const side = to.x >= from.x ? 1 : -1;
    const path = lines.insert('path');
    path
      .attr('d', curve(anchor(from, side), anchor(to, -side)))
      .attr('id', `${data.diagramId ?? 'mindmap'}-${edge.id}`)
      .attr('data-et', 'edge')
      .attr('data-id', edge.id)
      .attr(
        'class',
        `mm-branch mm-depth-${Math.min(to.depth, 4)} mm-section-${(edge as { section?: number }).section ?? 0}`,
      );
  }
}
