import {
  EMPTY_TEXT,
  decodeEntities,
  readText,
  refuse,
  splitSource,
  type FromOrigin,
  type FromSource,
  type ParseResult,
} from './common';
import { modelOf, remembered, type Reading } from './source';

/*
 * Mind maps (§9.4): a tree of topics written as an indented outline, each with a shape.
 * Icons and classes under a topic stay with it, as written, and so do comments.
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

export interface MindmapTopic extends FromOrigin {
  label: string;
  shape: MindmapShape;
  /** The id written before the shape (`root((…))`), when there was one. */
  id: string | null;
  /** `::icon(…)` and `:::class` lines under the topic, as written. */
  decorations: string[];
  children: MindmapTopic[];
}

export interface Mindmap extends FromSource {
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

/** Reads a shape's text: quoted (as written) or not (trimmed). */
function shapeText(inner: string): { label: string; quoted: boolean } {
  const t = inner.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    // In quotes, spaces at either end are the topic's own.
    const text = t.slice(1, -1);
    const label = text === EMPTY_TEXT ? '' : decodeEntities(text.replace(/<br\s*\/?>/gi, '\n'));
    return { label, quoted: true };
  }
  return { label: readText(t, true), quoted: false };
}

/** Reads one topic's line (without its indentation). */
function readTopic(text: string): { topic: MindmapTopic; quoted: boolean } {
  for (const shape of ORDER) {
    const [open, close] = SHAPES[shape];
    const at = text.indexOf(open);
    if (at >= 0 && text.endsWith(close) && at + open.length <= text.length - close.length) {
      const id = text.slice(0, at).trim();
      if (/\s/.test(id)) continue;
      const { label, quoted } = shapeText(text.slice(at + open.length, text.length - close.length));
      return {
        topic: { label, shape, id: id || null, decorations: [], children: [] },
        quoted,
      };
    }
  }
  // A topic without a shape is its text, quotes and all.
  return {
    topic: {
      label: readText(text, true),
      shape: 'default',
      id: null,
      decorations: [],
      children: [],
    },
    quoted: false,
  };
}

/** How a topic is written. */
interface TopicLayout {
  /** Blank lines and comments just before it. */
  leading: string[];
  line: string;
  /** Its indentation, in characters. */
  indent: number;
  quoted: boolean;
  /** Its icon and class lines (with any blank lines and comments among them). */
  after: string[];
  /** The origin of the topic it was under. */
  parent: number | null;
}

export interface MindmapLayout {
  was: Mindmap;
  eol: string;
  firstLine: string;
  tail: string[];
  /** By origin (topics are numbered depth first). */
  topics: TopicLayout[];
  /** Blank lines and comments after the last topic. */
  end: string[];
  /** The usual step between a topic's indentation and its children's. */
  step: number;
}

const readMindmapCode = remembered((code: string): Reading<Mindmap, MindmapLayout> => {
  const source = splitSource(code);
  if (!source) return refuse('The diagram is empty');
  if (source.first !== 'mindmap') return refuse('This isn’t a mind map', source.firstNumber);
  let root: MindmapTopic | null = null;
  const topics: TopicLayout[] = [];
  let pending: string[] = [];
  // Open topics with their indentation, outermost first.
  const stack: { indent: number; topic: MindmapTopic }[] = [];
  let steps: number[] = [];
  for (const { text: raw, number } of source.body) {
    const text = raw.trim();
    if (text === '' || text.startsWith('%%')) {
      pending.push(raw);
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (text.startsWith('::icon(') || text.startsWith(':::')) {
      const owner = stack.at(-1)?.topic;
      if (!owner) return refuse('An icon or class has no topic', number);
      owner.decorations.push(text);
      topics[owner.origin!]!.after.push(...pending, raw);
      pending = [];
      continue;
    }
    const { topic, quoted } = readTopic(text);
    topic.origin = topics.length;
    let parent: MindmapTopic | null = null;
    if (!root) root = topic;
    else {
      while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
      const above = stack.at(-1);
      if (!above) return refuse('A mind map has one central topic', number);
      above.topic.children.push(topic);
      parent = above.topic;
      steps.push(indent - above.indent);
    }
    topics.push({
      leading: pending,
      line: raw,
      indent,
      quoted,
      after: [],
      parent: parent ? parent.origin! : null,
    });
    pending = [];
    stack.push({ indent, topic });
  }
  if (!root) return refuse('The mind map has no topics');
  steps = steps.filter((s) => s > 0);
  const map: Mindmap = { type: 'mindmap', head: source.head, root, source: code };
  return {
    ok: true,
    model: map,
    layout: {
      was: map,
      eol: source.eol,
      firstLine: source.firstLine,
      tail: source.tail,
      topics,
      end: pending,
      step: steps.length ? Math.min(...steps) : 2,
    },
  };
});

/** Reads a mind map from Mermaid code. */
export function parseMindmap(code: string): ParseResult<Mindmap> {
  return modelOf(readMindmapCode(code));
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

/** What the printer (`mindmapPrint.ts`) writes with; not for use elsewhere. */
export const mindmapSyntax = { readMindmapCode, SHAPES };
