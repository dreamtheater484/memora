import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { toggleTask } from '../markdown/tasks';
import { insertLink, setHeading, toggleList, toggleWrap } from './commands';
import { currentTable, formatTableAt, insertTable, tableCommands, tableSupport } from './tables';

let view: EditorView;

/** An editor with `text`; `|` marks the cursor (removed from the text). */
function editor(text: string): EditorView {
  const at = text.indexOf('|CURSOR|');
  const doc = at >= 0 ? text.replace('|CURSOR|', '') : text;
  view = new EditorView({
    parent: document.body.appendChild(document.createElement('div')),
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(Math.max(0, at)),
      extensions: [markdown({ base: markdownLanguage }), tableSupport()],
    }),
  });
  return view;
}

afterEach(() => view?.destroy());

const text = () => view.state.doc.toString();
const cursor = () => view.state.selection.main.head;
const key = (name: string, shift = false) =>
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: name, shiftKey: shift }), 'editor');

describe('tables in the editor', () => {
  it('lines up the table and keeps the cursor in its cell', () => {
    editor('| a | bb |\n|-|-|\n| 1 | 2|CURSOR|2 |');
    expect(formatTableAt(view)).toBe(true);
    expect(text()).toBe('| a   | bb  |\n| --- | --- |\n| 1   | 22  |');
    // After the "2" that was typed, before the second one.
    expect(text().slice(cursor() - 1, cursor() + 1)).toBe('22');
    expect(cursor()).toBe(text().lastIndexOf('22') + 1);
  });

  it('moves to the next cell with Tab, adding a row at the end', () => {
    editor('| a | b |\n|---|---|\n| 1|CURSOR| | 2 |');
    expect(key('Tab')).toBe(true);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      '2',
    );
    key('Tab');
    expect(text().split('\n')).toHaveLength(4);
    expect(text().split('\n')[3]).toBe('|     |     |');
    key('Tab', true);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      '2',
    );
  });

  it('goes down a row with Enter, and leaves the table from an empty last row', () => {
    editor('| a | b |\n|---|---|\n| 1 | 2|CURSOR| |');
    key('Enter');
    expect(text().split('\n')).toHaveLength(4);
    key('Enter');
    expect(text()).toBe('| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n');
    expect(cursor()).toBe(text().length);
    expect(currentTable(view.state)).toBeNull();
  });

  it('leaves a blank line before what follows the table', () => {
    editor('| a |\n|---|\n| 1 |\n|  |CURSOR| |\nAfter');
    key('Enter');
    expect(text()).toBe('| a   |\n| --- |\n| 1   |\n\n\n\nAfter');
    expect(cursor()).toBe(text().indexOf('\n\n') + 2);
  });

  it('leaves Tab and Enter alone outside tables and in code blocks', () => {
    editor('```\n| a | b |\n|-|-|\n| 1|CURSOR| |\n```');
    expect(key('Tab')).toBe(false);
    editor('plain|CURSOR| text');
    expect(key('Enter')).toBe(false);
  });

  it('inserts a table of the chosen size with its first header selected', () => {
    editor('Intro|CURSOR|');
    insertTable(view, 2, 1);
    expect(text()).toBe(
      'Intro\n\n| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |\n',
    );
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('Column 1');
  });

  it('runs row and column commands on the table around the cursor', () => {
    editor('| n | x |\n|---|---|\n| 2 | b |\n| 1|CURSOR| | a |');
    tableCommands.sort(view);
    expect(text().split('\n').slice(2)).toEqual(['| 1   | a   |', '| 2   | b   |']);
    tableCommands.insertColumnRight(view);
    expect(text().split('\n')[0]).toBe('| n   |     | x   |');
    tableCommands.align(view, 'right');
    expect(text().split('\n')[1]).toBe('| --- | --: | --- |');
    tableCommands.deleteColumn(view);
    expect(text().split('\n')[0]).toBe('| n   | x   |');
  });
});

describe('formatting commands', () => {
  it('wraps and unwraps the selection', () => {
    editor('make this bold');
    view.dispatch({ selection: EditorSelection.range(5, 9) });
    toggleWrap('**')(view);
    expect(text()).toBe('make **this** bold');
    toggleWrap('**')(view);
    expect(text()).toBe('make this bold');
  });

  it('sets and removes headings on the selected lines', () => {
    editor('## Title|CURSOR|');
    setHeading(3)(view);
    expect(text()).toBe('### Title');
    setHeading(3)(view);
    expect(text()).toBe('Title');
  });

  it('turns lines into lists and back', () => {
    editor('one\ntwo');
    view.dispatch({ selection: EditorSelection.range(0, 7) });
    toggleList('ordered')(view);
    expect(text()).toBe('1. one\n2. two');
    toggleList('task')(view);
    expect(text()).toBe('- [ ] one\n- [ ] two');
    toggleList('task')(view);
    expect(text()).toBe('one\ntwo');
  });

  it('makes a link from the selection, selecting the address to type over', () => {
    editor('see docs');
    view.dispatch({ selection: EditorSelection.range(4, 8) });
    insertLink(view);
    expect(text()).toBe('see [docs](https://)');
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('https://');
  });
});

describe('task boxes in the preview', () => {
  it('toggles the box on the given line only', () => {
    const page = '- [ ] one\n  - [x] two\n1. [ ] three\n> - [ ] quoted\n- no box';
    expect(toggleTask(page, 1).split('\n')[0]).toBe('- [x] one');
    expect(toggleTask(page, 2).split('\n')[1]).toBe('  - [ ] two');
    expect(toggleTask(page, 3).split('\n')[2]).toBe('1. [x] three');
    expect(toggleTask(page, 4).split('\n')[3]).toBe('> - [x] quoted');
    expect(toggleTask(page, 5)).toBe(page);
    expect(toggleTask(page, 99)).toBe(page);
  });
});
