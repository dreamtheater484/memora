import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import type { ReactNode } from 'react';
import { SuggestionList, type ListHandle } from './SuggestionList';

/*
 * Menus that open while typing (§9.4): `/` for blocks to insert, `[[` for a link to a page.
 * Arrow keys move, Enter or Tab picks, Escape closes; the list follows the cursor.
 */

export interface MenuItem {
  title: string;
  hint?: string;
  icon?: ReactNode;
  /** Extra words that find it. */
  keywords?: string;
  run: (editor: Editor, range: Range) => void;
}

/** Renders a suggestion list next to the cursor. */
function renderer(label: string, empty: string): SuggestionOptions<MenuItem>['render'] {
  return () => {
    let component: ReactRenderer<ListHandle, Parameters<typeof SuggestionList>[0]> | null = null;
    let element: HTMLElement | null = null;
    const place = (props: SuggestionProps<MenuItem>) => {
      const rect = props.clientRect?.();
      if (!rect || !element) return;
      void computePosition({ getBoundingClientRect: () => rect }, element, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(6), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        if (element) Object.assign(element.style, { left: `${x}px`, top: `${y}px` });
      });
    };
    const propsOf = (props: SuggestionProps<MenuItem>) => ({
      items: props.items,
      command: (item: MenuItem) => props.command(item),
      label,
      empty,
    });
    return {
      onStart(props) {
        component = new ReactRenderer(SuggestionList, {
          props: propsOf(props),
          editor: props.editor,
        });
        element = document.createElement('div');
        element.className = 'rich-suggestions';
        Object.assign(element.style, { position: 'fixed', zIndex: '60', left: '0', top: '0' });
        element.append(component.element);
        document.body.append(element);
        place(props);
      },
      onUpdate(props) {
        component?.updateProps(propsOf(props));
        place(props);
      },
      onKeyDown({ event }) {
        if (event.key === 'Escape') {
          element?.remove();
          return true;
        }
        return component?.ref?.onKeyDown(event) ?? false;
      },
      onExit() {
        component?.destroy();
        element?.remove();
        component = null;
        element = null;
      },
    };
  };
}

const matches = (item: MenuItem, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || `${item.title} ${item.keywords ?? ''}`.toLowerCase().includes(q);
};

/** `/` commands: `items` are the blocks on offer. */
export function slashCommands(items: () => MenuItem[]) {
  return Extension.create({
    name: 'slashCommands',
    addProseMirrorPlugins() {
      return [
        Suggestion<MenuItem>({
          editor: this.editor,
          pluginKey: new PluginKey('slashCommands'),
          char: '/',
          allowSpaces: false,
          items: ({ query }) =>
            items()
              .filter((item) => matches(item, query))
              .slice(0, 20),
          command: ({ editor, range, props }) => props.run(editor, range),
          // Not inside code, where a slash is just a slash.
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          render: renderer('Insert', 'Nothing matches'),
        }),
      ];
    },
  });
}

/** `[[` links to pages: `pages` are the user's pages. */
export function pageLinks(
  pages: () => { id: string; title: string }[],
  insert: (editor: Editor, range: Range, title: string) => void,
) {
  return Extension.create({
    name: 'pageLinks',
    addProseMirrorPlugins() {
      return [
        Suggestion<MenuItem>({
          editor: this.editor,
          pluginKey: new PluginKey('pageLinks'),
          char: '[[',
          allowSpaces: true,
          items: ({ query }) => {
            const q = query.trim().toLowerCase();
            const seen = new Set<string>();
            return pages()
              .filter((p) => p.title && p.title.toLowerCase().includes(q))
              .filter((p) => !seen.has(p.title) && seen.add(p.title))
              .slice(0, 12)
              .map((p) => ({
                title: p.title,
                run: (editor, range) => insert(editor, range, p.title),
              }));
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          render: renderer('Link to a page', 'No page has that title'),
        }),
      ];
    },
  });
}
