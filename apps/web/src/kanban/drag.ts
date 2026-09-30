import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';

/*
 * Dragging on a board (§9.11's forgiving drop targets). The column is picked from the
 * pointer's x (a gap goes to the nearer column), the lane from its y, and the place in the
 * cell from the cards' midpoints; everything under the whole column counts, down to the bottom
 * of the board. A placeholder the size of the card shows where it lands, and releasing drops
 * it there; only Esc, or releasing outside the board, cancels. A mouse starts after a small
 * move, a finger after a long press. The dragged copy moves by transform outside React, so
 * a drag re-renders only the cells the placeholder enters and leaves.
 */

export interface CardTarget {
  lane: string;
  columnId: string;
  /** In the cell's cards without the dragged one. */
  index: number;
}

interface DragState {
  kind: 'card' | 'column' | 'lane' | null;
  id: string | null;
  /** The dragged card's height, for the placeholder. */
  height: number;
  target: CardTarget | null;
  /** Columns and lanes: the one the dragged one goes before (null: last). */
  before: string | null | undefined;
}

export const useBoardDrag = create<DragState>()(() => ({
  kind: null,
  id: null,
  height: 0,
  target: null,
  before: undefined,
}));

const LONG_PRESS_MS = 350;
const START_DISTANCE = 6;
const EDGE = 56;

interface Session {
  kind: 'card' | 'column' | 'lane';
  id: string;
  board: HTMLElement;
  /** Where the pointer is: the drop target it means. */
  targetAt: (x: number, y: number) => void;
  drop: () => void;
}

/** Nearest element along an axis: one that contains the point, or the closest edge. */
function nearest<T extends Element>(elements: T[], at: number, axis: 'x' | 'y'): T | null {
  let best: T | null = null;
  let distance = Infinity;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    const [start, end] = axis === 'x' ? [r.left, r.right] : [r.top, r.bottom];
    const d = at < start ? start - at : at > end ? at - end : 0;
    if (d < distance) {
      distance = d;
      best = el;
    }
  }
  return best;
}

