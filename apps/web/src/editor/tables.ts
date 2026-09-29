import {
  alignColumn,
  cellAt,
  cellStart,
  columnCount,
  deleteColumn,
  deleteRow,
  emptyTable,
  formatTable,
  insertColumn,
  insertRow,
  isDelimiterRow,
  moveColumn,
  parseTable,
  sortByColumn,
  type Align,
  type Table,
} from '@memora/shared';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, Facet, Prec, type EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';

/*
 * Tables that line up as you type (§9.3): Tab and Shift+Tab move between cells, Enter to the
 * next row (a new one at the end), and the table is reformatted when you type `|`, pause, or
 * press Ctrl/Cmd+Shift+F. The cursor stays in the same cell, at the same place in its text.
 */

/** Whether tables line up by themselves (the "automatic table formatting" setting). */
export const autoFormatTables = Facet.define<boolean, boolean>({
  combine: (values) => values.at(-1) ?? true,
});

const PAUSE_MS = 700;

export interface TableRange {
  /** Line numbers (1-based) of the header and the last row. */
  first: number;
  last: number;
  table: Table;
  lines: string[];
}

function inCode(state: EditorState, pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!) {
    if (
      ['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock'].includes(node.name)
    ) {
      return true;
    }
    if (!node.parent) break;
  }
  return false;
}

/** The table around a position, found from the text: rows are the lines with pipes around it. */
export function tableAt(state: EditorState, pos: number): TableRange | null {
  const doc = state.doc;
  const here = doc.lineAt(pos);
  const isRow = (n: number) => {
    if (n < 1 || n > doc.lines) return false;
    const text = doc.line(n).text;
    return text.trim() !== '' && text.includes('|');
  };
  if (!isRow(here.number) || inCode(state, pos)) return null;
  let first = here.number;
  while (isRow(first - 1)) first -= 1;
  let last = here.number;
  while (isRow(last + 1)) last += 1;
  // The header is the line above the first delimiter row.
  let header = -1;
  for (let n = first + 1; n <= last; n += 1) {
    if (isDelimiterRow(doc.line(n).text)) {
      header = n - 1;
      break;
    }
  }
  if (header < 0 || header > here.number) return null;
  const lines: string[] = [];
  for (let n = header; n <= last; n += 1) lines.push(doc.line(n).text);
  const table = parseTable(lines);
  return table ? { first: header, last, table, lines } : null;
}

interface Place {
  /** Row among the table's lines: 0 header, 1 delimiter, 2… body. */
  row: number;
  col: number;
  offset: number;
}

function placeOf(state: EditorState, range: TableRange, pos: number): Place {
  const line = state.doc.lineAt(pos);
  const { col, offset } = cellAt(line.text, pos - line.from);
  return { row: line.number - range.first, col, offset };
}

/** Writes `lines` over the table's lines and puts the cursor at `place`. */
function replaceTable(view: EditorView, range: TableRange, lines: string[], place: Place): void {
  const doc = view.state.doc;
  const from = doc.line(range.first).from;
  const to = doc.line(range.last).to;
  const row = Math.max(0, Math.min(place.row, lines.length - 1));
  let anchor = from;
  for (let i = 0; i < row; i += 1) anchor += lines[i]!.length + 1;
  const text = lines[row]!;
  const start = cellStart(text, place.col);
  const cells = text
    .slice(start)
    .split(/(?<!\\)\|/)[0]!
    .trimEnd();
  anchor += start + Math.min(place.offset, cells.length);
  const insert = lines.join('\n');
  if (doc.sliceString(from, to) === insert) {
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    return;
  }
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor },
    scrollIntoView: true,
    userEvent: 'input.format',
  });
}

/** Lines the table up, leaving the cursor where it was in its cell. */
export function formatTableAt(view: EditorView, pos = view.state.selection.main.head): boolean {
  const range = tableAt(view.state, pos);
  if (!range) return false;
  replaceTable(view, range, formatTable(range.table), placeOf(view.state, range, pos));
  return true;
}

