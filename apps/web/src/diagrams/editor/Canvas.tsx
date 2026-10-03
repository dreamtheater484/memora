import { Maximize, Minus, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { IconButton } from '../../components/ui';
import { keysLabel } from '../../shell/shortcuts';
import { useDiagramTheme } from '../useDiagramTheme';

/*
 * The diagram in the editor (§9.4): the real drawing, redrawn as the diagram changes (a
 * moment after the last change), the last good drawing kept while the code has a mistake.
 * Zoom with the buttons, Ctrl/Cmd and the wheel or Ctrl/Cmd and + − 0; drag empty space or
 * scroll to pan; Shift and a drag over empty space selects what it encloses (where the type
 * allows it). What is drawn over it (selections, handles, the words being typed) comes from
 * the type's overlay, placed from where the drawing's elements are within it.
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
  /** The canvas's size. */
  bounds: { width: number; height: number };
}

/** What the editor can ask of the canvas. */
export interface CanvasControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** Pans so a place on the canvas (from `place`) is in sight. */
  reveal: (rect: DOMRect) => void;
}

interface CanvasProps {
  code: string;
  /** The type's overlay. */
  overlay?: (view: CanvasView) => ReactNode;
  /** A click on empty space (no drag): clears the selection. */
  onBackgroundClick?: () => void;
  /** Keys pressed while the canvas has the focus. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** Whether a drawn element is something to click (else a press on it pans). */
  isItem?: (element: Element) => boolean;
  /** A rectangle dragged with Shift over empty space, in screen coordinates. */
  onMarquee?: (rect: DOMRect, add: boolean) => void;
  /** Each new drawing, with the code it was drawn from. */
  onDrawn?: (svg: SVGSVGElement, code: string) => void;
  controls?: Ref<CanvasControls | null>;
  label: string;
  /** What the canvas says about how to use it (screen readers). */
  description?: string;
}

const MIN = 0.25;
const MAX = 3;
const PAD = 48;
/** On a phone the drawing is fitted to the width only, never smaller than this: it scrolls. */
const PHONE = 600;
const PHONE_MIN = 0.6;

const LEGACY_ITEMS =
  '.node, .cluster, .edgeLabel, .diagram-hit, [data-et], .mindmap-node, .diagram-overlay-control, input, textarea, button';

