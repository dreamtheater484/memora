import {
  escapeEntities,
  keepEnds,
  readText,
  refuse,
  splitSource,
  writeBreaks,
  type FromOrigin,
  type FromSource,
  type ParseResult,
} from './common';
import { classColour, type DiagramColour } from './palette';
import { indentOf, modelOf, remembered, type Reading } from './source';

/*
 * Flowcharts (§9.4): boxes, arrows and groups, read from Mermaid's flowchart syntax. Lines
 * the model has no place for (styles, clicks, comments, accessibility titles) are kept as
 * written, where they were; syntax it can't read faithfully (the `A@{ … }` shape syntax, edge
 * ids) is refused, so the visual editor never changes a diagram's meaning.
 */

export type FlowDirection = 'TB' | 'BT' | 'LR' | 'RL';

export const FLOW_SHAPES = [
  'rect',
  'round',
  'stadium',
  'diamond',
  'circle',
  'hexagon',
  'parallelogram',
  'cylinder',
  'subroutine',
  'double-circle',
  'asymmetric',
  'parallelogram-alt',
  'trapezoid',
  'trapezoid-alt',
] as const;
export type FlowShape = (typeof FLOW_SHAPES)[number];

export type FlowLine = 'solid' | 'dotted' | 'thick' | 'invisible';
export type FlowHead = 'none' | 'arrow' | 'circle' | 'cross';

export interface FlowNode extends FromOrigin {
  id: string;
  label: string;
  shape: FlowShape;
  colour: DiagramColour | null;
  /** Other classes given with `:::name`. */
  classes: string[];
  /** The group it is in. */
  group: string | null;
}

export interface FlowEdge extends FromOrigin {
  from: string;
  to: string;
  label: string;
  line: FlowLine;
  start: FlowHead;
  end: FlowHead;
  /** Extra length (`--->` is one longer than `-->`), which spaces the boxes further apart. */
  extra: number;
}

export interface FlowGroup extends FromOrigin {
  id: string;
  label: string;
  parent: string | null;
  direction: FlowDirection | null;
}

export interface Flowchart extends FromSource {
  type: 'flowchart';
  head: string[];
  keyword: 'flowchart' | 'graph';
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: FlowGroup[];
  /** Statements kept as written (styles, clicks, comments…), where they were. */
  extras: string[];
}

const SHAPES: Record<FlowShape, [open: string, close: string]> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  cylinder: ['[(', ')]'],
  circle: ['((', '))'],
  'double-circle': ['(((', ')))'],
  asymmetric: ['>', ']'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  parallelogram: ['[/', '/]'],
  'parallelogram-alt': ['[\\', '\\]'],
  trapezoid: ['[/', '\\]'],
  'trapezoid-alt': ['[\\', '/]'],
};

/** Openers, longest first, with the shapes each can close as. */
const OPENERS: [string, FlowShape[]][] = [
  ['(((', ['double-circle']],
  ['((', ['circle']],
  ['([', ['stadium']],
  ['(', ['round']],
  ['[[', ['subroutine']],
  ['[(', ['cylinder']],
  ['[/', ['parallelogram', 'trapezoid']],
  ['[\\', ['parallelogram-alt', 'trapezoid-alt']],
  ['[', ['rect']],
  ['{{', ['hexagon']],
  ['{', ['diamond']],
  ['>', ['asymmetric']],
];

const ID = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[-.](?=[\p{L}\p{N}_]))*/u;
const DIRECTIONS: Record<string, FlowDirection> = {
  TB: 'TB',
  TD: 'TB',
  BT: 'BT',
  LR: 'LR',
  RL: 'RL',
};
const HEADS: Record<string, FlowHead> = { '<': 'arrow', '>': 'arrow', x: 'cross', o: 'circle' };

/** Words Mermaid reads as keywords, never as a box. */
const KEYWORD_IDS = new Set([
  'end',
  'subgraph',
  'graph',
  'flowchart',
  'style',
  'linkStyle',
  'class',
  'classDef',
  'click',
  'call',
]);

