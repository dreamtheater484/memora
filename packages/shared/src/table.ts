import stringWidth from 'string-width';

/*
 * Markdown table formatting (§9.3): pads every cell to the widest one in its column, so a
 * table reads as a grid in the source view. Widths are measured as displayed (emoji and
 * Chinese, Japanese and Korean characters take two columns). Cells split exactly where the
 * preview splits them (GFM): at every `|` that isn't escaped, inside inline code too, so the
 * source and the rendered table always agree.
 */

export type Align = 'none' | 'left' | 'center' | 'right';

export interface Table {
  header: string[];
  align: Align[];
  rows: string[][];
}

/** Columns in the source that a string takes. */
export const displayWidth = (text: string): number => stringWidth(text);

/** Where a line's cells start and end (in characters), with their trimmed text. */
export interface Cell {
  text: string;
  /** First and last character of the cell's area, between its pipes. */
  from: number;
  to: number;
}

/** Splits a table line into cells: unescaped pipes separate them; outer pipes are optional. */
export function splitCells(line: string): Cell[] {
  const cells: Cell[] = [];
  let start = 0;
  let i = 0;
  const trimmed = line.trimEnd();
  // A leading pipe opens the first cell.
  const lead = trimmed.length - trimmed.trimStart().length;
  if (trimmed[lead] === '|') {
    i = lead + 1;
    start = i;
  }
  for (; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(cellOf(line, start, i));
      start = i + 1;
    }
  }
  // Text after the last pipe is a cell too, unless the line ended with that pipe.
  if (start < trimmed.length || cells.length === 0) cells.push(cellOf(line, start, trimmed.length));
  return cells;
}

function cellOf(line: string, from: number, to: number): Cell {
  return { text: line.slice(from, to).trim(), from, to };
}

const DELIMITER = /^\s*:?-+:?\s*$/;

/** Whether a line is a table's delimiter row (`| --- | :-: |`). */
export function isDelimiterRow(line: string): boolean {
  if (!line.includes('-')) return false;
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((c) => DELIMITER.test(c.text));
}

function alignOf(text: string): Align {
  const left = text.startsWith(':');
  const right = text.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return 'none';
}

/** Reads a table from its lines (header, delimiter, rows); null if they aren't one. */
export function parseTable(lines: readonly string[]): Table | null {
  if (lines.length < 2 || !isDelimiterRow(lines[1]!)) return null;
  const header = splitCells(lines[0]!).map((c) => c.text);
  const align = splitCells(lines[1]!).map((c) => alignOf(c.text));
  const rows = lines.slice(2).map((line) => splitCells(line).map((c) => c.text));
  return { header, align, rows };
}

/** How many columns the table has: nothing is dropped, so the longest row counts. */
export const columnCount = (table: Table): number =>
  Math.max(table.header.length, table.align.length, ...table.rows.map((r) => r.length), 1);

function pad(text: string, width: number, align: Align): string {
  const gap = Math.max(0, width - displayWidth(text));
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

function delimiter(width: number, align: Align): string {
  if (align === 'center') return `:${'-'.repeat(width - 2)}:`;
  if (align === 'left') return `:${'-'.repeat(width - 1)}`;
  if (align === 'right') return `${'-'.repeat(width - 1)}:`;
  return '-'.repeat(width);
}

/** The table as aligned Markdown lines: `| a   | b |`. */
export function formatTable(table: Table): string[] {
  const count = columnCount(table);
  const fill = (cells: readonly string[]) =>
    Array.from({ length: count }, (_, i) => cells[i] ?? '');
  const header = fill(table.header);
  const rows = table.rows.map(fill);
  const align = Array.from({ length: count }, (_, i) => table.align[i] ?? 'none');
  const widths = header.map((_, col) =>
    Math.max(
      // Room for the delimiter's dashes and colons.
      align[col] === 'center' ? 5 : 3,
      displayWidth(header[col]!),
      ...rows.map((row) => displayWidth(row[col]!)),
    ),
  );
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    line(header.map((text, col) => pad(text, widths[col]!, align[col]!))),
    line(widths.map((width, col) => delimiter(width, align[col]!))),
    ...rows.map((row) => line(row.map((text, col) => pad(text, widths[col]!, align[col]!)))),
  ];
}

/** Formats the table in `text` (its lines only); anything else comes back unchanged. */
export function formatTableText(text: string): string {
  const table = parseTable(text.split('\n'));
  return table ? formatTable(table).join('\n') : text;
}

