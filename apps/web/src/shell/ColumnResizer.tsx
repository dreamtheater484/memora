import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../lib/cn';

/** Arrow keys move the edge this far, in pixels; with Shift four times as far. */
const STEP = 16;

/**
 * The divider on a column's edge, in the grid's gap beside it: drag it or use the arrow keys to
 * make the column wider or narrower; Home and End go to the limits, and a double-click back to
 * the default width. The width is a CSS variable on the grid (`cssVar`): set directly while the
 * edge moves, and kept through `onResize` once it stops.
 */
export function ColumnResizer({
  label,
  edge,
  cssVar,
  min,
  maxShare,
  onResize,
}: {
  label: string;
  /** The column's edge it sits on. */
  edge: 'left' | 'right';
  cssVar: `--${string}`;
  /** The narrowest width, in pixels. */
  min: number;
  /** The widest, as a share of the grid's width, so the notes keep their room. */
  maxShare: number;
  /** The width to keep, in pixels; null for the default. */
  onResize: (width: number | null) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; last: number | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  // For assistive technology: the column's width and the widest it can be, as they change.
  const [size, setSize] = useState({ width: min, max: min });

  const column = () => handle.current?.parentElement ?? null;
  const grid = () => column()?.parentElement ?? null;
  const maxWidth = () => Math.max(min, Math.floor((grid()?.clientWidth ?? 0) * maxShare));
  const clamp = (width: number) => Math.round(Math.min(maxWidth(), Math.max(min, width)));
  const show = (width: number) => grid()?.style.setProperty(cssVar, `${width}px`);
  const set = (width: number) => {
    const next = clamp(width);
    show(next);
    onResize(next);
  };

  useLayoutEffect(() => {
    const col = column();
    const all = grid();
    if (!col || !all || typeof ResizeObserver === 'undefined') return;
    const measure = () =>
      setSize({ width: Math.round(col.getBoundingClientRect().width), max: maxWidth() });
    const observer = new ResizeObserver(measure);
    observer.observe(col);
    observer.observe(all);
    return () => observer.disconnect();
    // The elements stay for the handle's life; the limits are read as they are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Ends a drag, keeping the width it got to. */
  function stop() {
    const last = drag.current?.last;
    drag.current = null;
    setDragging(false);
    if (last != null) onResize(last);
  }

  function onKeyDown(e: KeyboardEvent) {
    const by = e.shiftKey ? STEP * 4 : STEP;
    const wider = edge === 'right' ? 'ArrowRight' : 'ArrowLeft';
    const narrower = edge === 'right' ? 'ArrowLeft' : 'ArrowRight';
    const width = Math.round(column()?.getBoundingClientRect().width ?? min);
    let handled = true;
    if (e.key === wider) set(width + by);
    else if (e.key === narrower) set(width - by);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(maxWidth());
    else handled = false;
    if (handled) e.preventDefault();
  }

  return (
    <div
      ref={handle}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={size.width}
      aria-valuemin={min}
      aria-valuemax={size.max}
      data-dragging={dragging || undefined}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        grid()?.style.removeProperty(cssVar);
        onResize(null);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const width = column()?.getBoundingClientRect().width ?? min;
        drag.current = { x: e.clientX, width, last: null };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const moved = e.clientX - d.x;
        d.last = clamp(edge === 'right' ? d.width + moved : d.width - moved);
        show(d.last);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        stop();
      }}
      onPointerCancel={stop}
      className={cn(
        'group absolute inset-y-0 z-10 flex w-2.5 cursor-col-resize touch-none items-center justify-center outline-none',
        edge === 'right' ? '-right-2.5' : '-left-2.5',
      )}
    >
      <span
        aria-hidden
        className="h-10 w-[3px] rounded-full bg-transparent transition-colors duration-(--dur-fast) group-hover:bg-line-strong group-focus-visible:bg-accent group-data-dragging:bg-accent"
      />
    </div>
  );
}
