import { RICH_MIN_WIDTH } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { saveUiState } from '../notes/queries';

/*
 * The right edge of a rich page's text (§9.4), as in a notebook: drag it to make the text
 * narrower or wider, double-click it to fit the pane again. The width is the page's, kept
 * with the user's settings; on a smaller screen the text still fits the pane.
 */

/** The widest the text can be: the page's width inside its padding. */
function room(column: HTMLElement): number {
  const sheet = column.parentElement;
  if (!sheet) return Infinity;
  const style = getComputedStyle(sheet);
  return sheet.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

/** A width the text can have; null when it reaches the pane's edge (then it fits the pane). */
function clamp(column: HTMLElement, width: number): number | null {
  const max = room(column);
  const value = Math.round(Math.max(RICH_MIN_WIDTH, Math.min(width, max)));
  return value >= max - 4 ? null : value;
}

function show(column: HTMLElement, width: number | null) {
  if (width === null) column.style.removeProperty('--text-width');
  else column.style.setProperty('--text-width', `${width}px`);
}

export function TextWidthHandle({
  pageId,
  width,
  column,
}: {
  pageId: string;
  /** The page's width, or null when its text fits the pane. */
  width: number | null;
  column: HTMLElement | null;
}) {
  const queryClient = useQueryClient();
  const drag = useRef<{ x: number; from: number; width: number | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const save = (next: number | null, delay?: number) =>
    saveUiState(queryClient, { pageWidths: { [pageId]: next } }, delay);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!column || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, from: column.getBoundingClientRect().width, width };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!column || !drag.current) return;
    drag.current.width = clamp(column, drag.current.from + event.clientX - drag.current.x);
    show(column, drag.current.width);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    save(drag.current.width, 0);
    drag.current = null;
    setDragging(false);
  };
  const fit = () => {
    if (column) show(column, null);
    save(null, 0);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!column) return;
    const now = column.getBoundingClientRect().width;
    const step = event.shiftKey ? 80 : 20;
    const next = {
      ArrowLeft: now - step,
      ArrowRight: now + step,
      Home: RICH_MIN_WIDTH,
      End: Infinity,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const value = clamp(column, next);
    show(column, value);
    save(value);
  };

  const max = column ? Math.round(room(column)) : undefined;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Text width"
      aria-valuemin={RICH_MIN_WIDTH}
      aria-valuemax={max}
      aria-valuenow={width ?? max}
      tabIndex={0}
      title="Drag to set the width of the text. Double-click to fit it to the pane."
      className="rich-width-handle"
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={fit}
      onKeyDown={onKeyDown}
    />
  );
}
