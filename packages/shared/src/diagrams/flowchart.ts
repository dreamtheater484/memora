import {
  INDENT,
  isPlainLabel,
  quoted,
  readLabel,
  refuse,
  splitOutsideQuotes,
  splitSource,
  withHead,
  type ParseResult,
} from './common';
import { classColour, colourClass, colourDefinition, type DiagramColour } from './palette';

/*
 * Flowcharts (§9.4): boxes, arrows and groups, read from Mermaid's flowchart syntax and
 * written back in a tidy standard layout. Lines the model has no place for (styles, clicks,
 * comments, accessibility titles) are kept as written; syntax it can't read faithfully (the
 * `A@{ … }` shape syntax, edge ids) is refused, so the visual editor never changes a diagram's
 * meaning.
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

export interface FlowNode {
  id: string;
  label: string;
  shape: FlowShape;
  colour: DiagramColour | null;
  /** Other classes given with `:::name`. */
  classes: string[];
  /** The group it is in. */
  group: string | null;
}

export interface FlowEdge {
  from: string;
  to: string;
  label: string;
  line: FlowLine;
  start: FlowHead;
  end: FlowHead;
  /** Extra length (`--->` is one longer than `-->`), which spaces the boxes further apart. */
  extra: number;
}

export interface FlowGroup {
  id: string;
  label: string;
  parent: string | null;
  direction: FlowDirection | null;
}

export interface Flowchart {
  type: 'flowchart';
  head: string[];
  keyword: 'flowchart' | 'graph';
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: FlowGroup[];
  /** Statements kept as written, after everything else. */
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

/** A valid id for a node or group. */
export const isFlowId = (id: string): boolean => ID.exec(id)?.[0] === id && id !== 'end';

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

/** Reads a node at `i`: its id, and its shape and label when given. */
function readNode(s: string, i: number): { node: NodeRef; next: number } {
  const id = ID.exec(s.slice(i))?.[0];
  if (!id) throw new Unreadable('Expected a box');
  let next = i + id.length;
  const node: NodeRef = { id, classes: [] };
  if (s[next] === '@') throw new Unreadable('The `@{ … }` syntax isn’t supported yet');
  const opener = OPENERS.find(([open]) => s.startsWith(open, next));
  if (opener) {
    const [open, shapes] = opener;
    let at = next + open.length;
    let label: string;
    if (s[at] === '"') {
      const end = s.indexOf('"', at + 1);
      if (end < 0) throw new Unreadable('A label’s quotes aren’t closed');
      label = s.slice(at, end + 1);
      at = end + 1;
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
    node.label = readLabel(label);
    next = at + SHAPES[shape][1].length;
  }
  while (s.startsWith(':::', next)) {
    const name = /^:::([\w-]+)/.exec(s.slice(next));
    if (!name) throw new Unreadable('A class name is missing');
    node.classes.push(name[1]!);
    next += name[0].length;
  }
  return { node, next };
}

const skipSpace = (s: string, i: number) => {
  while (i < s.length && /\s/.test(s[i]!)) i += 1;
  return i;
};

/** Reads a link at `i` (after spaces): `-->`, `-- text -->`, `-.->`, `==>|text|`, `~~~`… */
function readLink(s: string, i: number): { link: Link; next: number } | null {
  const rest = s.slice(i);
  const invisible = /^~~~+/.exec(rest);
  if (invisible) {
    return {
      link: {
        line: 'invisible',
        start: 'none',
        end: 'none',
        extra: invisible[0].length - 3,
        label: '',
      },
      next: i + invisible[0].length,
    };
  }
  let at = 0;
  let start: FlowHead = 'none';
  if (/^[<xo][-=]/.test(rest)) {
    start = HEADS[rest[0]!]!;
    at = 1;
  }
  const body = rest.slice(at);
  let link: Link | null = null;
  let used = 0;
  const dotted = /^-(\.+)-([>xo])?/.exec(body);
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
    const label = body.slice(2, found.index).trim();
    const endHead = found[2] ? HEADS[found[2]]! : 'none';
    const run = (found[1] ?? found[3] ?? '').length;
    const line: FlowLine = kind === '--' ? 'solid' : kind === '==' ? 'thick' : 'dotted';
    const extra = line === 'dotted' ? run - 1 : found[2] ? run - 2 : run - 3;
    link = { line, start, end: endHead, extra: Math.max(0, extra), label: readLabel(label) };
    used = found.index + found[0].length;
  }
  let next = i + at + used;
  // A label between bars: `-->|text|`.
  const bar = skipSpace(s, next);
  if (s[bar] === '|') {
    // A quoted label may hold a bar itself.
    const quote =
      s[skipSpace(s, bar + 1)] === '"' ? s.indexOf('"', skipSpace(s, bar + 1) + 1) : bar;
    const close = s.indexOf('|', quote < 0 ? bar + 1 : quote + 1);
    if (close < 0) throw new Unreadable('An arrow’s label isn’t closed');
    link.label = readLabel(s.slice(bar + 1, close));
    next = close + 1;
  }
  return { link, next };
}

/** Reads `A & B` at `i`. */
function readNodes(s: string, i: number): { nodes: NodeRef[]; next: number } {
  const nodes: NodeRef[] = [];
  let at = i;
  for (;;) {
    const { node, next } = readNode(s, skipSpace(s, at));
    nodes.push(node);
    const after = skipSpace(s, next);
    if (s[after] === '&') at = after + 1;
    else return { nodes, next };
  }
}

/** Reads a flowchart from Mermaid code. */
export function parseFlowchart(code: string): ParseResult<Flowchart> {
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
  };
  const nodes = new Map<string, FlowNode & { declared: boolean }>();
  const stack: string[] = [];
  const mention = (ref: NodeRef, inGroup = true) => {
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
    if (inGroup && node.group === null && stack.length) node.group = stack.at(-1)!;
  };