function inside(el: Element, x: number, y: number) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function begin(event: ReactPointerEvent, source: HTMLElement, make: () => Session | null): void {
  if (event.button !== 0) return;
  if (
    (event.target as HTMLElement).closest(
      'input, textarea, button:not([data-drag-handle]), a, [data-no-drag]',
    )
  ) {
    if (!(event.target as HTMLElement).closest('[data-drag-handle]')) return;
  }
  const touch = event.pointerType === 'touch';
  const start = { x: event.clientX, y: event.clientY };
  const rect = source.getBoundingClientRect();
  const offset = { x: start.x - rect.left, y: start.y - rect.top };
  let armed = !touch;
  let session: Session | null = null;
  let ghost: HTMLElement | null = null;
  let frame = 0;
  let last = start;
  const timer = touch
    ? setTimeout(() => {
        armed = true;
        navigator.vibrate?.(8);
      }, LONG_PRESS_MS)
    : undefined;

  // Once a frame: every read first (where things are), then every write (the copy's place,
  // scrolling, the target), so the browser lays the page out once per frame.
  let seen: { x: number; y: number } | null = null;
  const scroll = () => {
    frame = requestAnimationFrame(scroll);
    if (!session) return;
    const board = session.board;
    const r = board.getBoundingClientRect();
    const scrollX =
      last.x < r.left + EDGE
        ? -Math.ceil((r.left + EDGE - last.x) / 3)
        : last.x > r.right - EDGE
          ? Math.ceil((last.x - r.right + EDGE) / 3)
          : 0;
    const scrollY =
      last.y < r.top + EDGE
        ? -Math.ceil((r.top + EDGE - last.y) / 3)
        : last.y > r.bottom - EDGE
          ? Math.ceil((last.y - r.bottom + EDGE) / 3)
          : 0;
    // A column scrolls near its own top and bottom: the one the card would land in.
    const target = useBoardDrag.getState().target;
    const cell = target
      ? board.querySelector<HTMLElement>(
          `[data-kb-cell="${target.lane}|${target.columnId}"][data-kb-scroll]`,
        )
      : null;
    let scrollCell = 0;
    if (cell && cell.scrollHeight > cell.clientHeight) {
      const c = cell.getBoundingClientRect();
      if (last.y < c.top + EDGE) scrollCell = -Math.ceil((c.top + EDGE - last.y) / 3);
      else if (last.y > c.bottom - EDGE) scrollCell = Math.ceil((last.y - c.bottom + EDGE) / 3);
    }
    const moved = !seen || seen.x !== last.x || seen.y !== last.y;
    // Reads the cards' places, then sets the target.
    if (moved || scrollX || scrollY || scrollCell) session.targetAt(last.x, last.y);
    if (moved && ghost) {
      ghost.style.transform = `translate(${last.x - offset.x}px, ${last.y - offset.y}px) rotate(1.5deg)`;
    }
    if (scrollX) board.scrollLeft += scrollX;
    if (scrollY) board.scrollTop += scrollY;
    if (scrollCell) cell!.scrollTop += scrollCell;
    seen = last;
  };

  const move = (x: number, y: number) => {
    last = { x, y };
  };

  const onMove = (e: PointerEvent) => {
    if (!session) {
      const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!armed) {
        if (distance > START_DISTANCE) stop();
        return;
      }
      if (distance < START_DISTANCE) return;
      session = make();
      if (!session) return stop();
      ghost = source.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.dataset.kbGhost = '';
      Object.assign(ghost.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: '0',
        zIndex: '60',
        pointerEvents: 'none',
        opacity: '0.95',
        boxShadow: '0 12px 28px rgb(0 0 0 / 0.22)',
        // Its own layer: moving it doesn't repaint the board.
        willChange: 'transform',
      });
      ghost.style.transform = `translate(${e.clientX - offset.x}px, ${e.clientY - offset.y}px) rotate(1.5deg)`;
      document.body.append(ghost);
      document.documentElement.dataset.dragging = session.kind;
      useBoardDrag.setState({ kind: session.kind, id: session.id, height: rect.height });
      frame = requestAnimationFrame(scroll);
    }
    move(e.clientX, e.clientY);
  };

  const onUp = () => {
    const done = session;
    stop();
    done?.drop();
    useBoardDrag.setState({ kind: null, id: null, target: null, before: undefined });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    stop();
    useBoardDrag.setState({ kind: null, id: null, target: null, before: undefined });
  };

  const onTouchMove = (e: TouchEvent) => {
    if (armed) e.preventDefault();
  };

  // A long press is a drag here, not the browser's menu.
  const onContextMenu = (e: Event) => e.preventDefault();

  // The click that ends a drag must not open the card.
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  function stop() {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('contextmenu', onContextMenu, true);
    ghost?.remove();
    if (session) {
      window.addEventListener('click', onClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', onClick, { capture: true }), 0);
      delete document.documentElement.dataset.dragging;
    }
    session = null;
  }

  function cancel() {
    stop();
    useBoardDrag.setState({ kind: null, id: null, target: null, before: undefined });
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  if (touch) window.addEventListener('contextmenu', onContextMenu, true);
}

const boardOf = (el: HTMLElement) => el.closest<HTMLElement>('[data-kb-board]');

/** Starts dragging a card (`source`, the card's element); `onDrop` gets where it was released. */
export function startCardDrag(
  event: ReactPointerEvent,
  source: HTMLElement,
  cardId: string,
  onDrop: (target: CardTarget) => void,
): void {
  begin(event, source, () => {
    const board = boardOf(source);
    if (!board) return null;
    let target: CardTarget | null = null;
    return {
      kind: 'card',
      id: cardId,
      board,
      targetAt(x, y) {
        target = null;
        if (inside(board, x, y)) {
          const column = nearest(
            [...board.querySelectorAll<HTMLElement>('[data-kb-column]')],
            x,
            'x',
          );
          const lane = nearest([...board.querySelectorAll<HTMLElement>('[data-kb-lane]')], y, 'y');
          if (column && lane) {
            const columnId = column.dataset.kbColumn!;
            const laneKey = lane.dataset.kbLane!;
            const cell = board.querySelector<HTMLElement>(
              `[data-kb-cell="${laneKey}|${columnId}"]`,
            );
            const cards = cell
              ? [...cell.querySelectorAll<HTMLElement>('[data-kb-card]')].filter(
                  (c) => c.dataset.kbCard !== cardId,
                )
              : [];
            let index = cards.findIndex((c) => {
              const r = c.getBoundingClientRect();
              return y < r.top + r.height / 2;
            });
            if (index < 0) index = cards.length;
            target = { lane: laneKey, columnId, index };
          }
        }
        const current = useBoardDrag.getState().target;
        if (
          current?.lane !== target?.lane ||
          current?.columnId !== target?.columnId ||
          current?.index !== target?.index
        ) {
          useBoardDrag.setState({ target });
        }
      },
      drop() {
        if (target) onDrop(target);
      },
    };
  });
}

/** Starts dragging a column by its header, or a lane by its heading. */
export function startLineDrag(
  event: ReactPointerEvent<HTMLElement>,
  kind: 'column' | 'lane',
  id: string,
  onDrop: (beforeId: string | null) => void,
): void {
  const source = event.currentTarget;
  begin(event, source, () => {
    const board = boardOf(source);
    if (!board) return null;
    let before: string | null | undefined;
    const axis = kind === 'column' ? 'x' : 'y';
    const selector = kind === 'column' ? '[data-kb-column-head]' : '[data-kb-lane-head]';
    return {
      kind,
      id,
      board,
      targetAt(x, y) {
        before = undefined;
        if (inside(board, x, y)) {
          const at = axis === 'x' ? x : y;
          const others = [...board.querySelectorAll<HTMLElement>(selector)].filter(
            (el) => (kind === 'column' ? el.dataset.kbColumnHead : el.dataset.kbLaneHead) !== id,
          );
          const next = others.find((el) => {
            const r = el.getBoundingClientRect();
            return at < (axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2);
          });
          before = next
            ? ((kind === 'column' ? next.dataset.kbColumnHead : next.dataset.kbLaneHead) ?? null)
            : null;
        }
        if (useBoardDrag.getState().before !== before) useBoardDrag.setState({ before });
      },
      drop() {
        if (before !== undefined) onDrop(before);
      },
    };
  });
}
