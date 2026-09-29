import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';

export interface SplitPaneProps {
  first: ReactNode;
  second: ReactNode;
  /** Share of the first pane in percent (controlled). */
  size?: number;
  defaultSize?: number;
  onSizeChange?: (size: number) => void;
  /** Limits for the first pane, in percent. */
  min?: number;
  max?: number;
  /** Keyboard step in percent; Shift moves ten times as far. */
  step?: number;
  /** Side by side ("horizontal") or stacked ("vertical"). */
  orientation?: 'horizontal' | 'vertical';
  /** Accessible name of the divider. */
  label?: string;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Two panes with a draggable divider. The divider sits in the gap between the
 * panes and works with a mouse, touch and the keyboard: arrow keys resize,
 * Home/End go to the limits, Enter collapses to the minimum and back, and a
 * double-click restores the default.
 */
export function SplitPane({
  first,
  second,
  size: sizeProp,
  defaultSize = 50,
  onSizeChange,
  min = 20,
  max = 80,
  step = 2,
  orientation = 'horizontal',
  label = 'Resize panes',
  className,
}: SplitPaneProps) {
  const [ownSize, setOwnSize] = useState(defaultSize);
  const size = clamp(sizeProp ?? ownSize, min, max);
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const restore = useRef<number | null>(null);
  const firstId = useId();
  const horizontal = orientation === 'horizontal';

  function set(value: number) {
    const next = Math.round(clamp(value, min, max) * 10) / 10;
    if (sizeProp === undefined) setOwnSize(next);
    onSizeChange?.(next);
  }

  function fromPointer(e: PointerEvent) {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = horizontal
      ? (e.clientX - rect.left) / rect.width
      : (e.clientY - rect.top) / rect.height;
    set(ratio * 100);
  }

  function onKeyDown(e: KeyboardEvent) {
    const delta = e.shiftKey ? step * 10 : step;
    const less = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const more = horizontal ? 'ArrowRight' : 'ArrowDown';
    let handled = true;
    if (e.key === less) set(size - delta);
    else if (e.key === more) set(size + delta);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else if (e.key === 'Enter') {
      if (restore.current !== null && size === min) {
        set(restore.current);
        restore.current = null;
      } else {
        restore.current = size;
        set(min);
      }
    } else handled = false;
    if (handled) e.preventDefault();
  }

  const template = `minmax(0, ${size}fr) 0.625rem minmax(0, ${100 - size}fr)`;
  return (
    <div
      ref={container}
      className={cn('grid min-h-0 min-w-0', dragging && 'select-none', className)}
      style={horizontal ? { gridTemplateColumns: template } : { gridTemplateRows: template }}
    >
      <div id={firstId} className="flex min-h-0 min-w-0 flex-col">
        {first}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-controls={firstId}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(size)}
        aria-valuemin={min}
        aria-valuemax={max}
        data-dragging={dragging || undefined}
        onKeyDown={onKeyDown}
        onDoubleClick={() => set(defaultSize)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => dragging && fromPointer(e)}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        className={cn(
          'group relative flex touch-none items-center justify-center outline-none',
          horizontal ? 'cursor-col-resize' : 'cursor-row-resize',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'rounded-full bg-transparent transition-colors duration-(--dur-fast)',
            'group-hover:bg-line-strong group-focus-visible:bg-accent group-data-dragging:bg-accent',
            horizontal ? 'h-10 w-[3px]' : 'h-[3px] w-10',
          )}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">{second}</div>
    </div>
  );
}
