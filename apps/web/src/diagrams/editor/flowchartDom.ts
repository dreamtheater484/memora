import type { Flowchart } from '@memora/shared';
import type { KeyboardEvent } from 'react';
import { addNode, addSibling, edgeDomId, removeEdge, removeNodes } from './ops';

/*
 * A flowchart's drawing and keys (§9.4): which box, arrow or group a drawn element belongs
 * to (Mermaid names them after their ids), and what the keys do on the canvas.
 */

export type FlowSelection =
  | { kind: 'nodes'; ids: string[] }
  | { kind: 'edge'; index: number }
  | { kind: 'group'; id: string }
  | null;

export interface FlowEditorProps {
  chart: Flowchart;
  change: (next: Flowchart, merge?: string) => void;
  selection: FlowSelection;
  select: (selection: FlowSelection) => void;
  /** The box being renamed on the drawing. */
  editing: string | null;
  setEditing: (id: string | null) => void;
  announce: (message: string) => void;
}

/** The box a drawn element belongs to. */
export function nodeIdOf(svg: SVGSVGElement, element: Element | null): string | null {
  const node = element?.closest('g.node');
  if (!node?.id) return null;
  const prefix = `${svg.id}-flowchart-`;
  if (!node.id.startsWith(prefix)) return null;
  return node.id.slice(prefix.length).replace(/-\d+$/, '');
}

export function edgeIndexOf(chart: Flowchart, element: Element | null): number | null {
  const holder = element?.closest('[data-edge-id], [data-id^="L_"]');
  const id = holder?.getAttribute('data-edge-id') ?? holder?.getAttribute('data-id');
  if (!id) return null;
  const index = chart.edges.findIndex((_, i) => edgeDomId(chart, i) === id);
  return index >= 0 ? index : null;
}

export function groupIdOf(svg: SVGSVGElement, element: Element | null): string | null {
  const cluster = element?.closest('g.cluster');
  if (!cluster?.id) return null;
  const prefix = `${svg.id}-`;
  return cluster.id.startsWith(prefix) ? cluster.id.slice(prefix.length) : null;
}

/** The centre of each box on the screen, for moving the selection with the arrow keys. */
export function nodeCentres(svg: SVGSVGElement | null): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!svg) return out;
  for (const g of svg.querySelectorAll('g.node')) {
    const id = nodeIdOf(svg, g);
    if (!id) continue;
    const r = g.getBoundingClientRect();
    out.set(id, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
  }
  return out;
}

/** Keys on the canvas: rename, add, delete, and move the selection with the arrow keys. */
export function flowchartKeys(
  event: KeyboardEvent<HTMLDivElement>,
  props: FlowEditorProps,
  rects: () => Map<string, { x: number; y: number }>,
): boolean {
  const { chart, change, selection, select, setEditing, announce } = props;
  const ids = selection?.kind === 'nodes' ? selection.ids : [];
  const one = ids.length === 1 ? ids[0]! : null;
  switch (event.key) {
    case 'Enter':
    case 'F2':
      if (event.shiftKey && one) {
        const added = addSibling(chart, one);
        change(added.chart);
        select({ kind: 'nodes', ids: [added.id] });
        setEditing(added.id);
        announce('Added a box beside it');
        return true;
      }
      if (one) {
        setEditing(one);
        return true;
      }
      return false;
    case 'Tab':
      if (!one || event.shiftKey) return false;
      {
        const added = addNode(chart, { from: one });
        change(added.chart);
        select({ kind: 'nodes', ids: [added.id] });
        setEditing(added.id);
        announce('Added a connected box');
      }
      return true;
    case 'Delete':
    case 'Backspace':
      if (ids.length) {
        change(removeNodes(chart, ids));
        select(null);
        announce(ids.length === 1 ? 'Deleted the box' : `Deleted ${ids.length} boxes`);
        return true;
      }
      if (selection?.kind === 'edge') {
        change(removeEdge(chart, selection.index));
        select(null);
        announce('Deleted the arrow');
        return true;
      }
      return false;
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight': {
      const centres = rects();
      if (!centres.size) return false;
      if (!one) {
        const first = chart.nodes[0];
        if (first) select({ kind: 'nodes', ids: [first.id] });
        return !!first;
      }
      const from = centres.get(one);
      if (!from) return false;
      const dir = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      }[event.key]!;
      let best: string | null = null;
      let bestScore = Infinity;
      for (const [id, c] of centres) {
        if (id === one || id.startsWith('group:')) continue;
        const dx = c.x - from.x;
        const dy = c.y - from.y;
        const along = dx * dir[0]! + dy * dir[1]!;
        if (along <= 1) continue;
        const across = Math.abs(dx * dir[1]! - dy * dir[0]!);
        const score = along + across * 2;
        if (score < bestScore) {
          bestScore = score;
          best = id;
        }
      }
      if (best) {
        select({ kind: 'nodes', ids: [best] });
        announce(chart.nodes.find((n) => n.id === best)?.label ?? best);
      }
      return true;
    }
    case 'Escape':
      if (selection) {
        select(null);
        return true;
      }
      return false;
    default:
      return false;
  }
}
