import { Extension } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/*
 * Drag handles for blocks (§9.4): hovering a block shows a grip in the margin; dragging it
 * moves the block, clicking it selects the block (to delete, copy or move with the keyboard).
 * The editor's own drag and drop does the moving; the grip only starts it with the block.
 */

const key = new PluginKey('dragHandle');

const GRIP =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

/** The top-level block at a height on screen, as its position. */
function blockAt(view: EditorView, y: number): number | null {
  const box = view.dom.getBoundingClientRect();
  const found = view.posAtCoords({ left: box.left + Math.min(40, box.width / 2), top: y });
  if (!found) return null;
  const $pos = view.state.doc.resolve(found.inside >= 0 ? found.inside : found.pos);
  if ($pos.depth === 0) {
    // Between blocks, or on an atom at the top level.
    const node = view.state.doc.nodeAt(found.inside >= 0 ? found.inside : found.pos);
    return node && found.inside >= 0 ? found.inside : null;
  }
  return $pos.before(1);
}

export const DragHandle = Extension.create({
  name: 'dragHandle',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        view: (view) => {
          const handle = document.createElement('button');
          handle.type = 'button';
          handle.className = 'rich-drag-handle';
          handle.draggable = true;
          handle.tabIndex = -1;
          handle.setAttribute('aria-label', 'Drag to move this block, click to select it');
          handle.innerHTML = GRIP;
          handle.hidden = true;
          const parent = view.dom.parentElement;
          parent?.append(handle);
          let current: number | null = null;

          const show = (pos: number) => {
            const dom = view.nodeDOM(pos);
            if (!(dom instanceof HTMLElement) || !parent) return;
            current = pos;
            const top = dom.getBoundingClientRect().top - parent.getBoundingClientRect().top;
            // Line it up with the block's first line.
            const line = Number.parseFloat(getComputedStyle(dom).lineHeight) || 24;
            handle.style.top = `${top + Math.max(0, (Math.min(line, dom.offsetHeight) - 24) / 2)}px`;
            handle.hidden = false;
          };
          const hide = () => {
            handle.hidden = true;
            current = null;
          };

          const onMove = (event: MouseEvent) => {
            if (!view.editable) return hide();
            const pos = blockAt(view, event.clientY);
            if (pos === null) return;
            if (pos !== current) show(pos);
          };
          const onLeave = (event: MouseEvent) => {
            if (event.relatedTarget !== handle) hide();
          };
          const select = () => {
            if (current === null) return null;
            const selection = NodeSelection.create(view.state.doc, current);
            view.dispatch(view.state.tr.setSelection(selection));
            return selection;
          };
          const onDragStart = (event: DragEvent) => {
            const selection = select();
            if (!selection || !event.dataTransfer) return;
            const slice = selection.content();
            const wrap = document.createElement('div');
            wrap.append(
              DOMSerializer.fromSchema(view.state.schema).serializeFragment(slice.content),
            );
            event.dataTransfer.clearData();
            event.dataTransfer.setData('text/html', wrap.innerHTML);
            event.dataTransfer.setData('text/plain', wrap.textContent ?? '');
            event.dataTransfer.effectAllowed = 'copyMove';
            const dom = view.nodeDOM(selection.from);
            if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0);
            // The editor moves the block where it is dropped.
            view.dragging = { slice, move: true };
          };
          const onClick = () => {
            select();
            view.focus();
          };

          view.dom.addEventListener('mousemove', onMove);
          view.dom.addEventListener('mouseleave', onLeave);
          view.dom.addEventListener('keydown', hide);
          handle.addEventListener('dragstart', onDragStart);
          handle.addEventListener('dragend', hide);
          handle.addEventListener('click', onClick);
          handle.addEventListener('mouseleave', (event) => {
            if (!view.dom.contains(event.relatedTarget as Node | null)) hide();
          });
          return {
            update: () => {
              if (current !== null && current > view.state.doc.content.size) hide();
            },
            destroy: () => {
              view.dom.removeEventListener('mousemove', onMove);
              view.dom.removeEventListener('mouseleave', onLeave);
              view.dom.removeEventListener('keydown', hide);
              handle.remove();
            },
          };
        },
      }),
    ];
  },
});
