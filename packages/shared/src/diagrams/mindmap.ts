import { refuse, splitSource, withHead, type ParseResult } from './common';

/*
 * Mind maps (§9.4): a tree of topics written as an indented outline, each with a shape.
 * Icons and classes under a topic stay with it, as written.
 */

export const MINDMAP_SHAPES = [
  'default',
  'rounded',
  'square',
  'circle',
  'cloud',
  'bang',
  'hexagon',
] as const;
export type MindmapShape = (typeof MINDMAP_SHAPES)[number];

export interface MindmapTopic {
  label: string;
  shape: MindmapShape;
  /** The id written before the shape (`root((…))`), when there was one. */
  id: string | null;
  /** `::icon(…)` and `:::class` lines under the topic, as written. */
  decorations: string[];
  children: MindmapTopic[];
}

export interface Mindmap {
  type: 'mindmap';
  head: string[];
  root: MindmapTopic;
}

const SHAPES: Record<Exclude<MindmapShape, 'default'>, [string, string]> = {
  circle: ['((', '))'],
  bang: ['))', '(('],
  hexagon: ['{{', '}}'],
  square: ['[', ']'],
  rounded: ['(', ')'],
  cloud: [')', '('],
};
/** Tried in this order: longer delimiters first. */
const ORDER: Exclude<MindmapShape, 'default'>[] = [
  'circle',
  'bang',
  'hexagon',
  'square',
  'rounded',
  'cloud',
];

const unquote = (text: string) => {
  const t = text.trim();
  return (t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t).replace(
    /<br\s*\/?>/gi,
    '\n',
  );
};

/** Reads one topic's line (without its indentation). */
function readTopic(text: string): MindmapTopic {
  for (const shape of ORDER) {
    const [open, close] = SHAPES[shape];
    const at = text.indexOf(open);
    if (at >= 0 && text.endsWith(close) && at + open.length <= text.length - close.length) {
      const id = text.slice(0, at).trim();
      if (/\s/.test(id)) continue;
      return {
        label: unquote(text.slice(at + open.length, text.length - close.length)),
        shape,
        id: id || null,
        decorations: [],
        children: [],
      };
    }
  }
  return { label: unquote(text), shape: 'default', id: null, decorations: [], children: [] };
}

/** Reads a mind map from Mermaid code. */
export function parseMindmap(code: string): ParseResult<Mindmap> {
  const source = splitSource(code);
  if (!source) return refuse('The diagram is empty');
  if (source.first !== 'mindmap') return refuse('This isn’t a mind map', source.firstNumber);
  let root: MindmapTopic | null = null;
  // Open topics with their indentation, outermost first.
  const stack: { indent: number; topic: MindmapTopic }[] = [];
  for (const { text: raw, number } of source.body) {
    if (raw.trim() === '') continue;
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text.startsWith('%%')) continue;
    if (text.startsWith('::icon(') || text.startsWith(':::')) {
      const owner = stack.at(-1)?.topic;
      if (!owner) return refuse('An icon or class has no topic', number);
      owner.decorations.push(text);
      continue;
    }
    const topic = readTopic(text);
    if (!root) {
      root = topic;
      stack.push({ indent, topic });
      continue;
    }
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const parent = stack.at(-1);
    if (!parent) return refuse('A mind map has one central topic', number);
    parent.topic.children.push(topic);
    stack.push({ indent, topic });
  }
  if (!root) return refuse('The mind map has no topics');
  return { ok: true, model: { type: 'mindmap', head: source.head, root } };
}

/*
 * Mermaid's mind maps read no entity codes. A topic with a shape takes any text in quotes
 * (`t1("Fast (v2)")`); a plain topic can't hold brackets, so one that has them is written
 * with the rounded shape, the closest look. Double quotes become typographic ones.
 */
const BRACKETS = /[()[\]{}]/;
const inQuotes = (label: string) => `"${label.replace(/"/g, '\u201d').replace(/\r?\n/g, '<br>')}"`;

/** Writes a mind map as Mermaid code. */
export function printMindmap(map: Mindmap): string {
  const out = ['mindmap'];
  const used = new Set(
    mindmapTopics(map)
      .map((t) => t.topic.id)
      .filter(Boolean),
  );
  let next = 1;
  const fresh = () => {
    while (used.has(`t${next}`)) next += 1;
    used.add(`t${next}`);
    return `t${next}`;
  };
  const topic = (t: MindmapTopic, depth: number) => {
    const pad = '  '.repeat(depth);
    const plain = t.shape === 'default' && !BRACKETS.test(t.label) && !t.label.startsWith('::');
    if (plain) out.push(pad + t.label.replace(/\r?\n/g, '<br>'));
    else {
      const [open, close] = SHAPES[t.shape === 'default' ? 'rounded' : t.shape];
      const id = t.id ?? (depth === 1 ? 'root' : fresh());
      out.push(`${pad}${id}${open}${inQuotes(t.label)}${close}`);
    }
    for (const d of t.decorations) out.push(`${pad}  ${d}`);
    for (const child of t.children) topic(child, depth + 1);
  };
  topic(map.root, 1);
  return withHead(map.head, out);
}

/** Every topic, depth first, with its depth (the root is 0). */
export function mindmapTopics(map: Mindmap): { topic: MindmapTopic; depth: number }[] {
  const all: { topic: MindmapTopic; depth: number }[] = [];
  const walk = (t: MindmapTopic, depth: number) => {
    all.push({ topic: t, depth });
    t.children.forEach((c) => walk(c, depth + 1));
  };
  walk(map.root, 0);
  return all;
}
