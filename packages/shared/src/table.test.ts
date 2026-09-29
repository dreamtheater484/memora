import { describe, expect, it } from 'vitest';
import {
  alignColumn,
  cellAt,
  cellStart,
  deleteColumn,
  deleteRow,
  displayWidth,
  formatAllTables,
  formatTable,
  formatTableText,
  insertColumn,
  insertRow,
  isDelimiterRow,
  moveColumn,
  parseTable,
  sortByColumn,
  splitCells,
  tableFromTsv,
} from './table';

/** Every line of a formatted table has its pipes in the same display columns. */
function pipeColumns(line: string): number[] {
  const columns: number[] = [];
  let width = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '\\') {
      width += displayWidth(line.slice(i, i + 2));
      i += 1;
      continue;
    }
    if (ch === '|') columns.push(width);
    // Whole grapheme clusters, so an emoji with modifiers counts once.
    const cluster = [...new Intl.Segmenter().segment(line.slice(i))][0]!.segment;
    width += displayWidth(cluster);
    i += cluster.length - 1;
  }
  return columns;
}

function expectAligned(lines: string[]) {
  const first = pipeColumns(lines[0]!);
  for (const line of lines) expect(pipeColumns(line)).toEqual(first);
}

const fixtures: Record<string, string> = {
  plain: '| a | b |\n|---|---|\n| longer text | x |',
  emoji: '| Mood | Note |\n| --- | --- |\n| 😀 | happy |\n| 👍🏽 thumbs | ok |\n| 👨‍👩‍👧 | family |',
  cjk: '| 名前 | 説明 |\n|--|--|\n| 東京 | 日本の首都 |\n| 서울 | 한국 |\n| abc | 中文字符 |',
  pipes: '| Code | Meaning |\n|---|---|\n| `a \\| b` | or |\n| x \\| y | escaped |',
  aligned:
    '| Left | Centre | Right |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| long left | mid | 1,000.50 |',
  ragged: '| a | b | c |\n|---|---|---|\n| only one |\n| 1 | 2 | 3 | 4 |',
  bare: 'a | b\n--|--\n1 | 2',
};

describe('table formatting', () => {
  for (const [name, source] of Object.entries(fixtures)) {
    it(`lines up the columns: ${name}`, () => {
      const formatted = formatTableText(source).split('\n');
      expectAligned(formatted);
      // Formatting again changes nothing.
      expect(formatTableText(formatted.join('\n'))).toBe(formatted.join('\n'));
      // No cell text is lost.
      const before = parseTable(source.split('\n'))!;
      const after = parseTable(formatted)!;
      expect(after.header.slice(0, before.header.length)).toEqual(before.header);
      before.rows.forEach((row, i) => expect(after.rows[i]!.slice(0, row.length)).toEqual(row));
    });
  }

  it('writes aligned Markdown with the alignment markers', () => {
    expect(formatTableText(fixtures.aligned!)).toBe(
      [
        '| Left      | Centre |    Right |',
        '| :-------- | :----: | -------: |',
        '| 1         |   2    |        3 |',
        '| long left |  mid   | 1,000.50 |',
      ].join('\n'),
    );
  });

  it('counts wide characters twice', () => {
    expect(displayWidth('東京')).toBe(4);
    expect(displayWidth('😀')).toBe(2);
    expect(displayWidth('👨‍👩‍👧')).toBe(2);
    expect(formatTableText(fixtures.cjk!).split('\n')[2]).toBe('| 東京 | 日本の首都 |');
  });

  it('splits cells where the preview does: escaped pipes stay in the cell', () => {
    expect(splitCells('| `a \\| b` | c |').map((c) => c.text)).toEqual(['`a \\| b`', 'c']);
    expect(splitCells('a | b').map((c) => c.text)).toEqual(['a', 'b']);
    expect(splitCells('| a | b').map((c) => c.text)).toEqual(['a', 'b']);
  });

  it('keeps cells beyond the header, adding empty header cells', () => {
    const lines = formatTableText(fixtures.ragged!).split('\n');
    expect(lines[0]).toBe('| a        | b   | c   |     |');
    expect(lines[2]).toBe('| only one |     |     |     |');
  });

  it('recognises delimiter rows', () => {
    expect(isDelimiterRow('|---|:-:|')).toBe(true);
    expect(isDelimiterRow('--|--')).toBe(true);
    expect(isDelimiterRow('| a | b |')).toBe(false);
    expect(isDelimiterRow('---')).toBe(true);
    expect(parseTable(['a', 'b'])).toBeNull();
  });

  it('formats every table in a page, but never inside code blocks', () => {
    const page = ['Intro', '', '|a|b|', '|-|-|', '|1|22|', '', '```', '|x|y|', '|-|-|', '```'].join(
      '\n',
    );
    expect(formatAllTables(page).split('\n')).toEqual([
      'Intro',
      '',
      '| a   | b   |',
      '| --- | --- |',
      '| 1   | 22  |',
      '',
      '```',
      '|x|y|',
      '|-|-|',
      '```',
    ]);
  });
});

describe('positions in a table line', () => {
  it('finds the cell and the offset in its text, and back', () => {
    const line = '| alpha | beta  |';
    expect(cellAt(line, 3)).toEqual({ col: 0, offset: 1 });
    expect(cellAt(line, 12)).toEqual({ col: 1, offset: 2 });
    expect(cellStart(line, 1)).toBe(10);
    // Past the text: the end of the text.
    expect(cellAt(line, 15)).toEqual({ col: 1, offset: 4 });
  });
});

describe('table commands', () => {
  const table = parseTable(['| n | name |', '|--|--|', '| 10 | b |', '| 9 | a |', '|  | c |'])!;

  it('inserts and deletes rows and columns', () => {
    expect(insertRow(table, 1).rows[1]).toEqual(['', '']);
    expect(deleteRow(table, 0).rows).toHaveLength(2);
    const wider = insertColumn(table, 1);
    expect(wider.header).toEqual(['n', '', 'name']);
    expect(wider.align).toEqual(['none', 'none', 'none']);
    expect(deleteColumn(wider, 1)).toEqual(table);
    expect(deleteColumn(deleteColumn(table, 0), 0).header).toEqual(['name']);
  });

  it('moves and aligns columns', () => {
    const moved = moveColumn(table, 0, 1);
    expect(moved.header).toEqual(['name', 'n']);
    expect(moved.rows[0]).toEqual(['b', '10']);
    expect(moveColumn(table, 0, -1)).toBe(table);
    expect(alignColumn(table, 1, 'right').align).toEqual(['none', 'right']);
  });

  it('sorts numbers by value and puts empty cells last', () => {
    expect(sortByColumn(table, 0).rows.map((r) => r[0])).toEqual(['9', '10', '']);
    expect(sortByColumn(table, 1, true).rows.map((r) => r[1])).toEqual(['c', 'b', 'a']);
  });

  it('turns cells copied from a spreadsheet into a table', () => {
    const pasted = tableFromTsv('Name\tQty\r\nPen | blue\t2\r\n');
    expect(pasted).toEqual({
      header: ['Name', 'Qty'],
      align: ['none', 'none'],
      rows: [['Pen \\| blue', '2']],
    });
    expect(formatTable(pasted!)[2]).toBe('| Pen \\| blue | 2   |');
    expect(tableFromTsv('just text')).toBeNull();
  });
});
