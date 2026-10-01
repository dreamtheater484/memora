import {
  DIAGRAM_COLOURS,
  DIAGRAM_SWATCHES,
  FLOW_SHAPES,
  type DiagramColour,
  type FlowDirection,
  type FlowHead,
  type FlowLine,
  type FlowShape,
  type Flowchart,
} from '@memora/shared';
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Group,
  Plus,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Input, SegmentedControl, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import type { CanvasView, Spot } from './Canvas';
import {
  NEW_BOX,
  addNode,
  addSibling,
  connect,
  edgeDomId,
  groupNodes,
  removeEdge,
  removeNodes,
  reverseEdge,
  setDirection,
  ungroup,
  updateEdge,
  updateGroup,
  updateNode,
} from './ops';
import {
  edgeIndexOf,
  groupIdOf,
  nodeIdOf,
  type FlowEditorProps,
  type FlowSelection,
} from './flowchartDom';

/*
 * Editing a flowchart (§9.4). On the drawing: click a box or an arrow to select it
 * (Shift adds boxes), double-click a box (or Enter, F2) to rename it in place, + beside a
 * selected box adds a connected one (+ on its other side adds one beside it), and dragging a
 * box onto another connects them. The panel holds the same and more: shapes, colours,
 * arrow styles, groups and the direction, and a list of every box with its connections,
 * which is also the way to edit with the keyboard or a screen reader.
 */

const SHAPE_NAMES: Record<FlowShape, string> = {
  rect: 'Rectangle',
  round: 'Rounded',
  stadium: 'Pill',
  diamond: 'Decision',
  circle: 'Circle',
  hexagon: 'Hexagon',
  parallelogram: 'Input or output',
  cylinder: 'Database',
  subroutine: 'Subroutine',
  'double-circle': 'Double circle',
  asymmetric: 'Flag',
  'parallelogram-alt': 'Slanted the other way',
  trapezoid: 'Trapezoid',
  'trapezoid-alt': 'Upside-down trapezoid',
};

/** Small outlines of each shape, for the shape picker. */
function ShapeIcon({ shape }: { shape: FlowShape }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };
  const body: Record<FlowShape, ReactNode> = {
    rect: <rect x="2" y="5" width="20" height="14" {...common} />,
    round: <rect x="2" y="5" width="20" height="14" rx="4" {...common} />,
    stadium: <rect x="2" y="5" width="20" height="14" rx="7" {...common} />,
    diamond: <path d="M12 2 22 12 12 22 2 12Z" {...common} />,
    circle: <circle cx="12" cy="12" r="9" {...common} />,
    hexagon: <path d="M6 4h12l4 8-4 8H6l-4-8Z" {...common} />,
    parallelogram: <path d="M6 5h16l-4 14H2Z" {...common} />,
    cylinder: (
      <>
        <ellipse cx="12" cy="6" rx="9" ry="3" {...common} />
        <path d="M3 6v12c0 1.7 4 3 9 3s9-1.3 9-3V6" {...common} />
      </>
    ),
    subroutine: (
      <>
        <rect x="2" y="5" width="20" height="14" {...common} />
        <path d="M6 5v14M18 5v14" {...common} />
      </>
    ),
    'double-circle': (
      <>
        <circle cx="12" cy="12" r="9" {...common} />
        <circle cx="12" cy="12" r="6" {...common} />
      </>
    ),
    asymmetric: <path d="M2 5h20v14H2l5-7Z" {...common} />,
    'parallelogram-alt': <path d="M2 5h16l4 14H6Z" {...common} />,
    trapezoid: <path d="M6 5h12l4 14H2Z" {...common} />,
    'trapezoid-alt': <path d="M2 5h20l-4 14H6Z" {...common} />,
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      {body[shape]}
    </svg>
  );
}

