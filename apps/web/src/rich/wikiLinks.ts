import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/*
 * Links to pages (`wiki:Title`) that lead nowhere, because no page has that title (any more),
 * are marked as broken (§9.9). The pages are asked again when the document changes, or when
 * told the pages did (`refreshWikiLinks`).
 */

export const wikiLinksKey = new PluginKey<DecorationSet>('wikiLinks');

/** The title a `wiki:` address names, or null for other addresses. */
export function wikiTitle(href: unknown): string | null {
  if (typeof href !== 'string' || !href.startsWith('wiki:')) return null;
  try {
    return decodeURIComponent(href.slice(5).split('#')[0] ?? '');
  } catch {
    return null;
  }
}

function missing(doc: PMNode, exists: (title: string) => boolean): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== 'link') continue;
      const title = wikiTitle(mark.attrs.href);
      if (title !== null && !exists(title)) {
        decorations.push(
          Decoration.inline(pos, pos + node.nodeSize, { class: 'wiki-link-missing' }),
        );
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const WikiLinks = Extension.create<{ exists: (title: string) => boolean }>({
  name: 'wikiLinks',
  addOptions: () => ({ exists: () => true }),
  addProseMirrorPlugins() {
    const exists = (title: string) => this.options.exists(title);
    return [
      new Plugin({
        key: wikiLinksKey,
        state: {
          init: (_, state) => missing(state.doc, exists),
          apply: (tr, old, _, state) =>
            tr.docChanged || tr.getMeta(wikiLinksKey) ? missing(state.doc, exists) : old,
        },
        props: { decorations: (state) => wikiLinksKey.getState(state) },
      }),
    ];
  },
});
