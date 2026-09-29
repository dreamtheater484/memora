import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';

/*
 * Drag and drop for the notes hierarchy, in a few lines of our own instead of a library: rows
 * mark themselves as drop targets with data attributes, and one set of listeners per drag finds
 * the target under the pointer. Nothing is registered per row, so long lists stay cheap.
 *
 * A mouse starts dragging after a small move; a finger after a long press (a short swipe
 * still scrolls). Escape cancels. Everything here can also be done with keyboard shortcuts.
 */

export type DragKind = 'notebook' | 'group' | 'section' | 'page';
export type Zone = 'before' | 'after' | 'inside';

export interface DragItem {
  kind: DragKind;
  ids: string[];
  /** Shown next to the pointer. */
  label: string;
}

/** What a drop target says about itself (`data-drop-kind`, `data-drop-id`, `data-drop-axis`). */
export interface DropSpot {
  kind: string;
  id: string;
}

export interface DropTarget extends DropSpot {
  zone: Zone;
}

export interface DropRules {
  /** Where `item` may land on `spot`; none means it can't. */
  zones: (item: DragItem, spot: DropSpot) => readonly Zone[];
  drop: (item: DragItem, target: DropTarget) => void;
}

interface DndState {
  item: DragItem | null;
  target: DropTarget | null;
  x: number;
  y: number;
}

export const useDnd = create<DndState>()(() => ({ item: null, target: null, x: 0, y: 0 }));

let rules: DropRules | null = null;

export function setDropRules(next: DropRules | null): void {
  rules = next;
}

/** Data attributes that make an element a drop target. */
export const dropSpot = (kind: string, id: string, axis: 'x' | 'y' = 'y') => ({
  'data-drop-kind': kind,
  'data-drop-id': id,
  'data-drop-axis': axis,
});

/** The zone of the target under the pointer at (x, y), if any is allowed. */
function targetAt(item: DragItem, x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-kind]');
  if (!el || !rules) return null;
  const spot = { kind: el.dataset.dropKind!, id: el.dataset.dropId! };
  const allowed = rules.zones(item, spot);
  if (!allowed.length) return null;
  const rect = el.getBoundingClientRect();
  const along =
    el.dataset.dropAxis === 'x' ? (x - rect.left) / rect.width : (y - rect.top) / rect.height;
  const inside = allowed.includes('inside');
  let zone: Zone = inside
    ? along < 0.25
      ? 'before'
      : along > 0.75
        ? 'after'
        : 'inside'
    : along < 0.5
      ? 'before'
      : 'after';
  if (!allowed.includes(zone)) zone = inside ? 'inside' : allowed[0]!;
  return { ...spot, zone };
}

const LONG_PRESS_MS = 350;
const START_DISTANCE = 6;
const EDGE = 48;

/**
 * Pointer-down handler for something draggable. `getItem` runs when the drag really starts,
 * so it can include the current selection.
 */
export function startDrag(event: ReactPointerEvent, getItem: () => DragItem | null): void {
  if (event.button !== 0 || !rules) return;
  const origin = event.target as HTMLElement;
  if (origin.closest('input, textarea, select, [contenteditable="true"], [data-no-drag]')) return;
  const touch = event.pointerType === 'touch';
  const start = { x: event.clientX, y: event.clientY };
  let armed = !touch;
  let dragging = false;
  let scroller: HTMLElement | null = null;
  let frame = 0;
  let last = start;
  const timer = touch
    ? setTimeout(() => {
        armed = true;
        navigator.vibrate?.(8);
      }, LONG_PRESS_MS)
    : undefined;

  const autoScroll = () => {
    frame = requestAnimationFrame(autoScroll);
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (last.y < rect.top + EDGE) scroller.scrollTop -= Math.ceil((rect.top + EDGE - last.y) / 4);
    else if (last.y > rect.bottom - EDGE) {
      scroller.scrollTop += Math.ceil((last.y - rect.bottom + EDGE) / 4);
    }
  };

  const update = (x: number, y: number) => {
    last = { x, y };
    const item = useDnd.getState().item!;
    scroller =
      document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-scroll]') ?? scroller;
    useDnd.setState({ x, y, target: targetAt(item, x, y) });
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!armed) {
        // A finger that moves before the long press is scrolling.
        if (distance > START_DISTANCE) stop();
        return;
      }
      if (distance < START_DISTANCE) return;
      const item = getItem();
      if (!item) return stop();
      dragging = true;
      useDnd.setState({ item });
      document.documentElement.dataset.dragging = item.kind;
      frame = requestAnimationFrame(autoScroll);
    }
    update(e.clientX, e.clientY);
  };

  const onUp = () => {
    const { item, target } = useDnd.getState();
    if (dragging && item && target) rules?.drop(item, target);
    stop();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      stop();
    }
  };

  // Once a finger has held still long enough, moving it drags instead of scrolling.
  const onTouchMove = (e: TouchEvent) => {
    if (armed) e.preventDefault();
  };

  // The click that ends a drag must not also open what was dragged.
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  function stop() {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', stop);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('touchmove', onTouchMove);
    if (dragging) {
      window.addEventListener('click', onClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', onClick, { capture: true }), 0);
      delete document.documentElement.dataset.dragging;
      useDnd.setState({ item: null, target: null });
    }
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', stop);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
}

/** The drop zone shown on the target with this kind and id, if the pointer is over it. */
export const useDropZone = (kind: string, id: string): Zone | null =>
  useDnd((s) => (s.target?.kind === kind && s.target.id === id ? s.target.zone : null));