  const lines = source.body;
  for (let n = 0; n < lines.length; n += 1) {
    const raw = lines[n]!;
    const trimmed = raw.text.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('%%')) {
      chart.extras.push(trimmed);
      continue;
    }
    // A multi-line accessible description, kept whole.
    if (/^accDescr\s*\{/.test(trimmed)) {
      const block = [trimmed];
      while (!block.at(-1)!.includes('}') && n + 1 < lines.length) {
        n += 1;
        block.push(lines[n]!.text.trim());
      }
      chart.extras.push(block.join('\n'));
      continue;
    }
    for (const part of splitOutsideQuotes(trimmed, ';')) {
      const statement = part.trim();
      if (!statement) continue;
      try {
        readStatement(statement);
      } catch (error) {
        if (error instanceof Unreadable) return refuse(error.message, raw.number);
        throw error;
      }
    }
  }
  if (stack.length) return refuse('A group isn’t closed with “end”');

  function readStatement(statement: string) {
    const word = /^(\w+)\b/.exec(statement)?.[1];
    if (word === 'subgraph') {
      const rest = statement.slice('subgraph'.length).trim();
      const named = /^([\p{L}\p{N}_-]+)\s*\[(.*)\]$/u.exec(rest);
      const id = named ? named[1]! : rest.replace(/^"|"$/g, '');
      const label = named ? readLabel(named[2]!) : readLabel(rest);
      if (!id) throw new Unreadable('A group has no name');
      if (chart.groups.some((g) => g.id === id))
        throw new Unreadable(`The group “${id}” appears twice`);
      chart.groups.push({ id, label, parent: stack.at(-1) ?? null, direction: null });
      stack.push(id);
      return;
    }
    if (word === 'end' && statement === 'end') {
      if (!stack.length) throw new Unreadable('“end” without a group');
      stack.pop();
      return;
    }
    if (word === 'direction') {
      const value = DIRECTIONS[statement.slice('direction'.length).trim().toUpperCase()];
      const group = chart.groups.find((g) => g.id === stack.at(-1));
      if (group && value) group.direction = value;
      else chart.extras.push(statement);
      return;
    }
    if (word === 'classDef') {
      // Memora's own colours are written again from the boxes; others are kept.
      const name = /^classDef\s+([\w-]+)/.exec(statement)?.[1];
      if (!name || !classColour(name)) chart.extras.push(statement);
      return;
    }
    if (word === 'class') {
      const match = /^class\s+([^\s]+)\s+([\w-]+)\s*$/.exec(statement);
      const colour = match ? classColour(match[2]!) : null;
      if (match && colour) {
        for (const id of match[1]!.split(',')) {
          const ref: NodeRef = { id: id.trim(), classes: [] };
          if (!isFlowId(ref.id)) throw new Unreadable(`“${ref.id}” isn’t a box`);
          mention(ref, false);
          nodes.get(ref.id)!.colour = colour;
        }
      } else chart.extras.push(statement);
      return;
    }
    if (word && ['style', 'linkStyle', 'click', 'accTitle', 'accDescr', 'title'].includes(word)) {
      chart.extras.push(statement);
      return;
    }
    // Boxes and arrows: `A[Label] --> B & C -->|yes| D`.
    let { nodes: left, next } = readNodes(statement, 0);
    left.forEach((ref) => mention(ref));
    for (;;) {
      const at = skipSpace(statement, next);
      if (at >= statement.length) return;
      const found = readLink(statement, at);
      if (!found) {
        const rest = statement.slice(at);
        if (/^\w+@/.test(rest)) throw new Unreadable('Arrow ids (`e1@-->`) aren’t supported yet');
        throw new Unreadable(`Couldn’t read “${rest.slice(0, 30)}”`);
      }
      const right = readNodes(statement, found.next);
      right.nodes.forEach((ref) => mention(ref));
      for (const from of left) {
        for (const to of right.nodes) {
          chart.edges.push({ from: from.id, to: to.id, ...found.link });
        }
      }
      left = right.nodes;
      next = right.next;
    }
  }