/** The overlay on the drawing: selections, + handles, dragging to connect, renaming. */
export function FlowchartOverlay({
  view,
  chart,
  change,
  selection,
  select,
  editing,
  setEditing,
  announce,
}: FlowEditorProps & { view: CanvasView }) {
  const { svg, viewport, spotOf, place } = view;
  // The latest props, for the drawing's event handlers (attached once per drawing).
  const latest = useRef({ chart, selection, change, select, setEditing, announce });
  useLayoutEffect(() => {
    latest.current = { chart, selection, change, select, setEditing, announce };
  });
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);

  // Wide, invisible copies of the arrows, so a thin line is easy to click.
  useEffect(() => {
    if (!svg) return;
    for (const path of svg.querySelectorAll<SVGPathElement>('path[data-id^="L_"]')) {
      if (path.classList.contains('diagram-hit')) continue;
      const hit = path.cloneNode(false) as SVGPathElement;
      hit.removeAttribute('id');
      hit.removeAttribute('marker-end');
      hit.removeAttribute('marker-start');
      hit.removeAttribute('style');
      hit.setAttribute('class', 'diagram-hit');
      hit.setAttribute('data-edge-id', path.getAttribute('data-id') ?? '');
      path.after(hit);
    }
  }, [svg]);

  // A selected arrow is marked on the drawing itself.
  useEffect(() => {
    if (!svg) return;
    svg.querySelectorAll('.is-selected').forEach((e) => e.classList.remove('is-selected'));
    if (selection?.kind === 'edge' && chart.edges[selection.index]) {
      const id = edgeDomId(chart, selection.index);
      svg
        .querySelector(`path[data-id="${CSS.escape(id)}"]:not(.diagram-hit)`)
        ?.classList.add('is-selected');
    }
  }, [svg, selection, chart]);

  // Clicks and drags on the drawing.
  useEffect(() => {
    if (!svg || !viewport) return;
    const { change, select, setEditing, announce } = {
      change: (next: Flowchart) => latest.current.change(next),
      select: (next: FlowSelection) => latest.current.select(next),
      setEditing: (id: string | null) => latest.current.setEditing(id),
      announce: (message: string) => latest.current.announce(message),
    };
    let press: { from: string; x: number; y: number; dragging: boolean } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const id = nodeIdOf(svg, e.target as Element);
      if (id) press = { from: id, x: e.clientX, y: e.clientY, dragging: false };
    };
    const move = (e: PointerEvent) => {
      if (!press) return;
      if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      press.dragging = true;
      const outer = viewport.getBoundingClientRect();
      setLink({ from: press.from, x: e.clientX - outer.left, y: e.clientY - outer.top });
    };
    const up = (e: PointerEvent) => {
      const p = press;
      press = null;
      if (!p?.dragging) return;
      setLink(null);
      const to = nodeIdOf(svg, document.elementFromPoint(e.clientX, e.clientY));
      if (to && to !== p.from) {
        const { chart: current } = latest.current;
        change(connect(current, p.from, to));
        const label = (id: string) => current.nodes.find((n) => n.id === id)?.label ?? id;
        announce(`Connected ${label(p.from)} to ${label(to)}`);
      }
    };
    const click = (e: MouseEvent) => {
      const target = e.target as Element;
      const { chart: current, selection: selected } = latest.current;
      const node = nodeIdOf(svg, target);
      if (node) {
        if (e.shiftKey && selected?.kind === 'nodes') {
          const ids = selected.ids.includes(node)
            ? selected.ids.filter((i) => i !== node)
            : [...selected.ids, node];
          select({ kind: 'nodes', ids });
        } else select({ kind: 'nodes', ids: [node] });
        return;
      }
      const edge = edgeIndexOf(current, target);
      if (edge !== null) {
        select({ kind: 'edge', index: edge });
        return;
      }
      const group = groupIdOf(svg, target);
      if (group) select({ kind: 'group', id: group });
    };
    const dblclick = (e: MouseEvent) => {
      const node = nodeIdOf(svg, e.target as Element);
      if (node) {
        select({ kind: 'nodes', ids: [node] });
        setEditing(node);
      }
    };
    svg.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    svg.addEventListener('click', click);
    svg.addEventListener('dblclick', dblclick);
    return () => {
      svg.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      svg.removeEventListener('click', click);
      svg.removeEventListener('dblclick', dblclick);
    };
  }, [svg, viewport]);

  // Where each box and group is in the drawing, measured once per drawing.
  const spots = useMemo(() => {
    const out = new Map<string, Spot>();
    if (!svg) return out;
    for (const g of svg.querySelectorAll('g.node')) {
      const id = nodeIdOf(svg, g);
      if (id) out.set(id, spotOf(g));
    }
    for (const g of svg.querySelectorAll('g.cluster')) {
      const id = groupIdOf(svg, g);
      if (id) out.set(`group:${id}`, spotOf(g));
    }
    return out;
  }, [svg, spotOf]);
  const rect = (id: string) => {
    const spot = spots.get(id);
    return spot ? place(spot) : undefined;
  };

  const single =
    selection?.kind === 'nodes' && selection.ids.length === 1 ? selection.ids[0]! : null;
  const singleRect = single ? rect(single) : undefined;
  const forward = chart.direction === 'LR' || chart.direction === 'RL';
  const addAfter = (from: string) => {
    const added = addNode(chart, { from });
    change(added.chart);
    select({ kind: 'nodes', ids: [added.id] });
    setEditing(added.id);
    announce('Added a connected box');
  };
  const addBeside = (of: string) => {
    const added = addSibling(chart, of);
    change(added.chart);
    select({ kind: 'nodes', ids: [added.id] });
    setEditing(added.id);
    announce('Added a box beside it');
  };

  const from = link ? rect(link.from) : undefined;
  // A box just added isn't drawn yet: its label is typed beside the box it follows meanwhile,
  // so nothing typed is lost.
  const provisional = () => {
    const parent = chart.edges.find((e) => e.to === editing)?.from;
    const r = parent ? rect(parent) : undefined;
    if (!r) return new DOMRect(40, 40, 160, 40);
    return forward
      ? new DOMRect(r.right + 40, r.y, Math.max(r.width, 120), r.height)
      : new DOMRect(r.x, r.bottom + 40, Math.max(r.width, 120), r.height);
  };
  const editingRect = editing ? (rect(editing) ?? provisional()) : undefined;
  const groupRect = selection?.kind === 'group' ? rect(`group:${selection.id}`) : undefined;
  return (
    <div className="diagram-overlay">
      {selection?.kind === 'nodes' &&
        selection.ids.map((id) => {
          const r = rect(id);
          return r ? (
            <div
              key={id}
              className="diagram-ring"
              style={{ left: r.x - 5, top: r.y - 5, width: r.width + 10, height: r.height + 10 }}
            />
          ) : null;
        })}
      {groupRect && (
        <div
          className="diagram-ring is-group"
          style={{
            left: groupRect.x - 4,
            top: groupRect.y - 4,
            width: groupRect.width + 8,
            height: groupRect.height + 8,
          }}
        />
      )}
      {single && singleRect && !editing && (
        <>
          <button
            type="button"
            className="diagram-overlay-control diagram-plus"
            title="Add a connected box (Tab)"
            aria-label="Add a connected box"
            style={
              forward
                ? { left: singleRect.right + 12, top: singleRect.y + singleRect.height / 2 - 12 }
                : { left: singleRect.x + singleRect.width / 2 - 12, top: singleRect.bottom + 12 }
            }
            onClick={() => addAfter(single)}
          >
            <Plus aria-hidden />
          </button>
          <button
            type="button"
            className="diagram-overlay-control diagram-plus is-beside"
            title="Add a box beside it (Shift+Enter)"
            aria-label="Add a box beside it"
            style={
              forward
                ? { left: singleRect.x + singleRect.width / 2 - 10, top: singleRect.bottom + 10 }
                : { left: singleRect.right + 10, top: singleRect.y + singleRect.height / 2 - 10 }
            }
            onClick={() => addBeside(single)}
          >
            <Plus aria-hidden />
          </button>
        </>
      )}
      {link && from && (
        <svg className="diagram-link" aria-hidden>
          <line
            x1={from.x + from.width / 2}
            y1={from.y + from.height / 2}
            x2={link.x}
            y2={link.y}
          />
        </svg>
      )}
      {editing && editingRect && (
        <LabelInput
          key={editing}
          rect={editingRect}
          scale={view.scale}
          value={chart.nodes.find((n) => n.id === editing)?.label ?? ''}
          onCommit={(label, then) => {
            const node = chart.nodes.find((n) => n.id === editing);
            let next = chart;
            if (node && label && label !== node.label) next = updateNode(chart, editing, { label });
            if (next !== chart) change(next);
            setEditing(null);
            if (then !== 'next') viewport?.focus();
            if (then === 'next') {
              const added = addNode(next, { from: editing });
              change(added.chart);
              select({ kind: 'nodes', ids: [added.id] });
              setEditing(added.id);
            }
          }}
          onCancel={() => {
            setEditing(null);
            viewport?.focus();
          }}
        />
      )}
    </div>
  );
}