/** A valid id for a node or group. */
export const isFlowId = (id: string): boolean => ID.exec(id)?.[0] === id && !KEYWORD_IDS.has(id);

interface NodeRef {
  id: string;
  label?: string;
  shape?: FlowShape;
  classes: string[];
}

interface Link {
  line: FlowLine;
  start: FlowHead;
  end: FlowHead;
  extra: number;
  label: string;
}

class Unreadable extends Error {}

/*
 * Labels. Mermaid trims them, and takes brackets, bars, quotes and `@` for syntax, so a label
 * with those is quoted (`"` inside as `#quot;`); spaces at either end are entities. An empty
 * box or group is `[" "]`, which Mermaid reads as an empty label.
 */
const NEEDS_QUOTES = /["[\](){}|@<>]|^[/\\]|[/\\]$/;

function labelText(label: string, quote = false): string {
  if (label === '') return '" "';
  const text = keepEnds(writeBreaks(escapeEntities(label)));
  if (!quote && !NEEDS_QUOTES.test(label)) return text;
  // A quoted text between backticks would be read as Markdown.
  const safe = /^`.*`$/s.test(text) ? `#96;${text.slice(1)}` : text;
  return `"${safe.replace(/"/g, '#quot;')}"`;
}

/** Reads a label: quoted or not, trimmed (as Mermaid does), with entities and `<br>` read. */
function readFlowLabel(raw: string): string {
  let text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  return readText(text);
}

/** Reads a node at `i`: its id, and its shape and label when given. */
function readNode(s: string, i: number): { node: NodeRef; next: number; quoted: boolean } {
  const id = ID.exec(s.slice(i))?.[0];
  if (!id) throw new Unreadable('Expected a box');
  let next = i + id.length;
  const node: NodeRef = { id, classes: [] };
  let quoted = false;
  if (s[next] === '@') throw new Unreadable('The `@{ … }` syntax isn’t supported yet');
  const opener = OPENERS.find(([open]) => s.startsWith(open, next));
  if (opener) {
    const [open, shapes] = opener;
    let at = next + open.length;
    let label: string;
    const lead = /^\s*/.exec(s.slice(at))![0].length;
    if (s[at + lead] === '"') {
      const end = s.indexOf('"', at + lead + 1);
      if (end < 0) throw new Unreadable('A label’s quotes aren’t closed');
      label = s.slice(at, end + 1);
      at = end + 1;
      at += /^\s*/.exec(s.slice(at))![0].length;
      quoted = true;
    } else {
      // Unquoted: up to the first closer one of the shapes allows.
      const ends = shapes
        .map((shape) => ({ shape, at: s.indexOf(SHAPES[shape][1], at) }))
        .filter((e) => e.at >= 0)
        .sort((a, b) => a.at - b.at);
      if (!ends.length) throw new Unreadable('A box’s brackets aren’t closed');
      label = s.slice(at, ends[0]!.at);
      at = ends[0]!.at;
    }
    const shape = shapes.find((sh) => s.startsWith(SHAPES[sh][1], at));
    if (!shape) throw new Unreadable('A box’s brackets aren’t closed');
    node.shape = shape;
    node.label = readFlowLabel(label);
    next = at + SHAPES[shape][1].length;
  }
  while (s.startsWith(':::', next)) {
    const name = /^:::([\w-]+)/.exec(s.slice(next));
    if (!name) throw new Unreadable('A class name is missing');
    node.classes.push(name[1]!);
    next += name[0].length;
  }
  return { node, next, quoted };
}

const skipSpace = (s: string, i: number) => {
  while (i < s.length && /\s/.test(s[i]!)) i += 1;
  return i;
};

interface ReadLink {
  link: Link;
  next: number;
  /** Where the arrow ends (before a `|label|`). */
  arrowEnd: number;
  /** Where a `-- label -->` label is, in the statement. */
  middle: [number, number] | null;
  quoted: boolean;
}

/** Reads a link at `i` (after spaces): `-->`, `-- text -->`, `-.->`, `==>|text|`, `~~~`… */
function readLink(s: string, i: number): ReadLink | null {
  const rest = s.slice(i);
  let at = 0;
  let start: FlowHead = 'none';
  if (/^[<xo][-=]/.test(rest)) {
    start = HEADS[rest[0]!]!;
    at = 1;
  }
  const body = rest.slice(at);
  let link: Link | null = null;
  let used = 0;
  let middle: [number, number] | null = null;
  const invisible = /^~~~+/.exec(rest);
  if (invisible) {
    link = {
      line: 'invisible',
      start: 'none',
      end: 'none',
      extra: invisible[0].length - 3,
      label: '',
    };
    used = invisible[0].length;
  }
  const dotted = link ? null : /^-(\.+)-([>xo])?/.exec(body);
  const solid = /^(-{2,})([>xo])?/.exec(body);
  const thick = /^(={2,})([>xo])?/.exec(body);
  if (dotted) {
    link = {
      line: 'dotted',
      start,
      end: dotted[2] ? HEADS[dotted[2]]! : 'none',
      extra: dotted[1]!.length - 1,
      label: '',
    };
    used = dotted[0].length;
  } else if (solid || thick) {
    const match = (solid ?? thick)!;
    const run = match[1]!.length;
    const line: FlowLine = solid ? 'solid' : 'thick';
    if (match[2]) {
      link = { line, start, end: HEADS[match[2]]!, extra: run - 2, label: '' };
      used = match[0].length;
    } else if (run >= 3) {
      link = { line, start, end: 'none', extra: run - 3, label: '' };
      used = run;
    }
  }
  // Text in the middle: `-- text -->`, `== text ==>`, `-. text .->`.
  if (!link) {
    const text = /^(--|==|-\.)\s/.exec(body);
    if (!text) return null;
    const kind = text[1]!;
    const ending =
      kind === '--'
        ? /\s(-{2,})([>xo])|\s(-{3,})/g
        : kind === '=='
          ? /\s(={2,})([>xo])|\s(={3,})/g
          : /\s(\.+)-([>xo])?/g;
    ending.lastIndex = 2;
    const found = ending.exec(body);
    if (!found) return null;
    const raw = body.slice(2, found.index);
    const label = raw.trim();
    const lead = raw.length - raw.trimStart().length;
    middle = [i + at + 2 + lead, i + at + 2 + lead + label.length];
    const endHead = found[2] ? HEADS[found[2]]! : 'none';
    const run = (found[1] ?? found[3] ?? '').length;
    const line: FlowLine = kind === '--' ? 'solid' : kind === '==' ? 'thick' : 'dotted';
    const extra = line === 'dotted' ? run - 1 : found[2] ? run - 2 : run - 3;
    link = { line, start, end: endHead, extra: Math.max(0, extra), label: readFlowLabel(label) };
    used = found.index + found[0].length;
  }
  let next = i + at + used;
  const arrowEnd = next;
  let quoted = false;
  // A label between bars: `-->|text|`.
  const bar = skipSpace(s, next);
  if (s[bar] === '|') {
    // A quoted label may hold a bar itself.
    const inner = skipSpace(s, bar + 1);
    const quote = s[inner] === '"' ? s.indexOf('"', inner + 1) : bar;
    const close = s.indexOf('|', quote < 0 ? bar + 1 : quote + 1);
    if (close < 0) throw new Unreadable('An arrow’s label isn’t closed');
    link.label = readFlowLabel(s.slice(bar + 1, close));
    quoted = s[inner] === '"';
    middle = null;
    next = close + 1;
  }
  return { link, next, arrowEnd, middle, quoted };
}

/** A box in a statement, and where it is written. */
export interface RefLayout {
  id: string;
  start: number;
  end: number;
  /** It gives a shape and label (`A[…]`). */
  declares: boolean;
  label: string | null;
  shape: FlowShape | null;
  quoted: boolean;
  classes: string[];
}

interface ListLayout {
  start: number;
  end: number;
  refs: RefLayout[];
}

export interface LinkLayout {
  start: number;
  end: number;
  arrowEnd: number;
  middle: [number, number] | null;
  quoted: boolean;
  link: Link;
  /** The origins of the arrows it makes, in order. */
  edges: number[];
}

/** Reads `A & B` at `i`. */
function readNodes(s: string, i: number): { list: ListLayout; refs: NodeRef[]; next: number } {
  const refs: NodeRef[] = [];
  const list: ListLayout = { start: skipSpace(s, i), end: 0, refs: [] };
  let at = i;
  for (;;) {
    const from = skipSpace(s, at);
    const { node, next, quoted } = readNode(s, from);
    refs.push(node);
    list.refs.push({
      id: node.id,
      start: from,
      end: next,
      declares: node.label !== undefined,
      label: node.label ?? null,
      shape: node.shape ?? null,
      quoted,
      classes: node.classes,
    });
    list.end = next;
    const after = skipSpace(s, next);
    if (s[after] === '&') at = after + 1;
    else return { list, refs, next };
  }
}

/** Splits a line into its statements: at `;`, but not in quotes, brackets or `|labels|`. */
function statementSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  let bar = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    // An entity code's `;` is part of it (Mermaid reads codes before statements).
    const code = c === '#' ? /^#\w+;/.exec(line.slice(i)) : null;
    if (code) {
      i += code[0].length - 1;
      continue;
    }
    if (c === '"') quote = !quote;
    else if (quote) continue;
    else if ('[({'.includes(c)) depth += 1;
    // `id>text]`: an asymmetric box, closed by its `]`.
    else if (c === '>' && /[\p{L}\p{N}_]/u.test(line[i - 1] ?? '')) depth += 1;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === '|' && depth === 0) bar = !bar;
    else if (c === ';' && depth === 0 && !bar) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, line.length]);
  return spans
    .map(([a, b]): [number, number] => {
      const text = line.slice(a, b);
      const lead = text.length - text.trimStart().length;
      return [a + lead, a + lead + text.trim().length];
    })
    .filter(([a, b]) => b > a);
}

