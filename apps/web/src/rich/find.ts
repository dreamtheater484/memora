import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/*
 * Find and replace in a rich page (§9.8): every match marked, the current one stronger, found
 * across formatting within a paragraph. Replacing keeps the formatting of the text replaced.
 */

export interface Match {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: Match[];
  current: number;
}

export const findKey = new PluginKey<FindState>('find');

const EMPTY: FindState = { query: '', caseSensitive: false, matches: [], current: 0 };

/** Every occurrence of `query` in the document's text blocks. */
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): Match[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    // Other inline content counts as one character, as in the document.
    let text = '';
    node.forEach((child) => {
      text += child.isText ? child.text! : '￼'.repeat(child.nodeSize);
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
      matches.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length });
    }
    return false;
  });
  return matches;
}

type Meta = Partial<Pick<FindState, 'query' | 'caseSensitive' | 'current'>>;

export const Find = Extension.create({
  name: 'find',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, old) {
            const meta = tr.getMeta(findKey) as Meta | undefined;
            if (!meta && !tr.docChanged) return old;
            const next = { ...old, ...meta };
            const matches =
              meta?.query !== undefined || meta?.caseSensitive !== undefined || tr.docChanged
                ? findMatches(tr.doc, next.query, next.caseSensitive)
                : old.matches;
            const current = matches.length
              ? Math.min(Math.max(next.current, 0), matches.length - 1)
              : 0;
            return { ...next, matches, current };
          },
        },
        props: {
          decorations(state) {
            const find = findKey.getState(state);
            if (!find?.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              find.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === find.current ? 'find-match find-match-current' : 'find-match',
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});

export const findState = (editor: Editor): FindState => findKey.getState(editor.state) ?? EMPTY;

export function setFind(editor: Editor, meta: Meta): void {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, meta));
}

/** Goes to the next (or previous) match and shows it. */
export function findNext(editor: Editor, step: 1 | -1): void {
  const { matches, current } = findState(editor);
  if (!matches.length) return;
  const next = (current + step + matches.length) % matches.length;
  const match = matches[next]!;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(findKey, { current: next })
      .setSelection(TextSelection.create(editor.state.doc, match.from, match.to))
      .scrollIntoView(),
  );
}

export function replaceCurrent(editor: Editor, replacement: string): void {
  const { matches, current } = findState(editor);
  const match = matches[current];
  if (!match) return;
  const tr = editor.state.tr;
  if (replacement) tr.insertText(replacement, match.from, match.to);
  else tr.delete(match.from, match.to);
  editor.view.dispatch(tr.setMeta(findKey, { current }));
}

/** Replaces every match; answers how many. */
export function replaceAll(editor: Editor, replacement: string): number {
  const { matches } = findState(editor);
  if (!matches.length) return 0;
  const tr = editor.state.tr;
  // From the end, so earlier positions stay valid.
  for (const match of [...matches].reverse()) {
    if (replacement) tr.insertText(replacement, match.from, match.to);
    else tr.delete(match.from, match.to);
  }
  editor.view.dispatch(tr);
  return matches.length;
}
