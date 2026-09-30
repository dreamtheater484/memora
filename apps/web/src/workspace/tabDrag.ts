import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';

/*
 * Dragging a pane's tab (§9.12): onto another pane's tabs to move it there, onto the left or
 * right edge of a pane to split it off into a new pane there, or into the middle of the main
 * pane to open it there. Panes mark themselves with `data-pane` (and `data-pane-tabs` on their
 * tab strip); Escape cancels.
 */

export type TabDrop =
  | { kind: 'tabs'; paneId: string; index: number }
  | { kind: 'split'; paneId: string; side: 'before' | 'after' }
  | { kind: 'main' };

interface TabDragState {
  tabId: string | null;
  label: string;
  x: number;
  y: number;
  drop: TabDrop | null;
}

export const useTabDrag = create<TabDragState>()(() => ({
  tabId: null,
  label: '',
  x: 0,
  y: 0,
  drop: null,
}));

const START_DISTANCE = 6;
/** The share of a pane's width, at each side, that splits. */
const EDGE = 0.25;

function dropAt(x: number, y: number): TabDrop | null {
  const hit = document.elementFromPoint(x, y);
  const pane = hit?.closest<HTMLElement>('[data-pane]');
  if (!pane) return null;
  const paneId = pane.dataset.pane!;
  const strip = hit?.closest<HTMLElement>('[data-pane-tabs]');
  if (strip && paneId !== 'main') {
    const tabs = [...strip.querySelectorAll<HTMLElement>('[role="tab"]')];
    const index = tabs.filter((t) => {
      const r = t.getBoundingClientRect();
      return x > r.left + r.width / 2;
    }).length;
    return { kind: 'tabs', paneId, index };
  }
  const r = pane.getBoundingClientRect();
  const along = (x - r.left) / r.width;
  if (along > 1 - EDGE) return { kind: 'split', paneId, side: 'after' };
  if (paneId === 'main') return { kind: 'main' };
  if (along < EDGE) return { kind: 'split', paneId, side: 'before' };
  return { kind: 'tabs', paneId, index: Number.MAX_SAFE_INTEGER };
}

/** Starts dragging a tab with a mouse or pen; a click without moving just selects it. */
export function startTabDrag(
  event: ReactPointerEvent,
  tabId: string,
  label: string,
  onDrop: (drop: TabDrop) => void,
): void {
  if (event.button !== 0 || event.pointerType === 'touch') return;
  if ((event.target as HTMLElement).closest('[data-no-drag]')) return;
  const start = { x: event.clientX, y: event.clientY };
  let dragging = false;

  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < START_DISTANCE) return;
      dragging = true;
      document.documentElement.dataset.dragging = 'tab';
    }
    useTabDrag.setState({
      tabId,
      label,
      x: e.clientX,
      y: e.clientY,
      drop: dropAt(e.clientX, e.clientY),
    });
  };
  const end = (drop: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    const target = useTabDrag.getState().drop;
    useTabDrag.setState({ tabId: null, drop: null });
    if (!dragging) return;
    delete document.documentElement.dataset.dragging;
    // The click that ends a drag doesn't select anything.
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (drop && target) onDrop(target);
  };
  const onUp = () => end(true);
  const onCancel = () => end(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    end(false);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}
