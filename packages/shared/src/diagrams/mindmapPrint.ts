import { EMPTY_TEXT, entity, escapeEntities, keepEnds, writeBreaks } from './common';
import { originsOf, printChecked, sameJson } from './source';
import {
  type Mindmap,
  type MindmapLayout,
  type MindmapTopic,
  mindmapTopics,
  mindmapSyntax,
} from './mindmap';

const { readMindmapCode, SHAPES } = mindmapSyntax;

/*
 * Mind maps written back as Mermaid code (§9.4), changing as little of the code they
 * were read from as possible. Apart from the reading, so that what only reads diagrams
 * (snippets, search) does not load the writing.
 */

/*
 * Topic text. A topic without a shape is read as written, so brackets (which would start a
 * shape), and an icon's or a comment's start, are written as entities. A topic with a shape
 * is quoted unless it is plain words (a `-` or a bracket next to the shape's own would make
 * another shape), with `"` as `#quot;`. Mermaid has no empty topic, so one is written as
 * EMPTY_TEXT.
 */
function plainText(label: string): string {
  if (label === '') return EMPTY_TEXT;
  let text = writeBreaks(escapeEntities(label)).replace(/[()[\]{}]/g, entity);
  if (text.startsWith(':::') || text.startsWith('%%')) text = entity(text[0]!) + text.slice(1);
  return keepEnds(text);
}

/** Text a shape holds without quotes. */
const PLAIN_SHAPE_TEXT = /^[\p{L}\p{N}](?:[^()[\]{}"\n]*[\p{L}\p{N}.!?])?$/u;

function shapedText(label: string, quote: boolean): string {
  if (label === '') return EMPTY_TEXT;
  const text = writeBreaks(escapeEntities(label));
  if (!quote && PLAIN_SHAPE_TEXT.test(label)) return text;
  // A quoted text between backticks would be read as Markdown.
  const safe = /^`.*`$/s.test(text) ? `#96;${text.slice(1)}` : text;
  return `"${safe.replace(/"/g, '#quot;')}"`;
}

/** A topic's line, without its indentation. */
function topicText(topic: MindmapTopic, quote: boolean): string {
  if (topic.shape === 'default') return plainText(topic.label);
  const [open, close] = SHAPES[topic.shape];
  return `${topic.id ?? ''}${open}${shapedText(topic.label, quote)}${close}`;
}

/** Moves lines by `delta` characters of indentation. */
function shift(lines: string[], delta: number): string[] {
  if (!delta) return lines;
  return lines.map((line) => {
    if (line.trim() === '') return line;
    const own = line.length - line.trimStart().length;
    return ' '.repeat(Math.max(0, own + delta)) + line.trimStart();
  });
}

/** Whether a topic's own line says the same. */
const sameLine = (a: MindmapTopic, b: MindmapTopic) =>
  a.label === b.label && a.shape === b.shape && (a.shape === 'default' || a.id === b.id);

function writeMindmap(map: Mindmap, layout: MindmapLayout | null): string {
  const out = [layout?.firstLine ?? 'mindmap'];
  const was = layout ? mindmapTopics(layout.was).map((t) => t.topic) : [];
  const step = layout?.step ?? 2;
  const seen = new Set<number>();
  const originOf = (topic: MindmapTopic) => originsOf([topic], was.length, seen)[0]!;
  /**
   * Writes a topic: where it was when that is still under its parent (`above`) and no deeper
   * than the topic before it at its level (`before`), else at `fallback`, with what is under it.
   */
  const write = (
    topic: MindmapTopic,
    above: number,
    before: number | null,
    fallback: number,
    wanted: number | null,
  ) => {
    const origin = originOf(topic);
    const own = origin === null ? null : layout!.topics[origin]!;
    const fits = (x: number | null) => x !== null && x > above && (before === null || x <= before);
    const at = fits(wanted) ? wanted! : fallback;
    let delta = 0;
    if (own) {
      delta = at - own.indent;
      out.push(...own.leading);
      const same = sameLine(topic, was[origin!]!);
      if (same && !delta) out.push(own.line);
      else {
        const text = same ? own.line.trimStart() : topicText(topic, own.quoted);
        out.push(' '.repeat(at) + text);
      }
      if (sameJson(topic.decorations, was[origin!]!.decorations))
        out.push(...shift(own.after, delta));
      else {
        const first = own.after.find((l) => /^\s*:/.test(l));
        const inset = first ? first.length - first.trimStart().length - own.indent : step;
        out.push(...topic.decorations.map((d) => ' '.repeat(at + Math.max(1, inset)) + d));
      }
    } else {
      out.push(' '.repeat(at) + topicText(topic, false));
      out.push(...topic.decorations.map((d) => ' '.repeat(at + step) + d));
    }
    // Children: where they were (moved with this topic), else as their first, or one step in.
    const firstChild = own ? layout!.topics.find((t) => t.parent === origin) : undefined;
    const childAt = firstChild ? firstChild.indent + delta : at + step;
    let previous: number | null = null;
    for (const child of topic.children) {
      const childOrigin = typeof child.origin === 'number' ? child.origin : null;
      const childOwn = childOrigin === null || !layout ? undefined : layout.topics[childOrigin];
      const wantedChild = childOwn && childOwn.parent === origin ? childOwn.indent + delta : null;
      const fallbackChild: number = previous ?? (childAt > at ? childAt : at + step);
      previous = write(child, at, previous, fallbackChild, wantedChild);
    }
    return at;
  };
  const rootOwn =
    layout && typeof map.root.origin === 'number' ? layout.topics[map.root.origin] : undefined;
  const rootAt = rootOwn ? rootOwn.indent : (layout?.topics[0]?.indent ?? 2);
  write(map.root, -1, null, rootAt, rootAt);
  out.push(...(layout?.end ?? []));
  return [...map.head, ...out, ...(layout?.tail ?? [])].join(layout?.eol ?? '\n');
}

const topicMeaning = (topic: MindmapTopic): unknown => ({
  label: topic.label,
  shape: topic.shape,
  id: topic.shape === 'default' ? null : topic.id,
  decorations: topic.decorations,
  children: topic.children.map(topicMeaning),
});

/** What a mind map means, without how its code is written (for comparing two of them). */
export const mindmapMeaning = (map: Mindmap) => ({ head: map.head, root: topicMeaning(map.root) });

/** Writes a mind map as Mermaid code. */
export function printMindmap(map: Mindmap): string {
  return printChecked(map, readMindmapCode, writeMindmap, (a, b) =>
    sameJson(mindmapMeaning(a), mindmapMeaning(b)),
  );
}
