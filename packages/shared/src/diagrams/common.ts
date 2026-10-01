/*
 * What every diagram type shares (§9.3, §9.4): Mermaid code split into its head (front
 * matter, directives and comments before the diagram), its first line and its statements;
 * labels quoted and unquoted; and the result of reading code into a model.
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
  /** Its number in the code. */
  firstNumber: number;
  /** Everything after it. */
  body: SourceLine[];
}

/** Splits code into its head, its first line and the rest; null for empty code. */
export function splitSource(code: string): SplitSource | null {
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
    firstNumber: i + 1,
    body: lines.slice(i + 1, end).map((text, n) => ({ text, number: i + n + 2 })),
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

/** Mermaid's entity codes in labels: `#quot;`, `#35;` and the like. */
export function decodeEntities(text: string): string {
  return text.replace(/#(quot|amp|lt|gt|nbsp|\d+);/g, (whole, name: string) => {
    if (/^\d+$/.test(name)) {
      const code = Number(name);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ' }[name] ?? whole;
  });
}

/** A label inside quotes: `"` becomes `#quot;`, line breaks `<br>`. */
export const quoted = (label: string): string =>
  `"${label.replace(/"/g, '#quot;').replace(/\r?\n/g, '<br>')}"`;

/** Label text that needs no quotes in any position: letters, digits and spaces. */
export const isPlainLabel = (label: string): boolean => /^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(label);

/** Reads a label as written: quoted or not, with entities and `<br>` read. */
export function readLabel(raw: string): string {
  let text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  return decodeEntities(text.replace(/<br\s*\/?>/gi, '\n'));
}

/** Indentation used when printing statements. */
export const INDENT = '    ';

/** The head lines, then the rest, as code. */
export const withHead = (head: string[], lines: string[]): string => [...head, ...lines].join('\n');

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
