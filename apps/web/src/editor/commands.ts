import { EditorSelection, type ChangeSpec, type EditorState, type Line } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/*
 * Writing aids (§9.3): the toolbar, the shortcuts and the slash commands all use these. Each
 * works on every selection, and toggles off what is already there.
 */

type Command = (view: EditorView) => boolean;

/** Wraps each selection in `marker` (`**`, `*`, `~~`, `` ` ``), or unwraps it. */
export function toggleWrap(marker: string): Command {
  return (view) => {
    const { state } = view;
    const size = marker.length;
    view.dispatch(
      state.changeByRange((range) => {
        const before = state.sliceDoc(range.from - size, range.from);
        const after = state.sliceDoc(range.to, range.to + size);
        if (before === marker && after === marker) {
          return {
            changes: [
              { from: range.from - size, to: range.from },
              { from: range.to, to: range.to + size },
            ],
            range: EditorSelection.range(range.from - size, range.to - size),
          };
        }
        const text = state.sliceDoc(range.from, range.to);
        if (text.length >= 2 * size && text.startsWith(marker) && text.endsWith(marker)) {
          return {
            changes: { from: range.from, to: range.to, insert: text.slice(size, -size) },
            range: EditorSelection.range(range.from, range.to - 2 * size),
          };
        }
        return {
          changes: [
            { from: range.from, insert: marker },
            { from: range.to, insert: marker },
          ],
          range: EditorSelection.range(range.from + size, range.to + size),
        };
      }),
      { userEvent: 'input', scrollIntoView: true },
    );
    view.focus();
    return true;
  };
}

function selectedLines(state: EditorState): Line[] {
  const lines = new Map<number, Line>();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos);
      lines.set(line.number, line);
      pos = line.to + 1;
    }
  }
  return [...lines.values()].sort((a, b) => a.number - b.number);
}

const HEADING = /^(\s{0,3})#{1,6}\s+/;

/** Makes the selected lines headings of `level` (0: plain text); the same level toggles off. */
export function setHeading(level: number): Command {
  return (view) => {
    const lines = selectedLines(view.state);
    const all = lines.every((l) => new RegExp(`^\\s{0,3}#{${level}}\\s`).test(l.text));
    const changes: ChangeSpec[] = lines.map((line) => {
      const current = HEADING.exec(line.text);
      const prefix = level === 0 || all ? '' : `${'#'.repeat(level)} `;
      return { from: line.from, to: line.from + (current?.[0].length ?? 0), insert: prefix };
    });
    view.dispatch({ changes, userEvent: 'input', scrollIntoView: true });
    view.focus();
    return true;
  };
}

const LIST = /^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

/** Bullet, numbered or task list for the selected lines; toggles off when they already are. */
export function toggleList(kind: 'bullet' | 'ordered' | 'task'): Command {
  const test = {
    bullet: /^\s*[-+*]\s+(?!\[[ xX]\])/,
    ordered: /^\s*\d+[.)]\s+/,
    task: /^\s*[-+*]\s+\[[ xX]\]\s+/,
  }[kind];
  return (view) => {
    const lines = selectedLines(view.state).filter(
      (l, _i, all) => all.length === 1 || l.text.trim(),
    );
    const off = lines.every((l) => test.test(l.text));
    let n = 0;
    const changes: ChangeSpec[] = lines.map((line) => {
      const current = LIST.exec(line.text);
      const indent = current?.[1] ?? /^\s*/.exec(line.text)![0];
      n += 1;
      const marker = off ? '' : kind === 'bullet' ? '- ' : kind === 'ordered' ? `${n}. ` : '- [ ] ';
      return {
        from: line.from,
        to: line.from + (current?.[0].length ?? indent.length),
        insert: indent + marker,
      };
    });
    view.dispatch({ changes, userEvent: 'input', scrollIntoView: true });
    view.focus();
    return true;
  };
}

/** Quotes the selected lines, or unquotes them. */
export const toggleQuote: Command = (view) => {
  const lines = selectedLines(view.state);
  const off = lines.every((l) => /^\s*>/.test(l.text));
  const changes: ChangeSpec[] = lines.map((line) => {
    const current = /^\s*>\s?/.exec(line.text);
    return off
      ? { from: line.from, to: line.from + (current?.[0].length ?? 0) }
      : { from: line.from, insert: '> ' };
  });
  view.dispatch({ changes, userEvent: 'input' });
  view.focus();
  return true;
};

/** `[text](url)`: the selection becomes the text, and the url is selected to type over. */
export const insertLink: Command = (view) => {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const isUrl = /^https?:\/\/\S+$/.test(text);
      const label = isUrl ? 'link' : text || 'link';
      const url = isUrl ? text : 'https://';
      const insert = `[${label}](${url})`;
      const start = isUrl || !text ? range.from + 1 : range.from + label.length + 3;
      const end = isUrl || !text ? start + label.length : start + url.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(start, end),
      };
    }),
    { userEvent: 'input', scrollIntoView: true },
  );
  view.focus();
  return true;
};

/** Inserts a block on its own lines at the cursor, placing the cursor at `cursor` in it. */
export function insertBlock(
  view: EditorView,
  text: string,
  cursor = text.length,
  select = 0,
): void {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const empty = line.text.trim() === '';
  const from = empty ? line.from : range.from;
  const to = empty ? line.to : range.to;
  const atStart = from === line.from;
  const before = atStart
    ? line.number > 1 && state.doc.line(line.number - 1).text.trim()
      ? '\n'
      : ''
    : '\n\n';
  const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : '';
  const after = nextLine.trim() ? '\n\n' : '\n';
  const insert = before + text + after;
  const anchor = from + before.length + cursor;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.range(anchor, anchor + select),
    userEvent: 'input',
    scrollIntoView: true,
  });
  view.focus();
}

/** A fenced code block around the selection, or an empty one to type in. */
export function insertCodeBlock(language = ''): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    const selected = state.sliceDoc(range.from, range.to);
    const fence = selected.includes('```') ? '~~~' : '```';
    const body = selected || '';
    insertBlock(
      view,
      `${fence}${language}\n${body}\n${fence}`,
      fence.length + language.length + 1,
      body.length,
    );
    return true;
  };
}

export const insertMath: Command = (view) => {
  insertBlock(view, '$$\nE = mc^2\n$$', 3, 8);
  return true;
};

export function insertCallout(type = 'NOTE'): Command {
  return (view) => {
    const prefix = `> [!${type}]\n> `;
    insertBlock(view, `${prefix}Text`, prefix.length, 4);
    return true;
  };
}

export const insertRule: Command = (view) => {
  insertBlock(view, '---');
  return true;
};

/** Today's date, written the ISO way (it sorts, and reads the same everywhere). */
export const insertDate: Command = (view) => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  view.dispatch(view.state.replaceSelection(text), { userEvent: 'input' });
  view.focus();
  return true;
};

/** Typing `*`, `_`, `~` or `` ` `` with text selected wraps it instead of replacing it. */
export const wrapOnType = EditorView.inputHandler.of((view, from, to, text) => {
  if (!['*', '_', '~', '`', '='].includes(text) || from === to) return false;
  if (view.state.selection.ranges.some((r) => r.empty)) return false;
  return toggleWrap(text)(view);
});
