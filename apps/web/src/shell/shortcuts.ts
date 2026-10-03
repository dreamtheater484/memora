import { useEffect, useLayoutEffect, useRef } from 'react';

/*
 * Keyboard shortcuts: one table drives both the key handling and the reference sheet (`?`),
 * so the sheet can't drift from what the keys really do.
 */

export type ShortcutId =
  | 'palette'
  | 'quick-note'
  | 'new-page'
  | 'new-subpage'
  | 'rename'
  | 'delete'
  | 'move'
  | 'indent'
  | 'outdent'
  | 'move-up'
  | 'move-down'
  | 'prev-page'
  | 'next-page'
  | 'prev-section'
  | 'next-section'
  | 'shortcuts'
  | 'search'
  | 'back'
  | 'forward'
  | 'split-pane';

/**
 * Where a shortcut works: anywhere (even while typing), anywhere but in a text field, or only
 * with focus in the page list.
 */
type Scope = 'global' | 'app' | 'page-list';

export interface Shortcut {
  id: ShortcutId;
  /** "Mod" is Ctrl, or ⌘ on a Mac. */
  keys: string;
  label: string;
  group: 'General' | 'Pages' | 'Moving around';
  scope: Scope;
  match: (e: KeyboardEvent) => boolean;
}

const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
const inEditor = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.('.cm-editor, .ProseMirror');
const plain = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey;
// Letters by physical key: Alt changes the character on some layouts (and on a Mac).
const letter = (e: KeyboardEvent, l: string) => e.code === `Key${l}`;

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'palette',
    keys: 'Mod K',
    label: 'Search and commands (Mod P in a page)',
    group: 'General',
    scope: 'global',
    // In the editors Mod K makes a link (§9.3, §9.4), so search is Mod P there.
    match: (e) =>
      mod(e) &&
      !e.altKey &&
      !e.shiftKey &&
      (letter(e, 'K') || (letter(e, 'P') && inEditor(e.target))),
  },
  {
    id: 'split-pane',
    keys: 'Mod \\',
    label: 'Open the page in a new pane (wide screens)',
    group: 'General',
    scope: 'global',
    match: (e) => mod(e) && !e.altKey && !e.shiftKey && e.code === 'Backslash',
  },
  {
    id: 'search',
    keys: 'Mod Shift F',
    label: 'Search all pages',
    group: 'General',
    scope: 'global',
    match: (e) => mod(e) && e.shiftKey && !e.altKey && letter(e, 'F'),
  },
  {
    id: 'back',
    keys: 'Alt ArrowLeft',
    label: 'Back',
    group: 'Moving around',
    scope: 'app',
    match: (e) => e.altKey && !mod(e) && !e.shiftKey && e.key === 'ArrowLeft',
  },
  {
    id: 'forward',
    keys: 'Alt ArrowRight',
    label: 'Forward',
    group: 'Moving around',
    scope: 'app',
    match: (e) => e.altKey && !mod(e) && !e.shiftKey && e.key === 'ArrowRight',
  },
  {
    id: 'quick-note',
    keys: 'Mod Alt N',
    label: 'Quick note to the Inbox',
    group: 'General',
    scope: 'global',
    match: (e) => mod(e) && e.altKey && !e.shiftKey && letter(e, 'N'),
  },
  {
    id: 'shortcuts',
    keys: '?',
    label: 'Keyboard shortcuts',
    group: 'General',
    scope: 'app',
    match: (e) => e.key === '?' && !mod(e) && !e.altKey,
  },
  {
    id: 'new-page',
    keys: 'Alt N',
    label: 'New page',
    group: 'Pages',
    scope: 'app',
    match: (e) => e.altKey && !mod(e) && !e.shiftKey && letter(e, 'N'),
  },
  {
    id: 'new-subpage',
    keys: 'Alt Shift N',
    label: 'New subpage',
    group: 'Pages',
    scope: 'app',
    match: (e) => e.altKey && !mod(e) && e.shiftKey && letter(e, 'N'),
  },
  {
    id: 'rename',
    keys: 'F2',
    label: 'Rename',
    group: 'Pages',
    scope: 'app',
    match: (e) => e.key === 'F2' && plain(e) && !e.shiftKey,
  },
  {
    id: 'move',
    keys: 'Mod Alt M',
    label: 'Move or copy',
    group: 'Pages',
    scope: 'app',
    match: (e) => mod(e) && e.altKey && !e.shiftKey && letter(e, 'M'),
  },
  {
    id: 'delete',
    keys: 'Delete',
    label: 'Delete the selected pages',
    group: 'Pages',
    scope: 'page-list',
    match: (e) => e.key === 'Delete' && plain(e) && !e.shiftKey,
  },
  {
    // Not Tab: in the page list that kept the keyboard from ever leaving it (Phase 11 audit).
    id: 'indent',
    keys: 'Alt Shift ArrowRight',
    label: 'Make a subpage (indent)',
    group: 'Pages',
    scope: 'page-list',
    match: (e) => e.altKey && e.shiftKey && !mod(e) && e.key === 'ArrowRight',
  },
  {
    id: 'outdent',
    keys: 'Alt Shift ArrowLeft',
    label: 'Move out a level (outdent)',
    group: 'Pages',
    scope: 'page-list',
    match: (e) => e.altKey && e.shiftKey && !mod(e) && e.key === 'ArrowLeft',
  },
  {
    id: 'move-up',
    keys: 'Alt Shift ↑',
    label: 'Move the page up',
    group: 'Pages',
    scope: 'app',
    match: (e) => e.altKey && e.shiftKey && !mod(e) && e.key === 'ArrowUp',
  },
  {
    id: 'move-down',
    keys: 'Alt Shift ↓',
    label: 'Move the page down',
    group: 'Pages',
    scope: 'app',
    match: (e) => e.altKey && e.shiftKey && !mod(e) && e.key === 'ArrowDown',
  },
  {
    id: 'prev-page',
    keys: 'Alt ↑',
    label: 'Previous page',
    group: 'Moving around',
    scope: 'app',
    match: (e) => e.altKey && !e.shiftKey && !mod(e) && e.key === 'ArrowUp',
  },
  {
    id: 'next-page',
    keys: 'Alt ↓',
    label: 'Next page',
    group: 'Moving around',
    scope: 'app',
    match: (e) => e.altKey && !e.shiftKey && !mod(e) && e.key === 'ArrowDown',
  },
  {
    id: 'prev-section',
    keys: 'Alt PgUp',
    label: 'Previous section',
    group: 'Moving around',
    scope: 'app',
    match: (e) => e.altKey && !e.shiftKey && !mod(e) && e.key === 'PageUp',
  },
  {
    id: 'next-section',
    keys: 'Alt PgDn',
    label: 'Next section',
    group: 'Moving around',
    scope: 'app',
    match: (e) => e.altKey && !e.shiftKey && !mod(e) && e.key === 'PageDown',
  },
];