export type Statement = { start: number; end: number; text: string } & (
  | { kind: 'extra'; extra: number }
  | { kind: 'subgraph'; group: number; titleOnly: boolean }
  | { kind: 'end'; group: number }
  | { kind: 'direction'; group: number }
  | { kind: 'colourDef'; colour: DiagramColour }
  | { kind: 'colourClass'; colour: DiagramColour; ids: string[] }
  | { kind: 'chain'; lists: ListLayout[]; links: LinkLayout[] }
);

interface LineLayout {
  /** As written (several lines for a multi-line accessible description). */
  text: string;
  indent: string;
  statements: Statement[];
  /** The groups it is in (by origin), outermost first. */
  within: number[];
}

export interface FlowLayout {
  was: Flowchart;
  eol: string;
  firstLine: string;
  tail: string[];
  lines: LineLayout[];
  /** By group origin: its `subgraph` and `end` lines. */
  blocks: { open: number; close: number }[];
}

const readFlowchartCode = remembered((code: string): Reading<Flowchart, FlowLayout> => {
  const source = splitSource(code);
  if (!source) return refuse('The diagram is empty');
  const first = /^(flowchart|graph)(?:\s+(\w+))?\s*;?$/.exec(source.first);
  if (!first) return refuse('This isn’t a flowchart', source.firstNumber);
  const direction = first[2] ? DIRECTIONS[first[2].toUpperCase()] : 'TB';
  if (!direction) return refuse(`“${first[2]}” isn’t a direction`, source.firstNumber);
  const chart: Flowchart = {
    type: 'flowchart',
    head: source.head,
    keyword: first[1] as 'flowchart' | 'graph',
    direction,
    nodes: [],
    edges: [],
    groups: [],
    extras: [],
    source: code,
  };
  const layout: FlowLayout = {
    was: chart,
    eol: source.eol,
    firstLine: source.firstLine,
    tail: source.tail,
    lines: [],
    blocks: [],
  };
  const nodes = new Map<string, FlowNode & { declared: boolean }>();
  /** Groups as read: an auto id is given when the group closes, as Mermaid does. */
  const groups: {
    id: string | null;
    label: string;
    parent: number | null;
    direction: FlowDirection | null;
    mentions: string[];
  }[] = [];
  const stack: number[] = [];
  const closed: number[] = [];
  const mention = (ref: NodeRef) => {
    let node = nodes.get(ref.id);
    if (!node) {
      node = {
        id: ref.id,
        label: ref.id,
        shape: 'rect',
        colour: null,
        classes: [],
        group: null,
        declared: false,
      };
      nodes.set(ref.id, node);
    }
    if (ref.label !== undefined) {
      node.label = ref.label;
      node.shape = ref.shape ?? 'rect';
      node.declared = true;
    }
    for (const name of ref.classes) {
      const colour = classColour(name);
      if (colour) node.colour = colour;
      else if (!node.classes.includes(name)) node.classes.push(name);
    }
    // Mermaid puts a box in the first group to close among those that name it.
    if (stack.length) groups[stack.at(-1)!]!.mentions.push(ref.id);
  };

  const readStatement = (statement: string): Statement => {
    const base = { start: 0, end: statement.length, text: statement };
    const extra = (): Statement => {
      chart.extras.push(statement);
      return { ...base, kind: 'extra', extra: chart.extras.length - 1 };
    };
    const word = /^(\w+)\b/.exec(statement)?.[1];
    if (word === 'subgraph') {
      const rest = statement.slice('subgraph'.length).trim();
      const named = /^([\p{L}\p{N}_-]+)\s*\[(.*)\]$/u.exec(rest);
      let id: string | null;
      let label: string;
      if (named) {
        id = named[1]!;
        label = readFlowLabel(named[2]!);
      } else {
        // A group with only a title is named by it, or by Mermaid when it has spaces.
        label = readFlowLabel(rest);
        const text = rest.replace(/^"|"$/g, '');
        id = /\s/.test(text) ? null : text;
      }
      if (!rest) throw new Unreadable('A group has no name');
      groups.push({ id, label, parent: stack.at(-1) ?? null, direction: null, mentions: [] });
      layout.blocks.push({ open: layout.lines.length, close: -1 });
      stack.push(groups.length - 1);
      return { ...base, kind: 'subgraph', group: groups.length - 1, titleOnly: !named };
    }
    if (word === 'end' && statement === 'end') {
      const group = stack.pop();
      if (group === undefined) throw new Unreadable('“end” without a group');
      groups[group]!.id ??= `subGraph${closed.length}`;
      closed.push(group);
      layout.blocks[group]!.close = layout.lines.length;
      return { ...base, kind: 'end', group };
    }
    if (word === 'direction') {
      const value = DIRECTIONS[statement.slice('direction'.length).trim().toUpperCase()];
      const group = stack.at(-1);
      if (group !== undefined && value) {
        groups[group]!.direction = value;
        return { ...base, kind: 'direction', group };
      }
      return extra();
    }
    if (word === 'classDef') {
      const name = /^classDef\s+([\w-]+)/.exec(statement)?.[1];
      const colour = name ? classColour(name) : null;
      return colour ? { ...base, kind: 'colourDef', colour } : extra();
    }
    if (word === 'class') {
      const match = /^class\s+([^\s]+)\s+([\w-]+)\s*$/.exec(statement);
      const colour = match ? classColour(match[2]!) : null;
      if (!match || !colour) return extra();
      const ids = match[1]!.split(',').map((id) => id.trim());
      // Mermaid colours the boxes named so far; others are left as they are.
      for (const id of ids) {
        const node = nodes.get(id);
        if (node) node.colour = colour;
      }
      return { ...base, kind: 'colourClass', colour, ids };
    }
    if (word && ['style', 'linkStyle', 'click', 'accTitle', 'accDescr', 'title'].includes(word)) {
      return extra();
    }
    // Boxes and arrows: `A[Label] --> B & C -->|yes| D`.
    const lists: ListLayout[] = [];
    const links: LinkLayout[] = [];
    const first = readNodes(statement, 0);
    let { refs: left, next } = first;
    left.forEach((ref) => mention(ref));
    lists.push(first.list);
    for (;;) {
      const at = skipSpace(statement, next);
      if (at >= statement.length) break;
      const found = readLink(statement, at);
      if (!found) {
        const rest = statement.slice(at);
        if (/^\w+@/.test(rest)) throw new Unreadable('Arrow ids (`e1@-->`) aren’t supported yet');
        throw new Unreadable(`Couldn’t read “${rest.slice(0, 30)}”`);
      }
      const right = readNodes(statement, found.next);
      right.refs.forEach((ref) => mention(ref));
      const edges: number[] = [];
      for (const from of left) {
        for (const to of right.refs) {
          edges.push(chart.edges.length);
          chart.edges.push({ from: from.id, to: to.id, ...found.link, origin: chart.edges.length });
        }
      }
      links.push({
        start: at,
        end: found.next,
        arrowEnd: found.arrowEnd,
        middle: found.middle,
        quoted: found.quoted,
        link: found.link,
        edges,
      });
      lists.push(right.list);
      left = right.refs;
      next = right.next;
    }
    return { ...base, kind: 'chain', lists, links };
  };

  const lines = source.body;
  for (let n = 0; n < lines.length; n += 1) {
    const raw = lines[n]!;
    const trimmed = raw.text.trim();
    const line: LineLayout = {
      text: raw.text,
      indent: indentOf(raw.text),
      statements: [],
      within: [...stack],
    };
    if (trimmed.startsWith('%%')) {
      chart.extras.push(trimmed);
      const at = raw.text.indexOf('%%');
      line.statements.push({
        kind: 'extra',
        extra: chart.extras.length - 1,
        start: at,
        end: at + trimmed.length,
        text: trimmed,
      });
    } else if (/^accDescr\s*\{/.test(trimmed)) {
      // A multi-line accessible description, kept whole.
      const block = [trimmed];
      const rawLines = [raw.text];
      while (!block.at(-1)!.includes('}') && n + 1 < lines.length) {
        n += 1;
        block.push(lines[n]!.text.trim());
        rawLines.push(lines[n]!.text);
      }
      chart.extras.push(block.join('\n'));
      line.text = rawLines.join('\n');
      line.statements.push({
        kind: 'extra',
        extra: chart.extras.length - 1,
        start: 0,
        end: line.text.length,
        text: line.text,
      });
    } else {
      for (const [start, end] of statementSpans(raw.text)) {
        try {
          const statement = readStatement(raw.text.slice(start, end));
          line.statements.push({ ...statement, start, end });
        } catch (error) {
          if (error instanceof Unreadable) return refuse(error.message, raw.number);
          throw error;
        }
      }
    }
    layout.lines.push(line);
  }
  if (stack.length) return refuse('A group isn’t closed with “end”');

  for (const g of groups) {
    const id = g.id!;
    if (chart.groups.some((other) => other.id === id))
      return refuse(`The group “${id}” appears twice`);
    chart.groups.push({
      id,
      label: g.label,
      parent: g.parent === null ? null : groups[g.parent]!.id,
      direction: g.direction,
      origin: chart.groups.length,
    });
  }
  // An id used for a group is the group, not a box.
  const groupIds = new Set(chart.groups.map((g) => g.id));
  const claimed = new Set<string>();
  for (const index of closed) {
    for (const id of groups[index]!.mentions) {
      const node = nodes.get(id);
      if (!node || groupIds.has(id) || claimed.has(id)) continue;
      node.group = groups[index]!.id;
      claimed.add(id);
    }
  }
  for (const node of nodes.values()) {
    if (groupIds.has(node.id)) {
      if (node.declared) return refuse(`“${node.id}” is both a box and a group`);
      continue;
    }
    const { declared: _declared, ...rest } = node;
    chart.nodes.push({ ...rest, origin: chart.nodes.length });
  }
  return { ok: true, model: chart, layout };
});

/** Reads a flowchart from Mermaid code. */
export function parseFlowchart(code: string): ParseResult<Flowchart> {
  return modelOf(readFlowchartCode(code));
}

/** What the printer (`flowchartPrint.ts`) writes with; not for use elsewhere. */
export const flowchartSyntax = { labelText, readFlowchartCode, SHAPES };