export function Canvas({
  code,
  overlay,
  onBackgroundClick,
  onKeyDown,
  isItem,
  onMarquee,
  onDrawn,
  controls,
  label,
  description,
}: CanvasProps) {
  const theme = useDiagramTheme();
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [marquee, setMarquee] = useState<DOMRect | null>(null);
  const fitted = useRef(false);
  const first = useRef(true);
  // Zoomed or panned by hand: the drawing is then left where it was put.
  const moved = useRef(false);
  const scaleNow = useRef(scale);
  const offsetNow = useRef(offset);
  const drawnNow = useRef(onDrawn);
  useEffect(() => {
    scaleNow.current = scale;
    offsetNow.current = offset;
    drawnNow.current = onDrawn;
  });

  // The canvas's size, kept for what is placed over it (and for fitting).
  useEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(() =>
      setBounds({ width: viewport.clientWidth, height: viewport.clientHeight }),
    );
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);

  const fitTo = useCallback(
    (width: number, height: number) => {
      if (!viewport || !width) return;
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      // A phone fits the width and lets the drawing scroll down, so its words stay readable.
      const next =
        w < PHONE
          ? Math.min(1.25, Math.max(PHONE_MIN, (w - PAD / 2) / width))
          : Math.min(1.5, Math.max(MIN, Math.min((w - PAD) / width, (h - PAD) / height)));
      setScale(next);
      setOffset({
        x: Math.max(w < PHONE ? PAD / 4 : -Infinity, (w - width * next) / 2),
        y: Math.max(PAD / 2, (h - height * next) / 2),
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
            const element = content.querySelector('svg');
            setSvg(element);
            setSize({ width: drawing.width, height: drawing.height });
            setDrawn(true);
            setError(null);
            if (element) drawnNow.current?.(element, code);
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
              const phone = box.clientWidth < PHONE;
              const hidden =
                o.x < 0 || o.y < 0 || o.x + w > box.clientWidth || o.y + h > box.clientHeight;
              if (phone) {
                if (w > box.clientWidth - PAD / 4) fitTo(drawing.width, drawing.height);
              } else if (w > box.clientWidth - PAD / 2 || h > box.clientHeight - PAD / 2) {
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

  // The canvas changed size (the window, a phone turned, the keyboard): fitted again, unless
  // zoomed or panned by hand.
  useEffect(() => {
    if (fitted.current && !moved.current && size.width) fitTo(size.width, size.height);
    // Only for a new canvas size; a new drawing is handled where it is drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.width, bounds.height]);

  const zoomTo = useCallback(
    (next: number, at?: { x: number; y: number }) => {
      if (!viewport) return;
      moved.current = true;
      const now = scaleNow.current;
      const clamped = Math.min(MAX, Math.max(MIN, next));
      const centre = at ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
      // The point under the pointer stays where it is.
      setOffset((o) => ({
        x: centre.x - ((centre.x - o.x) * clamped) / now,
        y: centre.y - ((centre.y - o.y) * clamped) / now,
      }));
      setScale(clamped);
    },
    [viewport],
  );

  useImperativeHandle(
    controls,
    () => ({
      zoomIn: () => zoomTo(scaleNow.current * 1.25),
      zoomOut: () => zoomTo(scaleNow.current / 1.25),
      fit: () => {
        moved.current = false;
        fitTo(size.width, size.height);
      },
      reveal: (rect) => {
        if (!viewport) return;
        const margin = 24;
        const w = viewport.clientWidth;
        const h = viewport.clientHeight;
        let dx = 0;
        let dy = 0;
        if (rect.left < margin) dx = margin - rect.left;
        else if (rect.right > w - margin)
          dx = Math.max(margin - rect.left, w - margin - rect.right);
        if (rect.top < margin) dy = margin - rect.top;
        else if (rect.bottom > h - margin)
          dy = Math.max(margin - rect.top, h - margin - rect.bottom);
        if (dx || dy) setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
      },
    }),
    [zoomTo, fitTo, size, viewport],
  );

  useEffect(() => {
    if (!viewport) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      moved.current = true;
      if (e.ctrlKey || e.metaKey) {
        const rect = viewport.getBoundingClientRect();
        const now = scaleNow.current;
        const next = Math.min(MAX, Math.max(MIN, now * Math.exp(-e.deltaY / 300)));
        const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setOffset((o) => ({
          x: at.x - ((at.x - o.x) * next) / now,
          y: at.y - ((at.y - o.y) * next) / now,
        }));
        setScale(next);
      } else setOffset((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }));
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [viewport]);

  // Panning: a drag that starts on empty space. With Shift (where the type takes it), a
  // rectangle that selects what it encloses.
  const press = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
    moved: boolean;
    select: boolean;
  } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest('.diagram-overlay-control, input, textarea, button')) return;
    const item = isItem ? target.closest('svg') && isItem(target) : !!target.closest(LEGACY_ITEMS);
    if (item) return;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      ox: offset.x,
      oy: offset.y,
      moved: false,
      select: e.shiftKey && !!onMarquee,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    p.moved = true;
    if (p.select) {
      const outer = e.currentTarget.getBoundingClientRect();
      setMarquee(
        new DOMRect(
          Math.min(p.x, e.clientX) - outer.left,
          Math.min(p.y, e.clientY) - outer.top,
          Math.abs(dx),
          Math.abs(dy),
        ),
      );
      return;
    }
    moved.current = true;
    setOffset({ x: p.ox + dx, y: p.oy + dy });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.select && p.moved) {
      setMarquee(null);
      onMarquee?.(
        new DOMRect(
          Math.min(p.x, e.clientX),
          Math.min(p.y, e.clientY),
          Math.abs(e.clientX - p.x),
          Math.abs(e.clientY - p.y),
        ),
        true,
      );
      return;
    }
    if (!p.moved) onBackgroundClick?.();
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
        aria-description={description}
        aria-roledescription="diagram canvas"
        tabIndex={0}
        onKeyDown={(e) => {
          // Keys typed in words being edited are theirs.
          if ((e.target as HTMLElement).closest('input, textarea, button')) return;
          onKeyDown?.(e);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          press.current = null;
          setMarquee(null);
        }}
      >
        <div
          ref={setContent}
          className="diagram-canvas-content"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        />
        {drawn && overlay?.({ svg, viewport, spotOf, place, scale, bounds })}
        {marquee && (
          <div
            className="diagram-marquee"
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}
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
          shortcut={keysLabel('Mod -')}
          onClick={() => zoomTo(scale / 1.25)}
        />
        <span className="diagram-zoom-level" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <IconButton
          label="Zoom in"
          icon={<Plus />}
          size="sm"
          shortcut={keysLabel('Mod +')}
          onClick={() => zoomTo(scale * 1.25)}
        />
        <IconButton
          label="Fit the diagram"
          icon={<Maximize />}
          size="sm"
          shortcut={keysLabel('Mod 0')}
          onClick={() => {
            moved.current = false;
            fitTo(size.width, size.height);
          }}
        />
      </div>
    </div>
  );
}