/** Keys handled by the lists themselves, listed on the reference sheet too. */
export const LIST_KEYS: readonly { keys: string; label: string }[] = [
  { keys: '↑ ↓', label: 'Move through a list or tree' },
  { keys: '← →', label: 'Collapse or expand; switch section tabs' },
  { keys: 'Enter', label: 'Open' },
  { keys: 'Shift Click', label: 'Select a range of pages' },
  { keys: 'Mod Click', label: 'Add a page to the selection' },
  { keys: 'Shift F10', label: 'Open the context menu' },
];

/** The Markdown editor's own keys (CodeMirror handles them), for the reference sheet. */
export const EDITOR_KEYS: readonly { keys: string; label: string }[] = [
  { keys: 'Mod B', label: 'Bold' },
  { keys: 'Mod I', label: 'Italic' },
  { keys: 'Mod K', label: 'Link' },
  { keys: 'Mod 1…6', label: 'Heading 1 to 6' },
  { keys: 'Mod Shift 7', label: 'Numbered list' },
  { keys: 'Mod Shift 8', label: 'Bullet list' },
  { keys: 'Mod Shift 9', label: 'Task list' },
  { keys: '/', label: 'Insert a table, code, diagram, image…' },
  { keys: '[[', label: 'Link to a page' },
  { keys: 'Tab', label: 'Next table cell' },
  { keys: 'Mod Shift F', label: 'Format table' },
  { keys: 'Mod F', label: 'Find and replace' },
  { keys: 'Mod S', label: 'Save now' },
  { keys: 'Esc Tab', label: 'Leave the editor' },
];

