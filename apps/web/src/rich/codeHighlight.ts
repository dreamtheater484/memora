import { isDiagramLanguage } from '@memora/shared';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { highlightTokens, type CodeToken } from '../markdown/highlight';

/*
 * Colours in rich code blocks (§9.4), from the same Shiki highlighter as the Markdown preview.
 * Highlighting is asynchronous: until a block's new colours arrive, its old ones stay (mapped
 * through the edit), so typing in a code block doesn't flicker.
 */

const key = new PluginKey<DecorationSet>('codeHighlight');

/** Colours per language and code; a small cache, as every keystroke in a block is new code. */
const cache = new Map<string, CodeToken[][] | null>();
const MAX_CACHED = 200;

function remember(id: string, tokens: CodeToken[][] | null) {
  cache.delete(id);
  cache.set(id, tokens);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

function decorate(
  doc: PMNode,
  previous: DecorationSet,
  request: (id: string, code: string, language: string) => void,
) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const language = typeof node.attrs.language === 'string' ? node.attrs.language : '';
    if (!language || isDiagramLanguage(language)) return false;
    const code = node.textContent;
    const id = `${language}\u0000${code}`;
    const tokens = cache.get(id);
    if (tokens === undefined) {
      request(id, code, language);
      decorations.push(...previous.find(pos, pos + node.nodeSize));
      return false;
    }
    if (!tokens) return false;
    let at = pos + 1;
    for (const line of tokens) {
      for (const token of line) {
        if (token.style && token.text) {
          decorations.push(Decoration.inline(at, at + token.text.length, { style: token.style }));
        }
        at += token.text.length;
      }
      at += 1;
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export const CodeHighlight = Extension.create({
  name: 'codeHighlight',
  addProseMirrorPlugins() {
    let view: EditorView | null = null;
    const pending = new Set<string>();
    const request = (id: string, code: string, language: string) => {
      if (pending.has(id)) return;
      pending.add(id);
      void highlightTokens(code, language)
        .catch(() => null)
        .then((tokens) => {
          pending.delete(id);
          remember(id, tokens);
          if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true));
        });
    };
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorate(state.doc, DecorationSet.empty, request),
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(key)
              ? decorate(tr.doc, old.map(tr.mapping, tr.doc), request)
              : old,
        },
        props: {
          decorations: (state) => key.getState(state),
        },
        view: (editorView) => {
          view = editorView;
          return {
            destroy: () => {
              view = null;
            },
          };
        },
      }),
    ];
  },
});
