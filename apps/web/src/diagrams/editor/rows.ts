import type { KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';

/*
 * Rows of the diagram editor's panel (§9.4): moving the focus between their fields, and the
 * keys in them.
 */

/**
 * Focus a panel field (a row just added or moved), with its words selected. The change that
 * adds it is drawn at once, so the keys typed next go into it, not into the field before.
 */
export function focusField(selector: string) {
  const find = () =>
    document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      `.diagram-editor-panel ${selector}`,
    );
  const focus = (field: HTMLTextAreaElement | HTMLInputElement | null) => {
    field?.focus();
    field?.select();
    return !!field;
  };
  // Called from event handlers only: the changes they made are drawn now.
  flushSync(() => undefined);
  if (!focus(find())) requestAnimationFrame(() => focus(find()));
}

/** The text field above or below in the panel; false when there is none. */
function focusNeighbour(field: HTMLTextAreaElement, delta: -1 | 1): boolean {
  const panel = field.closest('.diagram-editor-panel');
  if (!panel) return false;
  const fields = [...panel.querySelectorAll<HTMLTextAreaElement>('textarea.diagram-text-field')];
  const next = fields[fields.indexOf(field) + delta];
  if (!next) return false;
  next.focus();
  const caret = delta > 0 ? 0 : next.value.length;
  next.setSelectionRange(caret, caret);
  return true;
}

export interface RowKeys {
  /** Enter: a new row after this one. */
  add?: () => void;
  /** Alt+↑ and Alt+↓. */
  move?: (delta: -1 | 1) => void;
  /** Backspace in an empty field. */
  remove?: () => void;
}

/**
 * The keys of a row's text field, as on the drawing: Enter adds a row after it, Alt+↑ and
 * Alt+↓ move it, and ↑ and ↓ (on its first or last line) go to the field above or below.
 */
export function rowKeys({ add, move, remove }: RowKeys) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const field = e.currentTarget;
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    const delta = e.key === 'ArrowUp' ? -1 : 1;
    if (e.key === 'Enter' && add && !e.shiftKey && !mod && !e.altKey) {
      e.preventDefault();
      add();
    } else if (vertical && move && e.altKey && !mod && !e.shiftKey) {
      e.preventDefault();
      move(delta);
    } else if (vertical && !e.altKey && !mod && !e.shiftKey) {
      const edge =
        delta < 0
          ? !field.value.slice(0, field.selectionStart).includes('\n')
          : !field.value.slice(field.selectionEnd).includes('\n');
      if (edge && focusNeighbour(field, delta)) e.preventDefault();
    } else if (e.key === 'Backspace' && remove && field.value === '') {
      e.preventDefault();
      remove();
    }
  };
}