/** The rich text editor's keys, as in a notebook or word processor, for the reference sheet. */
export const RICH_KEYS: readonly { keys: string; label: string }[] = [
  { keys: 'Mod B', label: 'Bold' },
  { keys: 'Mod I', label: 'Italic' },
  { keys: 'Mod U', label: 'Underline' },
  { keys: 'Mod Shift S', label: 'Strikethrough' },
  { keys: 'Ctrl Space', label: 'Clear formatting' },
  { keys: 'Mod K', label: 'Link' },
  { keys: 'Mod Alt 1…6', label: 'Heading 1 to 6' },
  { keys: 'Mod Alt 0', label: 'Normal text' },
  { keys: 'Mod Shift 7', label: 'Numbered list' },
  { keys: 'Mod Shift 8', label: 'Bullet list' },
  { keys: 'Mod 1', label: 'To-do, or tick it' },
  { keys: 'Mod Enter', label: 'Tick or untick a to-do' },
  { keys: 'Tab', label: 'Indent; next table cell' },
  { keys: 'Shift Tab', label: 'Outdent' },
  { keys: 'Mod Shift L', label: 'Align left (E centre, R right, J justify)' },
  { keys: '/', label: 'Insert a table, image, diagram, callout…' },
  { keys: '[[', label: 'Link to a page' },
  { keys: 'Mod F', label: 'Find and replace' },
  { keys: 'Esc Tab', label: 'Leave the editor' },
];

/** The groups of the diagram editor's keys, in the order they are listed. */
export const DIAGRAM_KEY_GROUPS = {
  all: 'Every diagram',
  flowchart: 'Flowcharts',
  mindmap: 'Mind maps',
  sequence: 'Sequence diagrams',
  charts: 'Timelines, Gantt and pie charts',
  panel: 'The panel beside the drawing',
} as const;

export type DiagramKeyGroup = keyof typeof DIAGRAM_KEY_GROUPS;

/**
 * The diagram editor's keys (§9.4), after MindManager's where they fit: for the reference
 * sheet and the editor's own key sheet (?). They work while the drawing has the focus; the
 * panel's while one of its fields has.
 */
