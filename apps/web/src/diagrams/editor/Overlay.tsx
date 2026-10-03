import type { DiagramModel } from '@memora/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { CanvasView, Spot } from './Canvas';
import type { HitMap } from './hits';
import { InlineEditor, type EditEnd } from './InlineEditor';
import type { EditStart } from './keys';
import { textOf } from './labels';
import { itemKey, itemsOf, type Item, type Selection } from './selection';

/*
 * What is drawn over the diagram for every kind (§9.4): a ring around what is selected, and
 * the field for editing words in place. A click on an item selects it (Shift adds boxes to a
 * flowchart's selection), a double-click edits its words. A type can add its own (the
 * flowchart's + handles and dragging).
 */

interface OverlayProps {
  view: CanvasView;
  model: DiagramModel;
  map: HitMap;
  selection: Selection;
  select: (selection: Selection) => void;
  /** A click on an item, with Shift: a type may add it to the selection. */
  extend?: (item: Item) => Selection | null;
  editing: EditStart | null;
  startEdit: (edit: EditStart) => void;
  commit: (item: Item, text: string, end: EditEnd) => void;
  cancel: () => void;
  children?: ReactNode;
}

/** The smallest rectangle around spots. */
function around(spots: Spot[]): Spot | null {
  const real = spots.filter((s) => s.width || s.height);
  if (!real.length) return null;
  const x = Math.min(...real.map((s) => s.x));
  const y = Math.min(...real.map((s) => s.y));
  return {
    x,
    y,
    width: Math.max(...real.map((s) => s.x + s.width)) - x,
    height: Math.max(...real.map((s) => s.y + s.height)) - y,
  };
}

/** The middle of a drawn line, as a spot (an arrow without words). */
function middleOf(view: CanvasView, path: SVGPathElement): Spot | null {
  if (!view.svg || typeof path.getTotalLength !== 'function') return null;
  const point = path.getPointAtLength(path.getTotalLength() / 2);
  const matrix = path.getScreenCTM();
  if (!matrix) return null;
  const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
  const box = view.svg.getBoundingClientRect();
  const probe = view.spotOf(view.svg);
  const applied = box.width / (probe.width || 1) || 1;
  return {
    x: (screen.x - box.left) / applied - 40,
    y: (screen.y - box.top) / applied - 12,
    width: 80,
    height: 24,
  };
}

export function EditorOverlay({
  view,
  model,
  map,
  selection,
  select,
  extend,
  editing,
  startEdit,
  commit,
  cancel,
  children,
}: OverlayProps) {
  const { svg, place } = view;
  const latest = useRef({ map, select, extend, startEdit, model, selection });
  useLayoutEffect(() => {
    latest.current = { map, select, extend, startEdit, model, selection };
  });

  // Clicks and double-clicks on the drawing.
  useEffect(() => {
    if (!svg) return;
    const click = (e: MouseEvent) => {
      const { map, select, extend } = latest.current;
      const item = map.itemAt(e.target as Element);
      if (!item) return;
      if (e.shiftKey && extend) {
        const grown = extend(item);
        if (grown) return select(grown);
      }
      select(item.kind === 'node' ? { kind: 'nodes', ids: [item.id] } : item);
    };
    const dblclick = (e: MouseEvent) => {
      const { map, startEdit, model } = latest.current;
      const item = map.itemAt(e.target as Element);
      if (item && textOf(model, item)) startEdit({ item });
    };
    svg.addEventListener('click', click);
    svg.addEventListener('dblclick', dblclick);
    return () => {
      svg.removeEventListener('click', click);
      svg.removeEventListener('dblclick', dblclick);
    };
  }, [svg]);

  // A selected arrow is marked on the drawing itself.
  useEffect(() => {
    if (!svg) return;
    svg.querySelectorAll('.is-selected').forEach((e) => e.classList.remove('is-selected'));
    for (const item of itemsOf(selection)) {
      if (item.kind !== 'edge') continue;
      for (const e of map.hitOf(item)?.elements ?? []) {
        if (e.matches('path:not(.diagram-hit)')) e.classList.add('is-selected');
      }
    }
  }, [svg, selection, map]);

  // Where the selected items are, measured once per drawing.
  const rings = useMemo(() => {
    const out: { key: string; spot: Spot; group: boolean }[] = [];
    for (const item of itemsOf(selection)) {
      if (item.kind === 'edge') continue;
      const hit = map.hitOf(item);
      if (!hit) continue;
      // A participant is drawn twice (above and below): a ring round each.
      const parts = item.kind === 'participant' ? hit.elements.map((e) => [e]) : [hit.elements];
      parts.forEach((elements, i) => {
        const spot = around(elements.map(view.spotOf));
        if (spot) out.push({ key: `${itemKey(item)}#${i}`, spot, group: item.kind === 'group' });
      });
    }
    return out;
    // Measured again for each drawing and selection, not each zoom (`place` follows the zoom).
  }, [selection, map, view.spotOf]);

  // Where the words being edited are: on the drawing, or (not drawn yet) by what it came from.
  const editSpot = useMemo(() => {
    if (!editing) return null;
    const hit = map.hitOf(editing.item);
    if (hit) {
      if (hit.text) return view.spotOf(hit.text);
      const path = hit.elements.find((e): e is SVGPathElement => e instanceof SVGPathElement);
      if (path) return middleOf(view, path);
      return around(hit.elements.map(view.spotOf));
    }
    const anchor = editing.anchor ? map.hitOf(editing.anchor) : undefined;
    const from = anchor ? around(anchor.elements.map(view.spotOf)) : null;
    if (!from) return null;
    // Next to what it came from: beside it in a drawing that runs across, else below.
    const across =
      (model.type === 'flowchart' && (model.direction === 'LR' || model.direction === 'RL')) ||
      model.type === 'timeline';
    return across
      ? {
          x: from.x + from.width + 40,
          y: from.y,
          width: Math.max(from.width, 120),
          height: from.height,
        }
      : {
          x: from.x,
          y: from.y + from.height + 30,
          width: Math.max(from.width, 120),
          height: from.height,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, map, view.spotOf, model.type]);

  const spec = editing ? textOf(model, editing.item) : null;
  const editRect = editing
    ? editSpot
      ? place(editSpot)
      : new DOMRect(view.bounds.width / 2 - 80, 40, 160, 36)
    : null;

  return (
    <div className="diagram-overlay">
      {rings.map(({ key, spot, group }) => {
        const r = place(spot);
        return (
          <div
            key={key}
            className={group ? 'diagram-ring is-group' : 'diagram-ring'}
            style={{ left: r.x - 5, top: r.y - 5, width: r.width + 10, height: r.height + 10 }}
          />
        );
      })}
      {children}
      {editing && spec && editRect && (
        <InlineEditor
          key={itemKey(editing.item)}
          rect={editRect}
          bounds={view.bounds}
          scale={view.scale}
          spec={spec}
          typed={editing.typed}
          caretAtEnd={editing.caretAtEnd}
          onCommit={(text, end) => commit(editing.item, text, end)}
          onCancel={cancel}
        />
      )}
    </div>
  );
}
