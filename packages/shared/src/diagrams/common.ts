/*
 * What every diagram type shares (§9.3, §9.4): Mermaid code split into its head (front
 * matter, directives and comments before the diagram), its first line and its statements;
 * text written so Mermaid reads it back exactly; and the result of reading code into a model.
 */

/** The diagram types Memora edits visually; any other Mermaid diagram is `other`. */
export const DIAGRAM_TYPES = [
  'flowchart',
  'sequence',
  'mindmap',
  'timeline',
  'gantt',
  'pie',
] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];

/** Reading code into a model: the model, or why the visual editor can't take it. */
export type ParseResult<T> = { ok: true; model: T } | { ok: false; reason: string; line?: number };

export const refuse = (
  reason: string,
  line?: number,
): { ok: false; reason: string; line?: number } =>
  line === undefined ? { ok: false, reason } : { ok: false, reason, line };

/*
 * Where a model came from. Every model read from code keeps that code in `source`, and each
 * of its items (boxes, arrows, topics, steps, tasks…) keeps in `origin` which item of that
 * code it is. Both are plain JSON, so they survive `structuredClone`, spreading and
 * `Object.assign`. The printer reads the source again to find each item's statement and its
 * values back then: statements whose items didn't change are written exactly as they were,
 * changed ones are rewritten in place, and new items (with no `origin`) are added at the end
 * of their section. Code that builds or copies items must leave `origin` out of new ones; an
 * origin used twice counts only for the first item that has it.
 */
export interface FromSource {
  /** The code the model was read from (set by the parser; never edit it). */
  source?: string;
}
export interface FromOrigin {
  /** Which item of `source` this is (set by the parser; leave it out of new items). */
  origin?: number;
}

/** One line of the diagram, with its number in the code (1-based) for messages. */
export interface SourceLine {
  text: string;
  number: number;
}

export interface SplitSource {
  /** Front matter, directives, comments and blank lines before the first line, as written. */
  head: string[];
  /** The diagram's first line (`flowchart LR`, `sequenceDiagram`…), trimmed. */
  first: string;
  /** The first line as written. */
  firstLine: string;
  /** Its number in the code. */
  firstNumber: number;
  /** Everything after it, up to the last line with something on it. */
  body: SourceLine[];
  /** The blank lines after that, as written. */
  tail: string[];
  /** The code's line ending: CRLF when every line ends so, LF otherwise. */
  eol: '\n' | '\r\n';
}

/** Splits code into its head, its first line and the rest; null for empty code. */
export function splitSource(code: string): SplitSource | null {
  const eol = /\r\n/.test(code) && !/(^|[^\r])\n|\r(?!\n)/.test(code) ? '\r\n' : '\n';
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const head: string[] = [];
  let i = 0;
  // Front matter: a block between two `---` lines at the very top.
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, n) => n > 0 && line.trim() === '---');
    if (close > 0) {
      head.push(...lines.slice(0, close + 1));
      i = close + 1;
    }
  }
  for (; i < lines.length; i += 1) {
    const text = lines[i]!.trim();
    if (text === '' || text.startsWith('%%')) head.push(lines[i]!);
    else break;
  }
  if (i >= lines.length) return null;
  // Trailing blank lines are not part of the diagram.
  let end = lines.length;
  while (end > i + 1 && lines[end - 1]!.trim() === '') end -= 1;
  return {
    head,
    first: lines[i]!.trim(),
    firstLine: lines[i]!,
    firstNumber: i + 1,
    body: lines.slice(i + 1, end).map((text, n) => ({ text, number: i + n + 2 })),
    tail: lines.slice(end),
    eol,
  };
}

const KEYWORDS: [RegExp, DiagramType][] = [
  [/^(flowchart|graph)\b/, 'flowchart'],
  [/^sequenceDiagram\b/, 'sequence'],
  [/^mindmap\b/, 'mindmap'],
  [/^timeline\b/, 'timeline'],
  [/^gantt\b/, 'gantt'],
  [/^pie\b/, 'pie'],
];

/** The diagram's type, from its first line; `other` for types without a visual editor. */
export function detectDiagram(code: string): DiagramType | 'other' | null {
  const source = splitSource(code);
  if (!source) return null;
  for (const [pattern, type] of KEYWORDS) if (pattern.test(source.first)) return type;
  return 'other';
}