function moveCell(view: EditorView, by: 1 | -1): boolean {
  const pos = view.state.selection.main.head;
  const range = tableAt(view.state, pos);
  if (!range) return false;
  const place = placeOf(view.state, range, pos);
  const count = columnCount(range.table);
  let { row, col } = place;
  if (row === 1) row = 0;
  col += by;
  if (col >= count) {
    col = 0;
    row = row === 0 ? 2 : row + 1;
  } else if (col < 0) {
    if (row <= 0) return true;
    col = count - 1;
    row = row === 2 ? 0 : row - 1;
  }
  let table = range.table;
  if (row - 2 >= table.rows.length) table = insertRow(table, table.rows.length);
  replaceTable(view, range, formatTable(table), { row, col, offset: Infinity });
  selectCell(view);
  return true;
}

/** Selects the text of the cell the cursor is in, so typing replaces it. */
function selectCell(view: EditorView) {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const start = cellStart(line.text, cellAt(line.text, pos - line.from).col);
  const text = line.text
    .slice(start)
    .split(/(?<!\\)\|/)[0]!
    .trimEnd();
  view.dispatch({
    selection: EditorSelection.range(line.from + start, line.from + start + text.length),
  });
}

function nextRow(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const range = tableAt(view.state, pos);
  if (!range || !view.state.selection.main.empty) return false;
  const place = placeOf(view.state, range, pos);
  const bodyRow = place.row - 2;
  const row = range.table.rows[bodyRow];
  // Enter on an empty last row leaves the table.
  if (row && bodyRow === range.table.rows.length - 1 && row.every((c) => c === '')) {
    const text = formatTable(deleteRow(range.table, bodyRow)).join('\n');
    const doc = view.state.doc;
    const from = doc.line(range.first).from;
    // The new paragraph goes after a blank line, with a blank line before what follows.
    let next = range.last + 1;
    while (next <= doc.lines && doc.line(next).text.trim() === '') next += 1;
    const rest = next <= doc.lines;
    view.dispatch({
      changes: {
        from,
        to: rest ? doc.line(next).from : doc.length,
        insert: `${text}\n\n${rest ? '\n\n' : ''}`,
      },
      selection: { anchor: from + text.length + 2 },
      scrollIntoView: true,
      userEvent: 'input',
    });
    return true;
  }
  let table = range.table;
  const target = Math.max(2, place.row + 1);
  if (target - 2 >= table.rows.length) table = insertRow(table, table.rows.length);
  // A finished row (the cursor at its end, or the header) continues at the next row's start;
  // from inside a row, Enter goes down the same column.
  const line = view.state.doc.lineAt(pos);
  const atEnd = !line.text.slice(pos - line.from).replace(/[\s|]/g, '');
  const col = place.row <= 1 || atEnd ? 0 : place.col;
  replaceTable(view, range, formatTable(table), { row: target, col, offset: 0 });
  return true;
}

/** Changes the table around the cursor with one of the table commands. */
function withTable(
  view: EditorView,
  change: (
    table: Table,
    place: { row: number; col: number },
  ) => {
    table: Table;
    row?: number;
    col?: number;
  },
): boolean {
  const pos = view.state.selection.main.head;
  const range = tableAt(view.state, pos);
  if (!range) return false;
  const place = placeOf(view.state, range, pos);
  // Body rows count from 0; the header (and its delimiter) is -1.
  const row = place.row <= 1 ? -1 : place.row - 2;
  const result = change(range.table, { row, col: place.col });
  const nextRowIndex = result.row ?? row;
  replaceTable(view, range, formatTable(result.table), {
    row: nextRowIndex < 0 ? 0 : nextRowIndex + 2,
    col: Math.min(result.col ?? place.col, columnCount(result.table) - 1),
    offset: 0,
  });
  return true;
}