/** The input over a box while it is renamed; Tab also adds the next box. */
function LabelInput({
  rect,
  scale,
  value,
  onCommit,
  onCancel,
}: {
  rect: DOMRect;
  scale: number;
  value: string;
  onCommit: (label: string, then?: 'next') => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const commit = (then?: 'next') => {
    if (done.current) return;
    done.current = true;
    onCommit(text.trim(), then);
  };
  const width = Math.max(rect.width, 140 * Math.min(scale, 1));
  return (
    <input
      className="diagram-overlay-control diagram-label-input"
      aria-label="Box label"
      autoFocus
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          commit('next');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done.current = true;
          onCancel();
        }
      }}
      style={{
        left: rect.x + rect.width / 2 - width / 2,
        top: rect.y + rect.height / 2 - 18,
        width,
        fontSize: Math.max(12, Math.min(18, 15 * scale)),
      }}
    />
  );
}

const DIRECTIONS: { value: FlowDirection; label: string; icon: ReactNode }[] = [
  { value: 'LR', label: 'Left to right', icon: <ArrowRight /> },
  { value: 'TB', label: 'Top to bottom', icon: <ArrowDown /> },
  { value: 'RL', label: 'Right to left', icon: <ArrowLeft /> },
  { value: 'BT', label: 'Bottom to top', icon: <ArrowUp /> },
];