/** Formats every table in a Markdown text, leaving code blocks alone. */
export function formatAllTables(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (opener && opener[1]![0] === fence[0] && opener[1]!.length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    if (opener) {
      fence = opener[1]!;
      out.push(line);
      continue;
    }
    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && isDelimiterRow(next)) {
      let end = i + 2;
      while (end < lines.length && lines[end]!.trim() !== '' && lines[end]!.includes('|')) end += 1;
      const table = parseTable(lines.slice(i, end));
      if (table) {
        out.push(...formatTable(table));
        i = end - 1;
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Which cell a position in a table line is in, and where in that cell's trimmed text. */
export function cellAt(line: string, ch: number): { col: number; offset: number } {
  const cells = splitCells(line);
  let col = cells.findIndex((c) => ch <= c.to);
  if (col < 0) col = cells.length - 1;
  const cell = cells[col]!;
  return { col, offset: Math.max(0, Math.min(ch - textStart(line, cell), cell.text.length)) };
}

function textStart(line: string, cell: Cell): number {
  const inner = line.slice(cell.from, cell.to);
  return cell.from + (inner.length - inner.trimStart().length);
}

/** Where a cell's text starts in a formatted table line. */
export function cellStart(line: string, col: number): number {
  const cells = splitCells(line);
  const cell = cells[Math.min(col, cells.length - 1)];
  return cell ? textStart(line, cell) : line.length;
}

// Commands on a parsed table (rows are body rows; -1 is the header).

export function insertRow(table: Table, at: number): Table {
  const rows = [...table.rows];
  rows.splice(Math.max(0, at), 0, Array(columnCount(table)).fill(''));
  return { ...table, rows };
}

export function deleteRow(table: Table, at: number): Table {
  if (at < 0) return table;
  return { ...table, rows: table.rows.filter((_, i) => i !== at) };
}

export function insertColumn(table: Table, at: number): Table {
  const add = (cells: readonly string[]) => {
    const next = Array.from({ length: columnCount(table) }, (_, i) => cells[i] ?? '');
    next.splice(at, 0, '');
    return next;
  };
  const align = Array.from({ length: columnCount(table) }, (_, i) => table.align[i] ?? 'none');
  align.splice(at, 0, 'none');
  return { header: add(table.header), align, rows: table.rows.map(add) };
}

export function deleteColumn(table: Table, at: number): Table {
  if (columnCount(table) <= 1) return table;
  const drop = <T>(cells: readonly T[]) => cells.filter((_, i) => i !== at);
  return { header: drop(table.header), align: drop(table.align), rows: table.rows.map(drop) };
}

/** Swaps a column with its neighbour (`by` is -1 or 1). */
export function moveColumn(table: Table, at: number, by: -1 | 1): Table {
  const to = at + by;
  if (to < 0 || to >= columnCount(table)) return table;
  const swap = <T>(cells: readonly T[], empty: T) => {
    const next = Array.from({ length: columnCount(table) }, (_, i) => cells[i] ?? empty);
    [next[at], next[to]] = [next[to]!, next[at]!];
    return next;
  };
  return {
    header: swap(table.header, ''),
    align: swap(table.align, 'none' as Align),
    rows: table.rows.map((r) => swap(r, '')),
  };
}

export function alignColumn(table: Table, at: number, align: Align): Table {
  const next = Array.from({ length: columnCount(table) }, (_, i) => table.align[i] ?? 'none');
  next[at] = align;
  return { ...table, align: next };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sorts the body rows by a column: numbers by value, text alphabetically, empty cells last. */
export function sortByColumn(table: Table, at: number, descending = false): Table {
  const value = (row: readonly string[]) => row[at] ?? '';
  const number = (text: string) => {
    const n = Number(text.replace(/[\s,]/g, ''));
    return text.trim() !== '' && Number.isFinite(n) ? n : null;
  };
  const rows = [...table.rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (!x !== !y) return x ? -1 : 1;
    const nx = number(x);
    const ny = number(y);
    const order = nx !== null && ny !== null ? nx - ny : collator.compare(x, y);
    return descending ? -order : order;
  });
  return { ...table, rows };
}

/** A new empty table of the given size, ready to type in. */
export function emptyTable(columns: number, rows: number): Table {
  return {
    header: Array.from({ length: columns }, (_, i) => `Column ${i + 1}`),
    align: Array(columns).fill('none'),
    rows: Array.from({ length: rows }, () => Array(columns).fill('')),
  };
}

/**
 * Tab-separated text (cells copied from a spreadsheet) as a table, the first row as its
 * header; null when the text isn't a grid of at least two columns.
 */
export function tableFromTsv(text: string): Table | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (!lines.length || !lines.every((l) => l.includes('\t'))) return null;
  const grid = lines.map((l) => l.split('\t').map((c) => escapeCell(c.trim())));
  const width = Math.max(...grid.map((r) => r.length));
  if (width < 2) return null;
  return { header: grid[0]!, align: Array(width).fill('none'), rows: grid.slice(1) };
}

/** Text as it has to be written inside a cell: pipes escaped, line breaks as spaces. */
export const escapeCell = (text: string): string =>
  text.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|');
