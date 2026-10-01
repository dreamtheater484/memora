import type { Editor } from '@tiptap/core';
import { openDiagramEditor } from '../diagrams/open';
import { findDiagram, isDiagram } from './diagram';

/*
 * Opening the diagram editor from a rich page (§9.4): for a diagram in the page, or for a
 * new one from the template gallery.
 */

/** Opens the diagram editor for the diagram at `pos`, putting the result back there. */
export function editDiagramAt(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!isDiagram(node)) return;
  const code = node.textContent;
  openDiagramEditor({
    code,
    page: 'rich',
    onDone: (next) => {
      if (next === code) return;
      const at = findDiagram(editor.state.doc, pos, code);
      if (at !== null) editor.chain().focus().setDiagramCode(at, next).run();
    },
  });
}

/** Opens the template gallery, and inserts the diagram made there at the selection. */
export function newDiagram(editor: Editor) {
  openDiagramEditor({
    code: null,
    page: 'rich',
    onDone: (code) => editor.chain().focus().insertDiagram(code).run(),
  });
}