/*
 * Entity codes. Before reading a diagram, Mermaid turns every `#name;` and `#123;` into an
 * entity of the drawing (`&name;`, `&#123;`), whatever the diagram type and whether or not
 * the text is in quotes. So they are how text says what Mermaid's syntax can't: `#quot;` for
 * a quote in quotes, `#59;` for a semicolon where it would end a statement, and `#35;` for a
 * `#` that would otherwise start one of them.
 */
const NAMED: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  bull: '•',
  middot: '·',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  micro: 'µ',
  para: '¶',
  sect: '§',
  cent: '¢',
  pound: '£',
  yen: '¥',
  euro: '€',
  iexcl: '¡',
  iquest: '¿',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  lArr: '⇐',
  rArr: '⇒',
  hArr: '⇔',
  le: '≤',
  ge: '≥',
  ne: '≠',
  asymp: '≈',
  infin: '∞',
  minus: '−',
  radic: '√',
  sum: '∑',
  dagger: '†',
  permil: '‰',
  hearts: '♥',
  spades: '♠',
  clubs: '♣',
  diams: '♦',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  omega: 'ω',
  Delta: 'Δ',
  Omega: 'Ω',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  shy: '­',
};

/** Mermaid's entity codes in labels: `#quot;`, `#35;` and the like. Unknown names stay. */
export function decodeEntities(text: string): string {
  return text.replace(/#(\w+);/g, (whole, name: string) => {
    if (/^\d+$/.test(name)) {
      const code = Number(name);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name] ?? whole;
  });
}

/** A character as an entity code. */
export const entity = (char: string): string => `#${char.codePointAt(0)};`;

/**
 * What any text needs before Mermaid reads it: a `#` that Mermaid would take for the start of
 * an entity (a user who types `#35;` means those four characters) and a `<br>` the user typed
 * (which would become a line break) are written as entities.
 */
export const escapeEntities = (text: string): string =>
  text.replace(/#(?=\w+;)/g, '#35;').replace(/<(?=br\s*\/?>)/gi, '#lt;');

/** Line breaks as `<br>`, which every diagram type reads as one. */
export const writeBreaks = (text: string): string => text.replace(/\r\n?|\n/g, '<br>');

/**
 * Whitespace at either end as entities: Mermaid and Memora trim what they read, and the
 * editor writes the code on every keystroke, so "Hello " must read back as "Hello " for the
 * next letter to land after the space.
 */
export function keepEnds(text: string): string {
  const start = /^\s+/.exec(text)?.[0] ?? '';
  const rest = text.slice(start.length);
  const end = /\s+$/.exec(rest)?.[0] ?? '';
  const middle = rest.slice(0, rest.length - end.length);
  const codes = (s: string) => [...s].map(entity).join('');
  return codes(start) + middle + codes(end);
}

/**
 * A value Mermaid can't write empty (a mind map topic, a timeline period or event, a Gantt
 * task or section) is written as this entity instead: a zero-width space, which draws as
 * nothing and which Memora reads back as "". Where Mermaid has its own empty form (a message,
 * a participant's `as`, a pie slice's `""`), that is used instead.
 */
export const EMPTY_TEXT = '#8203;';

/** Text as most statements write it: entities, line breaks and kept ends. */
export const writeText = (text: string): string => keepEnds(writeBreaks(escapeEntities(text)));

/** Reads text written by `writeText` (or by hand): trimmed, `<br>` and entities read. */
export function readText(raw: string, empty = false): string {
  const text = raw.trim();
  if (empty && text === EMPTY_TEXT) return '';
  return decodeEntities(text.replace(/<br\s*\/?>/gi, '\n'));
}

/** A label inside quotes: `"` becomes `#quot;`, line breaks `<br>`. */
export const quoted = (label: string): string =>
  `"${writeBreaks(escapeEntities(label)).replace(/"/g, '#quot;')}"`;

/** Label text that needs no quotes in any position: letters, digits and spaces. */
export const isPlainLabel = (label: string): boolean =>
  /^[\p{L}\p{N}](?:[\p{L}\p{N} ]*[\p{L}\p{N}])?$/u.test(label);

/** Reads a label as written: quoted or not, with entities and `<br>` read. */
export function readLabel(raw: string): string {
  let text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  return decodeEntities(text.replace(/<br\s*\/?>/gi, '\n'));
}

/** Indentation used when printing statements. */
export const INDENT = '    ';

/** The head lines, then the rest, as code. */
export const withHead = (head: string[], lines: string[], eol = '\n'): string =>
  [...head, ...lines].join(eol);

/** Splits on a separator outside double quotes. */
export function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === separator && !inQuotes) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts;
}

/** A number as Mermaid reads it: plain digits, never `1e21`. */
export function writeNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}