export const DIAGRAM_KEYS: readonly { keys: string; label: string; group: DiagramKeyGroup }[] = [
  { group: 'all', keys: 'Double-click', label: 'Edit the words in place' },
  { group: 'all', keys: 'F2', label: 'Edit the words (Space: at their end; or just type)' },
  { group: 'all', keys: 'Enter', label: 'Add the next item (Shift Enter: one before it)' },
  {
    group: 'all',
    keys: 'Tab',
    label: 'Add an item under it (while editing: keep the words, go on)',
  },
  { group: 'all', keys: '← → ↑ ↓', label: 'Select the item that way' },
  { group: 'all', keys: 'Home End', label: 'Select the first or last item' },
  { group: 'all', keys: 'Alt ↑ ↓', label: 'Move the item' },
  { group: 'all', keys: 'Delete', label: 'Delete the selection' },
  { group: 'all', keys: 'Mod D', label: 'Duplicate' },
  { group: 'all', keys: 'Mod C X V', label: 'Copy, cut, paste' },
  { group: 'all', keys: 'Mod Z', label: 'Undo (Mod Shift Z or Mod Y: redo)' },
  { group: 'all', keys: 'Mod + − 0', label: 'Zoom in, out, to fit' },
  { group: 'all', keys: 'Mod Enter', label: 'Done' },
  { group: 'all', keys: 'Esc', label: 'Stop editing, clear the selection, then close' },
  { group: 'all', keys: '?', label: 'Show these keys' },
  { group: 'flowchart', keys: 'Tab', label: 'Add a connected box' },
  { group: 'flowchart', keys: 'Shift Enter', label: 'Add a box beside it' },
  { group: 'flowchart', keys: 'Mod Shift Enter', label: 'Add a box before it' },
  { group: 'flowchart', keys: 'Shift Click', label: 'Select more boxes' },
  { group: 'flowchart', keys: 'Shift Drag', label: 'Select the boxes in a rectangle' },
  { group: 'flowchart', keys: 'Mod A', label: 'Select every box' },
  { group: 'flowchart', keys: 'Mod K', label: 'Connect the selected boxes in order' },
  { group: 'flowchart', keys: 'Mod G', label: 'Group the boxes (Mod Shift G: ungroup)' },
  { group: 'flowchart', keys: 'Mod 1…9', label: 'Shape' },
  { group: 'flowchart', keys: 'Alt 0…8', label: 'Colour (0: none)' },
  { group: 'flowchart', keys: 'Mod Shift Delete', label: 'Delete boxes, keep the flow; ungroup' },
  { group: 'mindmap', keys: 'Enter', label: 'Add a topic after it (Shift Enter: before)' },
  { group: 'mindmap', keys: 'Tab', label: 'Add a topic under it' },
  { group: 'mindmap', keys: 'Mod Shift Enter', label: 'Add a topic above it' },
  { group: 'mindmap', keys: 'Alt Shift ← →', label: 'A level out or in' },
  { group: 'mindmap', keys: 'Alt Shift ↑ ↓', label: 'Move it first or last' },
  { group: 'mindmap', keys: 'Mod Backspace', label: 'Select the topic it is under' },
  { group: 'mindmap', keys: 'Mod Home', label: 'Select the central topic' },
  { group: 'mindmap', keys: 'Mod 1…7', label: 'Shape' },
  { group: 'mindmap', keys: 'Mod Shift Delete', label: 'Delete the topic, keep what is under it' },
  { group: 'sequence', keys: 'Enter', label: 'Add a message after it (on a participant: from it)' },
  { group: 'sequence', keys: 'Tab', label: 'Add the reply (on a participant: a participant)' },
  { group: 'sequence', keys: 'Alt Enter', label: 'Add a note' },
  { group: 'sequence', keys: 'Mod Shift Enter', label: 'Put it in a loop' },
  { group: 'sequence', keys: 'Alt ← →', label: 'Move a participant' },
  { group: 'sequence', keys: 'Alt Shift ← →', label: 'Out of or into a block' },
  { group: 'sequence', keys: 'Mod Backspace', label: 'Select its block' },
  { group: 'sequence', keys: 'Mod Shift Delete', label: 'Delete a block with its steps' },
  { group: 'charts', keys: 'Enter', label: 'Add a period, event, task or slice after it' },
  { group: 'charts', keys: 'Tab', label: 'Timeline: add an event to the period' },
  { group: 'charts', keys: 'Mod Shift Delete', label: 'Delete a section with what it holds' },
  { group: 'panel', keys: 'Enter', label: 'Add a row after it' },
  { group: 'panel', keys: 'Shift Enter', label: 'Break a line in the words' },
  { group: 'panel', keys: '↑ ↓', label: 'The field above or below' },
  { group: 'panel', keys: 'Alt ↑ ↓', label: 'Move the row' },
  { group: 'panel', keys: 'Tab', label: 'Mind map outline: a level in (Shift Tab: out)' },
  { group: 'panel', keys: 'Insert', label: 'Mind map outline: add a topic under it' },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Keys as shown to people: "Ctrl Alt N", or "⌘ ⌥ N" on a Mac. */
export const keysLabel = (keys: string): string => {
  const arrows = keys.replace(/\bArrowLeft\b/g, '←').replace(/\bArrowRight\b/g, '→');
  return isMac
    ? arrows
        .replace(/\bMod\b/g, '⌘')
        .replace(/\bAlt\b/g, '⌥')
        .replace(/\bShift\b/g, '⇧')
    : arrows.replace(/\bMod\b/g, 'Ctrl');
};

export const shortcutKeys = (id: ShortcutId): string =>
  keysLabel(SHORTCUTS.find((s) => s.id === id)!.keys);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
}

/**
 * An open dialog or popover holds every shortcut, the global ones too: they would act on the
 * page behind it, or open another dialog in its place and lose what is in it (an unfinished
 * diagram). The command palette lets the app's shortcuts through (`data-shortcuts`).
 */
const dialogOpen = () =>
  !!document.querySelector(
    '[role="dialog"][data-state="open"]:not([data-shortcuts]), [role="alertdialog"][data-state="open"]',
  );

/**
 * Listens for the shortcuts and runs the handler given for each. Shortcuts wait while a dialog
 * is open; all but the global ones also wait in text fields and menus.
 */
export function useShortcuts(handlers: Partial<Record<ShortcutId, () => void>>): void {
  const current = useRef(handlers);
  useLayoutEffect(() => {
    current.current = handlers;
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      const shortcut = SHORTCUTS.find((s) => s.match(e));
      const handler = shortcut && current.current[shortcut.id];
      if (!shortcut || !handler) return;
      if (dialogOpen()) return;
      if (shortcut.scope !== 'global') {
        const target = e.target as HTMLElement | null;
        if (isTyping(target)) return;
        if (target?.closest?.('[role="dialog"], [role="menu"]')) return;
        if (shortcut.scope === 'page-list' && !target?.closest?.('[data-page-list]')) return;
      }
      e.preventDefault();
      handler();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
