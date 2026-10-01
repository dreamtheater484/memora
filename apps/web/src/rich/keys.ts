import { Extension, type Editor } from '@tiptap/core';

/*
 * The keys of a notebook page (§9.4), as in notebook apps and word processors:
 *
 *   Ctrl/Cmd+Enter   ticks or unticks the to-do the cursor is in (elsewhere: a line break)
 *   Ctrl/Cmd+1       makes the line a to-do, or ticks it when it is one
 *   Tab, Shift+Tab   indent: list items move a level, paragraphs and headings a step; in a
 *                    table, the next or previous cell; in code, a tab character
 *   Ctrl+Space       clears the formatting of the selected text (as in Word; Ctrl/Cmd+\ opens
 *                    a pane)
 *
 * Tab never leaves the page: that would send what's typed next somewhere else. Escape, then
 * Tab, does, for those who move around with the keyboard.
 */

/** The to-do item the cursor is in: where it is, and whether it is ticked. */
function taskItemAt(editor: Editor): { pos: number; checked: boolean } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'taskItem')
      return { pos: $from.before(depth), checked: !!node.attrs.checked };
  }
  return null;
}

/** Ticks or unticks the to-do the cursor is in; false when it isn't in one. */
function toggleTask(editor: Editor): boolean {
  const item = taskItemAt(editor);
  if (!item) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeAttribute(item.pos, 'checked', !item.checked);
      return true;
    })
    .run();
}

const listType = (editor: Editor) =>
  editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;

interface KeysStorage {
  /** The key before this one was Escape: then Tab may leave the page. */
  escaped: boolean;
  stop: (() => void) | null;
}

export const RichKeys = Extension.create<object, KeysStorage>({
  name: 'richKeys',
  // Ahead of the line break on Mod-Enter and of the lists' own Tab.
  priority: 1000,

  addStorage() {
    return { escaped: false, stop: null };
  },

  onCreate() {
    let last = '';
    const track = (event: KeyboardEvent) => {
      this.storage.escaped = last === 'Escape';
      last = event.key;
    };
    const dom = this.editor.view.dom;
    dom.addEventListener('keydown', track, { capture: true });
    this.storage.stop = () => dom.removeEventListener('keydown', track, { capture: true });
  },

  onDestroy() {
    this.storage.stop?.();
  },

  addKeyboardShortcuts() {
    const editor = this.editor;
    const tab = (forward: boolean) => () => {
      if (this.storage.escaped) return false;
      // Tables move between cells themselves.
      if (editor.isActive('table')) return false;
      if (editor.isActive('codeBlock')) {
        if (forward) editor.commands.insertContent('\t');
        return true;
      }
      const list = listType(editor);
      if (list) {
        if (forward) editor.commands.sinkListItem(list);
        else editor.commands.liftListItem(list);
        return true;
      }
      if (forward) editor.commands.indent();
      else editor.commands.outdent();
      return true;
    };
    return {
      'Mod-Enter': () => toggleTask(editor),
      'Mod-1': () => toggleTask(editor) || editor.chain().focus().toggleTaskList().run(),
      Tab: tab(true),
      'Shift-Tab': tab(false),
      'Ctrl-Space': () => editor.chain().focus().unsetAllMarks().run(),
    };
  },
});