function Colours({
  value,
  onPick,
}: {
  value: DiagramColour | null;
  onPick: (colour: DiagramColour | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label="No colour"
        title="No colour"
        className={cn('diagram-swatch is-none', value === null && 'is-on')}
        onClick={() => onPick(null)}
      />
      {DIAGRAM_COLOURS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={DIAGRAM_SWATCHES[c].label}
          title={DIAGRAM_SWATCHES[c].label}
          className={cn('diagram-swatch', value === c && 'is-on')}
          style={{ background: DIAGRAM_SWATCHES[c].fill, borderColor: DIAGRAM_SWATCHES[c].stroke }}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

const LINES: { value: FlowLine; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'thick', label: 'Thick' },
];
const HEADS: { value: FlowHead; label: string }[] = [
  { value: 'arrow', label: 'Arrow' },
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'cross', label: 'Cross' },
];

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="diagram-panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** The side panel of a flowchart. */
export function FlowchartPanel(props: FlowEditorProps) {
  const { chart, change, selection, select, setEditing, announce } = props;
  const nodeLabel = (id: string) =>
    chart.nodes.find((n) => n.id === id)?.label ??
    chart.groups.find((g) => g.id === id)?.label ??
    id;
  const ids = selection?.kind === 'nodes' ? selection.ids : [];
  const nodes = chart.nodes.filter((n) => ids.includes(n.id));
  const node = nodes.length === 1 ? nodes[0]! : null;
  const edge = selection?.kind === 'edge' ? chart.edges[selection.index] : undefined;
  const group =
    selection?.kind === 'group' ? chart.groups.find((g) => g.id === selection.id) : undefined;

  return (
    <div className="diagram-panel">
      <Section title="Layout">
        <SegmentedControl
          label="Direction"
          value={chart.direction}
          onValueChange={(d) => change(setDirection(chart, d))}
          segments={DIRECTIONS.map((d) => ({ ...d, iconOnly: true }))}
        />
        <Button
          size="sm"
          onClick={() => {
            const added = addNode(chart, { group: null });
            change(added.chart);
            select({ kind: 'nodes', ids: [added.id] });
            setEditing(added.id);
            announce('Added a box');
          }}
        >
          <Plus aria-hidden /> Add a box
        </Button>
      </Section>

      {node && (
        <Section title="Box">
          <label className="diagram-field">
            <span>Label</span>
            <Input
              value={node.label}
              onChange={(e) =>
                change(updateNode(chart, node.id, { label: e.target.value }), `label:${node.id}`)
              }
            />
          </label>
          <div className="diagram-field">
            <span id="diagram-shape-label">Shape</span>
            <div className="diagram-shapes" role="radiogroup" aria-labelledby="diagram-shape-label">
              {FLOW_SHAPES.slice(0, 10).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  role="radio"
                  aria-checked={node.shape === shape}
                  aria-label={SHAPE_NAMES[shape]}
                  title={SHAPE_NAMES[shape]}
                  className={cn('diagram-shape', node.shape === shape && 'is-on')}
                  onClick={() => change(updateNode(chart, node.id, { shape }))}
                >
                  <ShapeIcon shape={shape} />
                </button>
              ))}
            </div>
          </div>
          <div className="diagram-field">
            <span>Colour</span>
            <Colours
              value={node.colour}
              onPick={(colour) => change(updateNode(chart, node.id, { colour }))}
            />
          </div>
          <label className="diagram-field">
            <span>Connect to</span>
            <Select
              aria-label="Connect to"
              placeholder="Choose a box…"
              value=""
              options={chart.nodes
                .filter((n) => n.id !== node.id)
                .map((n) => ({ value: n.id, label: n.label || n.id }))}
              onValueChange={(to) => {
                change(connect(chart, node.id, to));
                announce(`Connected ${node.label} to ${nodeLabel(to)}`);
              }}
            />
          </label>
          <div className="diagram-actions">
            <Button
              size="sm"
              onClick={() => {
                const added = addNode(chart, { from: node.id });
                change(added.chart);
                select({ kind: 'nodes', ids: [added.id] });
                setEditing(added.id);
              }}
            >
              <Plus aria-hidden /> Connected box
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                change(removeNodes(chart, [node.id]));
                select(null);
                announce('Deleted the box');
              }}
            >
              <Trash2 aria-hidden /> Delete
            </Button>
          </div>
        </Section>
      )}

      {nodes.length > 1 && (
        <Section title={`${nodes.length} boxes`}>
          <div className="diagram-field">
            <span>Colour</span>
            <Colours
              value={nodes.every((n) => n.colour === nodes[0]!.colour) ? nodes[0]!.colour : null}
              onPick={(colour) => {
                let next = chart;
                for (const n of nodes) next = updateNode(next, n.id, { colour });
                change(next);
              }}
            />
          </div>
          <div className="diagram-actions">
            <Button
              size="sm"
              onClick={() => {
                const grouped = groupNodes(chart, ids);
                change(grouped.chart);
                select({ kind: 'group', id: grouped.id });
                announce('Grouped the boxes');
              }}
            >
              <Group aria-hidden /> Group them
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                change(removeNodes(chart, ids));
                select(null);
              }}
            >
              <Trash2 aria-hidden /> Delete
            </Button>
          </div>
        </Section>
      )}

      {edge && selection?.kind === 'edge' && (
        <Section title={`Arrow: ${nodeLabel(edge.from)} → ${nodeLabel(edge.to)}`}>
          <label className="diagram-field">
            <span>Label</span>
            <Input
              value={edge.label}
              placeholder="No label"
              onChange={(e) =>
                change(
                  updateEdge(chart, selection.index, { label: e.target.value }),
                  `edge:${selection.index}`,
                )
              }
            />
          </label>
          <div className="diagram-field">
            <span>Line</span>
            <SegmentedControl
              label="Line"
              value={edge.line === 'invisible' ? 'solid' : edge.line}
              onValueChange={(line) => change(updateEdge(chart, selection.index, { line }))}
              segments={LINES}
            />
          </div>
          <div className="diagram-field-row">
            <label className="diagram-field">
              <span>Start</span>
              <Select
                aria-label="Arrow start"
                value={edge.start}
                options={HEADS}
                onValueChange={(v) =>
                  change(updateEdge(chart, selection.index, { start: v as FlowHead }))
                }
              />
            </label>
            <label className="diagram-field">
              <span>End</span>
              <Select
                aria-label="Arrow end"
                value={edge.end}
                options={HEADS}
                onValueChange={(v) =>
                  change(updateEdge(chart, selection.index, { end: v as FlowHead }))
                }
              />
            </label>
          </div>
          <div className="diagram-actions">
            <Button size="sm" onClick={() => change(reverseEdge(chart, selection.index))}>
              <ArrowLeftRight aria-hidden /> Reverse
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                change(removeEdge(chart, selection.index));
                select(null);
                announce('Deleted the arrow');
              }}
            >
              <Trash2 aria-hidden /> Delete
            </Button>
          </div>
        </Section>
      )}

      {group && (
        <Section title="Group">
          <label className="diagram-field">
            <span>Name</span>
            <Input
              value={group.label}
              onChange={(e) =>
                change(updateGroup(chart, group.id, { label: e.target.value }), `group:${group.id}`)
              }
            />
          </label>
          <div className="diagram-field">
            <span>Direction inside</span>
            <Select
              aria-label="Direction inside the group"
              value={group.direction ?? 'auto'}
              options={[
                { value: 'auto', label: 'As the diagram' },
                ...DIRECTIONS.map((d) => ({ value: d.value, label: d.label })),
              ]}
              onValueChange={(v) =>
                change(
                  updateGroup(chart, group.id, {
                    direction: v === 'auto' ? null : (v as FlowDirection),
                  }),
                )
              }
            />
          </div>
          <div className="diagram-actions">
            <Button
              size="sm"
              onClick={() => {
                change(ungroup(chart, group.id));
                select(null);
                announce('Removed the group; its boxes stay');
              }}
            >
              <Ungroup aria-hidden /> Ungroup
            </Button>
          </div>
        </Section>
      )}

      <Section title="Boxes and arrows">
        <ul className="diagram-outline" aria-label="Boxes">
          {chart.nodes.map((n) => {
            const out = chart.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.from === n.id);
            const on = ids.includes(n.id);
            return (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn('diagram-outline-item', on && 'is-on')}
                  aria-pressed={on}
                  onClick={(e) =>
                    select(
                      e.shiftKey && selection?.kind === 'nodes'
                        ? {
                            kind: 'nodes',
                            ids: on ? ids.filter((i) => i !== n.id) : [...ids, n.id],
                          }
                        : { kind: 'nodes', ids: [n.id] },
                    )
                  }
                >
                  {n.colour && (
                    <span
                      aria-hidden
                      className="diagram-dot"
                      style={{ background: DIAGRAM_SWATCHES[n.colour].stroke }}
                    />
                  )}
                  {n.label || <i>{NEW_BOX}</i>}
                </button>
                {out.length > 0 && (
                  <ul aria-label={`Arrows from ${n.label}`}>
                    {out.map(({ e, i }) => (
                      <li key={i}>
                        <button
                          type="button"
                          className={cn(
                            'diagram-outline-item is-arrow',
                            selection?.kind === 'edge' && selection.index === i && 'is-on',
                          )}
                          onClick={() => select({ kind: 'edge', index: i })}
                        >
                          → {nodeLabel(e.to)}
                          {e.label && <span className="text-fg-3"> ({e.label})</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {chart.groups.length > 0 && (
          <ul className="diagram-outline" aria-label="Groups">
            {chart.groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className={cn(
                    'diagram-outline-item is-group',
                    selection?.kind === 'group' && selection.id === g.id && 'is-on',
                  )}
                  onClick={() => select({ kind: 'group', id: g.id })}
                >
                  Group: {g.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="diagram-hint">
        Double-click a box to rename it. Drag a box onto another to connect them. Tab adds a
        connected box, Shift+Enter one beside it, Delete removes the selection.
      </p>
    </div>
  );
}
