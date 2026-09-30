import { CARD_KEY } from '@memora/shared';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/*
 * Card keys in rich pages (§9.11): `WEB-42` in the text becomes a link to the card when a
 * project has that key. Text in code and in links stays as it is.
 */

export const cardKeysKey = new PluginKey<DecorationSet>('cardKeys');

function decorate(doc: PMNode, known: (key: string) => boolean): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (parent?.type.name === 'codeBlock') return false;
    if (!node.isText || !node.text) return;
    if (node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return;
    for (const match of node.text.matchAll(CARD_KEY)) {
      if (!known(match[0])) continue;
      const from = pos + match.index;
      decorations.push(
        Decoration.inline(from, from + match[0].length, {
          class: 'card-link',
          'data-card-key': match[0],
          title: 'Ctrl+click (⌘+click) to open the card',
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const CardKeys = Extension.create<{
  known: (key: string) => boolean;
  open: (key: string) => void;
}>({
  name: 'cardKeys',
  addOptions: () => ({ known: () => false, open: () => undefined }),
  addProseMirrorPlugins() {
    const known = (key: string) => this.options.known(key);
    const open = (key: string) => this.options.open(key);
    return [
      new Plugin({
        key: cardKeysKey,
        state: {
          init: (_, state) => decorate(state.doc, known),
          apply: (tr, old, _, state) =>
            tr.docChanged || tr.getMeta(cardKeysKey) ? decorate(state.doc, known) : old,
        },
        props: {
          decorations: (state) => cardKeysKey.getState(state),
          // A plain click edits the text; with Ctrl or ⌘ it opens the card.
          handleClick: (_view, _pos, event) => {
            if (!(event.ctrlKey || event.metaKey)) return false;
            const key = (event.target as HTMLElement | null)?.closest<HTMLElement>(
              '[data-card-key]',
            )?.dataset.cardKey;
            if (!key) return false;
            open(key);
            return true;
          },
        },
      }),
    ];
  },
});
