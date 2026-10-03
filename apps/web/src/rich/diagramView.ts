import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView, NodeView, NodeViewConstructor } from '@tiptap/pm/view';
import { ReactRenderer } from '@tiptap/react';
import { isDiagram } from './diagram';
import { DiagramBlock, type DiagramBlockProps } from './DiagramBlock';

/*
 * The code block's view in a rich page (§9.4): a diagram (Mermaid) is drawn by React with
 * nothing editable inside; other code blocks look as their HTML has them.
 */

/** A diagram's view: drawn by React, with no editable content inside. */
class DiagramNodeView implements NodeView {
  dom: HTMLElement;
  private renderer: ReactRenderer<unknown, DiagramBlockProps>;

  constructor(
    private node: PMNode,
    editor: Editor,
    getPos: () => number | undefined,
  ) {
    this.renderer = new ReactRenderer(DiagramBlock, {
      editor,
      as: 'div',
      className: 'rich-diagram-view',
      props: { node, editor, getPos, selected: false },
    });
    this.dom = this.renderer.element;
    this.dom.contentEditable = 'false';
  }

  update(node: PMNode) {
    if (!isDiagram(node)) return false;
    if (node !== this.node) {
      this.node = node;
      this.renderer.updateProps({ node });
    }
    return true;
  }

  selectNode() {
    this.renderer.updateProps({ selected: true });
  }

  deselectNode() {
    this.renderer.updateProps({ selected: false });
  }

  /** The toolbar, the caption and the resize handles handle their own events. */
  stopEvent(event: Event) {
    const target = event.target as HTMLElement | null;
    if (event.type === 'dragstart') return false;
    return !!target?.closest?.('[role="toolbar"], input, button, .rich-image-resize');
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.renderer.destroy();
  }
}

/** Other code blocks, as the code block's own HTML has them. */
function plainCodeBlock(node: PMNode): NodeView {
  const dom = document.createElement('pre');
  const code = document.createElement('code');
  const setLanguage = (n: PMNode) => {
    const language = typeof n.attrs.language === 'string' ? n.attrs.language : '';
    code.className = language ? `language-${language}` : '';
  };
  setLanguage(node);
  dom.append(code);
  return {
    dom,
    contentDOM: code,
    update: (next) => {
      if (next.type !== node.type || isDiagram(next)) return false;
      setLanguage(next);
      return true;
    },
  };
}

/** The code block's view in the editor: a diagram in Mermaid, else plain code. */
export const codeBlockView =
  (editor: Editor): NodeViewConstructor =>
  (node: PMNode, _view: EditorView, getPos: () => number | undefined) =>
    isDiagram(node) ? new DiagramNodeView(node, editor, getPos) : plainCodeBlock(node);
