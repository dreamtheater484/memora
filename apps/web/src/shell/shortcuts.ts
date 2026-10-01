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
  { keys: '/', label: 'Insert a table, image, callout…' },
  { keys: '[[', label: 'Link to a page' },
  { keys: 'Mod F', label: 'Find and replace' },
  { keys: 'Esc Tab', label: 'Leave the editor' },
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
 * Listens for the shortcuts and runs the handler given for each. Shortcuts wait while a dialog
 * or menu is open, except the global ones.
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