  // An id used for a group is the group, not a box.
  const groupIds = new Set(chart.groups.map((g) => g.id));
  for (const node of nodes.values()) {
    if (groupIds.has(node.id)) {
      if (node.declared) return refuse(`“${node.id}” is both a box and a group`);
      continue;
    }
    const { declared: _declared, ...rest } = node;
    chart.nodes.push(rest);
  }
  return { ok: true, model: chart };
}

const label = (text: string) => (isPlainLabel(text) ? text : quoted(text));

/** A box as written in its declaration. */
export function nodeSyntax(node: FlowNode): string {
  const classes = node.classes.map((c) => `:::${c}`).join('');
  if (node.label === node.id && node.shape === 'rect') return `${node.id}${classes}`;
  const [open, close] = SHAPES[node.shape];
  return `${node.id}${open}${label(node.label)}${close}${classes}`;
}

/** An arrow as written between two boxes. */
export function linkSyntax(edge: Pick<FlowEdge, 'line' | 'start' | 'end' | 'extra' | 'label'>) {
  const head = (h: FlowHead, start: boolean) =>
    h === 'none' ? '' : h === 'arrow' ? (start ? '<' : '>') : h === 'cross' ? 'x' : 'o';
  const s = head(edge.start, true);
  const e = head(edge.end, false);
  let text: string;
  switch (edge.line) {
    case 'invisible':
      return '~~~';
    case 'dotted':
      text = `${s}-${'.'.repeat(1 + edge.extra)}-${e}`;
      break;
    case 'thick':
      text = e ? `${s}${'='.repeat(2 + edge.extra)}${e}` : `${s}${'='.repeat(3 + edge.extra)}`;
      break;
    default:
      text = e ? `${s}${'-'.repeat(2 + edge.extra)}${e}` : `${s}${'-'.repeat(3 + edge.extra)}`;
  }
  return edge.label ? `${text}|${quoted(edge.label)}|` : text;
}

const directionName = (d: FlowDirection) => (d === 'TB' ? 'TD' : d);

/** Writes a flowchart as Mermaid code. */
export function printFlowchart(chart: Flowchart): string {
  const out = [`${chart.keyword} ${directionName(chart.direction)}`];
  const write = (depth: number, text: string) => out.push(INDENT.repeat(depth) + text);
  const groupLine = (g: FlowGroup) =>
    g.label === g.id && isFlowId(g.id)
      ? `subgraph ${g.id}`
      : `subgraph ${g.id} [${quoted(g.label)}]`;
  const writeGroup = (group: FlowGroup | null, depth: number) => {
    if (group) {
      write(depth, groupLine(group));
      if (group.direction) write(depth + 1, `direction ${group.direction}`);
    }
    const inner = group ? depth + 1 : depth;
    for (const node of chart.nodes) {
      if (node.group === (group?.id ?? null)) write(inner, nodeSyntax(node));
    }
    for (const child of chart.groups) {
      if (child.parent === (group?.id ?? null)) writeGroup(child, inner);
    }
    if (group) write(depth, 'end');
  };
  writeGroup(null, 1);
  for (const edge of chart.edges) write(1, `${edge.from} ${linkSyntax(edge)} ${edge.to}`);
  const colours = new Map<DiagramColour, string[]>();
  for (const node of chart.nodes) {
    if (node.colour) colours.set(node.colour, [...(colours.get(node.colour) ?? []), node.id]);
  }
  for (const [colour, ids] of colours) {
    write(1, colourDefinition(colour));
    write(1, `class ${ids.join(',')} ${colourClass(colour)}`);
  }
  for (const extra of chart.extras) for (const line of extra.split('\n')) write(1, line);
  return withHead(chart.head, out);
}