export const tableCommands = {
  insertRowAbove: (v: EditorView) =>
    withTable(v, (t, p) => (p.row < 0 ? { table: t } : { table: insertRow(t, p.row) })),
  insertRowBelow: (v: EditorView) =>
    withTable(v, (t, p) => ({ table: insertRow(t, p.row + 1), row: p.row + 1 })),
  deleteRow: (v: EditorView) =>
    withTable(v, (t, p) => ({
      table: deleteRow(t, p.row),
      row: Math.min(p.row, t.rows.length - 2),
    })),
  insertColumnLeft: (v: EditorView) => withTable(v, (t, p) => ({ table: insertColumn(t, p.col) })),
  insertColumnRight: (v: EditorView) =>
    withTable(v, (t, p) => ({ table: insertColumn(t, p.col + 1), col: p.col + 1 })),
  deleteColumn: (v: EditorView) =>
    withTable(v, (t, p) => ({ table: deleteColumn(t, p.col), col: Math.max(0, p.col - 1) })),
  moveColumnLeft: (v: EditorView) =>
    withTable(v, (t, p) => ({ table: moveColumn(t, p.col, -1), col: Math.max(0, p.col - 1) })),
  moveColumnRight: (v: EditorView) =>
    withTable(v, (t, p) => ({ table: moveColumn(t, p.col, 1), col: p.col + 1 })),
  align: (v: EditorView, align: Align) =>
    withTable(v, (t, p) => ({ table: alignColumn(t, p.col, align) })),
  sort: (v: EditorView, descending = false) =>
    withTable(v, (t, p) => ({ table: sortByColumn(t, p.col, descending) })),
  format: (v: EditorView) => formatTableAt(v),
};

/** Whether the cursor is in a table (for showing the table commands). */
export const inTable = (state: EditorState): boolean =>
  tableAt(state, state.selection.main.head) !== null;

/** Inserts a new table of the given size at the cursor, selecting its first header cell. */
export function insertTable(view: EditorView, columns: number, rows: number, table?: Table): void {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const lines = formatTable(table ?? emptyTable(columns, rows));
  const before =
    line.text.trim() === ''
      ? line.number > 1 && state.doc.line(line.number - 1).text.trim() !== ''
        ? '\n'
        : ''
      : '\n\n';
  const at = line.text.trim() === '' ? line.from : line.to;
  const insert = `${before}${lines.join('\n')}\n`;
  const start = at + before.length + 2;
  const first = table?.header[0] ?? 'Column 1';
  view.dispatch({
    changes: { from: at, to: line.text.trim() === '' ? line.to : at, insert },
    selection: EditorSelection.range(start, start + first.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/** Lines tables up after a pause in typing, and whenever a `|` is typed. */
const autoFormat = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged || !update.state.facet(autoFormatTables)) return;
      const typed = update.transactions.some(
        (tr) => tr.isUserEvent('input.type') || tr.isUserEvent('delete'),
      );
      if (!typed) return;
      clearTimeout(this.timer);
      const pipe = update.transactions.some((tr) => {
        let found = false;
        tr.changes.iterChanges((_a, _b, _c, _d, inserted) => {
          if (inserted.toString() === '|') found = true;
        });
        return found && tr.isUserEvent('input.type');
      });
      const run = () => {
        const { state } = this.view;
        const { head, empty } = state.selection.main;
        if (this.view.composing || !empty) return;
        // A space just typed at the end of a cell would be trimmed away: wait for more.
        if (!pipe && /\s/.test(state.doc.sliceString(head - 1, head))) return;
        if (tableAt(state, head)) formatTableAt(this.view);
      };
      // Not inside the update: dispatching there is not allowed.
      this.timer = setTimeout(run, pipe ? 0 : PAUSE_MS);
    }

    destroy() {
      clearTimeout(this.timer);
    }
  },
);

export function tableSupport() {
  return [
    Prec.high(
      keymap.of([
        { key: 'Tab', run: (v) => moveCell(v, 1) },
        { key: 'Shift-Tab', run: (v) => moveCell(v, -1) },
        { key: 'Enter', run: nextRow },
        { key: 'Mod-Shift-f', run: (v) => formatTableAt(v), preventDefault: true },
      ]),
    ),
    autoFormat,
  ];
}

/** For tests and the grid editor: the table the cursor is in, parsed. */
export function currentTable(state: EditorState): TableRange | null {
  return tableAt(state, state.selection.main.head);
}

/** Replaces the table around the cursor with another one (the grid editor's result). */
export function replaceCurrentTable(view: EditorView, table: Table): boolean {
  const range = currentTable(view.state);
  if (!range) return false;
  replaceTable(view, range, formatTable(table), { row: 0, col: 0, offset: 0 });
  return true;
}
