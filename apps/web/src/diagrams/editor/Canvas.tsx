import { Maximize, Minus, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { IconButton } from '../../components/ui';
import { useDiagramTheme } from '../useDiagramTheme';

/*
 * The diagram in the editor (§9.4): the real drawing, redrawn as the diagram changes (a
 * moment after the last change), the last good drawing kept while the code has a mistake.
 * Zoom with the buttons, Ctrl/Cmd and the wheel; drag empty space or scroll to pan. What is
 * drawn over it (selections, handles, the label being typed) comes from the type's overlay,
 * placed from where the drawing's elements are within it.
 */

/** A place in the drawing, in its own units (before zooming and panning). */
export interface Spot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasView {
  /** The drawing's SVG once drawn. */
  svg: SVGSVGElement | null;
  /** The canvas element: pointer positions are relative to it. */
  viewport: HTMLDivElement | null;
  /** Where an element is within the drawing; measure once per drawing. */
  spotOf: (element: Element) => Spot;
  /** Where a spot is on the canvas now. */
  place: (spot: Spot) => DOMRect;
  scale: number;
}

interface CanvasProps {
  code: string;
  /** The type's overlay. */
  overlay?: (view: CanvasView) => ReactNode;
  /** A click on empty space (no drag): clears the selection. */
  onBackgroundClick?: () => void;
  /** Keys pressed while the canvas has the focus. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  label: string;
}

const MIN = 0.25;
const MAX = 3;
const PAD = 48;

export function Canvas({ code, overlay, onBackgroundClick, onKeyDown, label }: CanvasProps) {
  const theme = useDiagramTheme();
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const fitted = useRef(false);
  const first = useRef(true);
  // Zoomed or panned by hand: the drawing is then left where it was put.
  const moved = useRef(false);
  const scaleNow = useRef(scale);
  const offsetNow = useRef(offset);
  useEffect(() => {
    scaleNow.current = scale;
    offsetNow.current = offset;
  }, [scale, offset]);

  const fitTo = useCallback(
    (width: number, height: number) => {
      if (!viewport || !width) return;
      const next = Math.min(
        1.5,
        Math.max(
          MIN,
          Math.min((viewport.clientWidth - PAD) / width, (viewport.clientHeight - PAD) / height),
        ),
      );
      setScale(next);
      setOffset({
        x: (viewport.clientWidth - width * next) / 2,
        y: Math.max(PAD / 2, (viewport.clientHeight - height * next) / 2),
      });
    },
    [viewport],
  );

  // Redrawn a moment after the last change; the first drawing at once, fitted to the canvas.
  useEffect(() => {
    if (!content) return;
    let live = true;
    const delay = first.current ? 0 : 120;
    first.current = false;
    const timer = setTimeout(() => {
      if (!code.trim()) {
        setError('The diagram is empty.');
        return;
      }
      import('../render')
        .then(({ renderDiagram }) => renderDiagram(code, theme, 'The diagram being edited'))
        .then(
          (drawing) => {
            if (!live) return;
            // Sanitised by Mermaid's strict mode and again in render.ts.
            content.innerHTML = drawing.svg;
            content.style.width = `${drawing.width}px`;
            setSvg(content.querySelector('svg'));
            setSize({ width: drawing.width, height: drawing.height });
            setDrawn(true);
            setError(null);
            // Fitted the first time. Later, unless zoomed or panned by hand: centred again
            // when part of it would be out of sight, and fitted again when it outgrows the
            // canvas (a mind map grows either side of its centre).
            const box = content.parentElement;
            if (!fitted.current) {
              fitted.current = true;
              fitTo(drawing.width, drawing.height);
            } else if (box && !moved.current) {
              const s = scaleNow.current;
              const o = offsetNow.current;
              const [w, h] = [drawing.width * s, drawing.height * s];
              const hidden =
                o.x < 0 || o.y < 0 || o.x + w > box.clientWidth || o.y + h > box.clientHeight;
              if (w > box.clientWidth - PAD / 2 || h > box.clientHeight - PAD / 2) {
                fitTo(drawing.width, drawing.height);
              } else if (hidden) {
                setOffset({
                  x: (box.clientWidth - w) / 2,
                  y: Math.max(PAD / 2, (box.clientHeight - h) / 2),
                });
              }
            }
          },
          (e: unknown) => live && setError(e instanceof Error ? e.message : 'A mistake'),
        );
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [code, theme, content, fitTo]);

  const zoomTo = (next: number, at?: { x: number; y: number }) => {
    if (!viewport) return;
    moved.current = true;
    const clamped = Math.min(MAX, Math.max(MIN, next));
    const centre = at ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    // The point under the pointer stays where it is.
    setOffset((o) => ({
      x: centre.x - ((centre.x - o.x) * clamped) / scale,
      y: centre.y - ((centre.y - o.y) * clamped) / scale,
    }));
    setScale(clamped);
  };

  useEffect(() => {
    if (!viewport) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      moved.current = true;
      if (e.ctrlKey || e.metaKey) {
        const rect = viewport.getBoundingClientRect();
        const next = Math.min(MAX, Math.max(MIN, scale * Math.exp(-e.deltaY / 300)));
        const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setOffset((o) => ({
          x: at.x - ((at.x - o.x) * next) / scale,
          y: at.y - ((at.y - o.y) * next) / scale,
        }));
        setScale(next);
      } else setOffset((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }));
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [viewport, scale]);

  // Panning: a drag that starts on empty space.
  const pan = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (
      target.closest(
        '.node, .cluster, .edgeLabel, .diagram-hit, [data-et], .mindmap-node, .diagram-overlay-control, input, button',
      )
    ) {
      return;
    }
    pan.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    p.moved = true;
    moved.current = true;
    setOffset({ x: p.ox + dx, y: p.oy + dy });
  };
  const onPointerUp = () => {
    const p = pan.current;
    pan.current = null;
    if (p && !p.moved) onBackgroundClick?.();
  };

  const spotOf = useCallback(
    (element: Element): Spot => {
      if (!svg || !size.width) return { x: 0, y: 0, width: 0, height: 0 };
      const box = svg.getBoundingClientRect();
      const r = element.getBoundingClientRect();
      // The zoom applied when measured, whatever it is now.
      const applied = box.width / size.width || 1;
      return {
        x: (r.left - box.left) / applied,
        y: (r.top - box.top) / applied,
        width: r.width / applied,
        height: r.height / applied,
      };
    },
    [svg, size],
  );
  const place = (spot: Spot) =>
    new DOMRect(
      offset.x + spot.x * scale,
      offset.y + spot.y * scale,
      spot.width * scale,
      spot.height * scale,
    );

  return (
    <div className="diagram-canvas-frame">
      <div
        ref={setViewport}
        className="diagram-canvas"
        role="group"
        aria-label={label}
        aria-roledescription="diagram canvas"
        tabIndex={0}
        onKeyDown={(e) => {
          // Keys typed in a label being renamed are the label's.
          if ((e.target as HTMLElement).closest('input, textarea, button')) return;
          onKeyDown?.(e);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pan.current = null)}
      >
        <div
          ref={setContent}
          className="diagram-canvas-content"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        />
        {drawn && overlay?.({ svg, viewport, spotOf, place, scale })}
      </div>
      {error && (
        <p className="diagram-canvas-error" role="status">
          {drawn ? 'Showing the last drawing that worked. ' : ''}
          {error}
        </p>
      )}
      <div className="diagram-zoom" role="toolbar" aria-label="Zoom">
        <IconButton
          label="Zoom out"
          icon={<Minus />}
          size="sm"
          onClick={() => zoomTo(scale / 1.25)}
        />
        <span className="diagram-zoom-level" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <IconButton
          label="Zoom in"
          icon={<Plus />}
          size="sm"
          onClick={() => zoomTo(scale * 1.25)}
        />
        <IconButton
          label="Fit the diagram"
          icon={<Maximize />}
          size="sm"
          onClick={() => {
            moved.current = false;
            fitTo(size.width, size.height);
          }}
        />
      </div>
    </div>
  );
}
