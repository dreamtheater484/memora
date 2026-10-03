import {
  DIAGRAM_FIT,
  DIAGRAM_LANGUAGE,
  diagramWidth,
  isDiagramLanguage,
  type DiagramWidth,
} from '@memora/shared';
import { Extension, type Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { NodeViewConstructor } from '@tiptap/pm/view';

/*
 * Diagrams in rich pages (§9.4): a code block in Mermaid (in any case), drawn instead of
 * shown, with a width (pixels, or "fit" for the text's width), an alignment and a caption.
 * Reusing the code block keeps diagrams safe in older versions of Memora, which show the code
 * rather than dropping a node they don't know. The cursor never goes inside the hidden code:
 * the diagram is selected whole, like an image.
 */

export type DiagramAlign = 'left' | 'center' | 'right';
export const DIAGRAM_ALIGNS: readonly DiagramAlign[] = ['left', 'center', 'right'];

/** The sizes on offer (§9.4). Fit fills the text's width, whatever that is, and follows it. */
export const DIAGRAM_SIZES: { value: string; label: string; width: DiagramWidth }[] = [
  { value: 'natural', label: 'Natural size', width: null },
  { value: '320', label: 'Small', width: 320 },
  { value: '480', label: 'Medium', width: 480 },
  { value: '720', label: 'Large', width: 720 },
  { value: DIAGRAM_FIT, label: 'Fit', width: DIAGRAM_FIT },
];

/** The diagram's frame for a stored width: fixed, the text's (Fit), or the drawing's own. */
export function frameStyle(value: unknown): { width: string } | undefined {
  const width = diagramWidth(value);
  if (width === DIAGRAM_FIT) return { width: '100%' };
  return width ? { width: `${width}px` } : undefined;
}

export const isDiagram = (node: PMNode | null | undefined): node is PMNode =>
  !!node && node.type.name === 'codeBlock' && isDiagramLanguage(node.attrs.language);

/** The diagram at `pos`, or else the one with `code` (the page may have changed meanwhile). */
export function findDiagram(doc: PMNode, pos: number | null, code: string): number | null {
  const at = pos === null ? null : doc.nodeAt(pos);
  if (pos !== null && isDiagram(at) && at.textContent === code) return pos;
  let found: number | null = null;
  doc.descendants((node, p) => {
    if (found !== null) return false;
    if (isDiagram(node) && node.textContent === code) found = p;
    return !node.isTextblock;
  });
  return found ?? (pos !== null && isDiagram(at) ? pos : null);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diagramBlocks: {
      /** Inserts a diagram at the selection, selected. */
      insertDiagram: (code: string) => ReturnType;
      /** Replaces the code of the diagram at `pos`. */
      setDiagramCode: (pos: number, code: string) => ReturnType;
    };
  }
}

export interface DiagramBlocksOptions {
  /** The diagram's view in the editor; none when only reading or writing HTML. */
  view: ((editor: Editor) => NodeViewConstructor) | null;
  /** Opens the diagram editor for the selected diagram (Enter). */
  onEdit: ((editor: Editor, pos: number) => void) | null;
}

export const DiagramBlocks = Extension.create<DiagramBlocksOptions>({
  name: 'diagramBlocks',

  addOptions() {
    return { view: null, onEdit: null };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['codeBlock'],
        attributes: {
          width: {
            default: null,
            parseHTML: (element) => diagramWidth(element.dataset.width),
            renderHTML: (attributes) =>
              attributes.width ? { 'data-width': String(attributes.width) } : {},
          },
          align: {
            default: null,
            parseHTML: (element) =>
              (DIAGRAM_ALIGNS as readonly string[]).includes(element.dataset.align ?? '')
                ? element.dataset.align
                : null,
            renderHTML: (attributes) =>
              attributes.align ? { 'data-align': attributes.align } : {},
          },
          caption: {
            default: null,
            parseHTML: (element) => element.dataset.caption || null,
            renderHTML: (attributes) =>
              attributes.caption ? { 'data-caption': attributes.caption } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      insertDiagram:
        (code) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.nodes.codeBlock;
          if (!type) return false;
          const node = type.create(
            { language: DIAGRAM_LANGUAGE },
            code ? state.schema.text(code) : null,
          );
          if (dispatch) {
            const { $from, $to } = tr.selection;
            // An empty top-level paragraph is replaced; otherwise the diagram goes after the
            // top-level block the selection is in.
            const parent = $from.parent;
            const empty = $from.depth === 1 && parent.isTextblock && parent.content.size === 0;
            const from = empty ? $from.before() : $to.depth > 0 ? $to.after(1) : $to.pos;
            const to = empty ? $from.after() : from;
            tr.replaceWith(from, to, node);
            tr.setSelection(NodeSelection.create(tr.doc, from));
            tr.scrollIntoView();
          }
          return true;
        },
      setDiagramCode:
        (pos, code) =>
        ({ tr, state, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!isDiagram(node)) return false;
          if (dispatch) {
            tr.replaceWith(
              pos + 1,
              pos + node.nodeSize - 1,
              code ? state.schema.text(code) : Fragment.empty,
            );
            tr.setSelection(NodeSelection.create(tr.doc, pos));
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection } = this.editor.state;
        if (!(selection instanceof NodeSelection) || !isDiagram(selection.node)) return false;
        if (!this.options.onEdit) return false;
        this.options.onEdit(this.editor, selection.from);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const plugins = [
      // A cursor that lands in a diagram's hidden code selects the diagram instead.
      new Plugin({
        key: new PluginKey('diagramSelection'),
        appendTransaction: (_transactions, _old, state) => {
          const { selection } = state;
          if (!(selection instanceof TextSelection)) return null;
          const { $from } = selection;
          if (!isDiagram($from.parent)) return null;
          return state.tr.setSelection(NodeSelection.create(state.doc, $from.before()));
        },
      }),
    ];
    const view = this.options.view;
    if (view) {
      const editor = this.editor;
      plugins.push(
        new Plugin({
          key: new PluginKey('diagramViews'),
          props: { nodeViews: { codeBlock: view(editor) } },
        }),
      );
    }
    return plugins;
  },
});
