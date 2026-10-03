import {
  DIAGRAM_COLOURS,
  DIAGRAM_SWATCHES,
  FLOW_SHAPES,
  type DiagramColour,
  type FlowDirection,
  type FlowHead,
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
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, SegmentedControl, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { keysLabel } from '../../shell/shortcuts';
import type { CanvasView } from './Canvas';
import { TextField } from './fields';
import type { HitMap } from './hits';
import type { EditStart } from './keys';
import { withText } from './labels';
import {
  NEW_BOX,
  addNode,
  addSibling,
  connect,
  groupNodes,
  groupTree,
  moveToGroup,
  removeEdge,
  removeGroup,
  removeNodes,
  reverseEdge,
  setDirection,
  ungroup,
  updateEdge,
  updateGroup,
  updateNode,
} from './ops';
import { Section, type PanelProps } from './panel';
import { itemKey, type Item, type Selection } from './selection';

/*
 * Editing a flowchart (§9.4). On the drawing: click a box, an arrow or a group to select it
 * (Shift adds boxes, and Shift and a drag selects the boxes it encloses), double-click (or
 * Enter, F2, or just type) to edit its words in place; + beside a selected box adds a
 * connected one, the other + one beside it; drag a box onto another to connect them, onto a
 * group to put it in, out of its group to take it out. The panel holds the same and more:
 * shapes, colours, arrow styles, groups and the direction, and a list of every box with its
 * arrows, which is also the way to edit with the keyboard or a screen reader.
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

interface ExtrasProps {
  view: CanvasView;
  chart: Flowchart;
  map: HitMap;
  selection: Selection;
  editing: EditStart | null;
  change: PanelProps<Flowchart>['change'];
  announce: (message: string) => void;
}

/** The flowchart's own controls on the drawing: + handles, and dragging boxes. */
export function FlowchartExtras({
  view,
  chart,
  map,
  selection,
  editing,
  change,
  announce,
}: ExtrasProps) {
  const { svg, viewport, spotOf, place } = view;
  const latest = useRef({ chart, map, change, announce });
  useLayoutEffect(() => {
    latest.current = { chart, map, change, announce };
  });
  const [link, setLink] = useState<{
    from: string;
    x: number;
    y: number;
    over: Item | null;
  } | null>(null);

  // Dragging a box: onto a box connects them, onto a group puts it in, out of its group takes
  // it out.
  useEffect(() => {
    if (!svg || !viewport) return;
    let press: { from: string; x: number; y: number; dragging: boolean } | null = null;
    const target = (e: PointerEvent) => {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      return under?.closest('svg') === svg ? latest.current.map.itemAt(under) : null;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.shiftKey) return;
      const item = latest.current.map.itemAt(e.target as Element);
      if (item?.kind === 'node')
        press = { from: item.id, x: e.clientX, y: e.clientY, dragging: false };
    };
    const move = (e: PointerEvent) => {
      if (!press) return;
      if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      press.dragging = true;
      const outer = viewport.getBoundingClientRect();
      const over = target(e);
      setLink({
        from: press.from,
        x: e.clientX - outer.left,
        y: e.clientY - outer.top,
        over: over && !(over.kind === 'node' && over.id === press.from) ? over : null,
      });
    };
    const up = (e: PointerEvent) => {
      const p = press;
      press = null;
      if (!p?.dragging) return;
      setLink(null);
      const { chart: current, change, announce } = latest.current;
      const label = (id: string) => current.nodes.find((n) => n.id === id)?.label || id;
      const over = target(e);
      const node = current.nodes.find((n) => n.id === p.from);
      if (over?.kind === 'node' && over.id !== p.from) {
        change(connect(current, p.from, over.id));
        announce(`Connected ${label(p.from)} to ${label(over.id)}`);
      } else if (over?.kind === 'group' && node && node.group !== over.id) {
        change(moveToGroup(current, [p.from], over.id), {
          select: { kind: 'nodes', ids: [p.from] },
        });
        announce(`Put ${label(p.from)} in the group`);
      } else if (!over && node?.group) {
        change(moveToGroup(current, [p.from], null), { select: { kind: 'nodes', ids: [p.from] } });
        announce(`Took ${label(p.from)} out of the group`);
      }
    };
    svg.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      svg.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [svg, viewport]);

  const rectOf = (item: Item) => {
    const hit = map.hitOf(item);
    const element = hit?.elements[0];
    return element ? place(spotOf(element)) : undefined;
  };
  const single =
    selection?.kind === 'nodes' && selection.ids.length === 1 ? selection.ids[0]! : null;
  const singleRect = single ? rectOf({ kind: 'node', id: single }) : undefined;
  const forward = chart.direction === 'LR' || chart.direction === 'RL';
  const add = (how: 'after' | 'beside') => {
    if (!single) return;
    const added = how === 'after' ? addNode(chart, { from: single }) : addSibling(chart, single);
    const item: Item = { kind: 'node', id: added.id };
    change(added.chart, {
      select: { kind: 'nodes', ids: [added.id] },
      edit: { item, anchor: { kind: 'node', id: single } },
      announce: how === 'after' ? 'Added a connected box' : 'Added a box beside it',
    });
  };
  const from = link ? rectOf({ kind: 'node', id: link.from }) : undefined;
  const over = link?.over ? rectOf(link.over) : undefined;

  return (
    <>
      {single && singleRect && !editing && (
        <>
          <button
            type="button"
            className="diagram-overlay-control diagram-plus"
            title={`Add a connected box (${keysLabel('Tab')})`}
            aria-label="Add a connected box"
            style={
              forward
                ? { left: singleRect.right + 12, top: singleRect.y + singleRect.height / 2 - 12 }
                : { left: singleRect.x + singleRect.width / 2 - 12, top: singleRect.bottom + 12 }
            }
            onClick={() => add('after')}
          >
            <Plus aria-hidden />
          </button>
          <button
            type="button"
            className="diagram-overlay-control diagram-plus is-beside"
            title={`Add a box beside it (${keysLabel('Shift Enter')})`}
            aria-label="Add a box beside it"
            style={
              forward
                ? { left: singleRect.x + singleRect.width / 2 - 10, top: singleRect.bottom + 10 }
                : { left: singleRect.right + 10, top: singleRect.y + singleRect.height / 2 - 10 }
            }
            onClick={() => add('beside')}
          >
            <Plus aria-hidden />
          </button>
        </>
      )}
      {over && (
        <div
          className={cn('diagram-ring is-target', link?.over?.kind === 'group' && 'is-group')}
          style={{
            left: over.x - 5,
            top: over.y - 5,
            width: over.width + 10,
            height: over.height + 10,
          }}
        />
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
    </>
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
        title={`No colour (${keysLabel('Alt 0')})`}
        className={cn('diagram-swatch is-none', value === null && 'is-on')}
        onClick={() => onPick(null)}
      />
      {DIAGRAM_COLOURS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={DIAGRAM_SWATCHES[c].label}
          title={`${DIAGRAM_SWATCHES[c].label} (${keysLabel(`Alt ${i + 1}`)})`}
          className={cn('diagram-swatch', value === c && 'is-on')}
          style={{ background: DIAGRAM_SWATCHES[c].fill, borderColor: DIAGRAM_SWATCHES[c].stroke }}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

const LINES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'thick', label: 'Thick' },
] as const;
const HEADS: { value: FlowHead; label: string }[] = [
  { value: 'arrow', label: 'Arrow' },
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'cross', label: 'Cross' },
];

/** The side panel of a flowchart. */
export function FlowchartPanel({
  model: chart,
  change,
  selection,
  select,
  announce,
}: PanelProps<Flowchart>) {
  const nodeLabel = (id: string) =>
    chart.nodes.find((n) => n.id === id)?.label ||
    chart.groups.find((g) => g.id === id)?.label ||
    id;
  const ids = selection?.kind === 'nodes' ? selection.ids : [];
  const nodes = chart.nodes.filter((n) => ids.includes(n.id));
  const node = nodes.length === 1 ? nodes[0]! : null;
  const edgeIndex = selection?.kind === 'edge' ? selection.index : null;
  const edge = edgeIndex !== null ? chart.edges[edgeIndex] : undefined;
  const group =
    selection?.kind === 'group' ? chart.groups.find((g) => g.id === selection.id) : undefined;
  const groupOptions = [
    { value: '-', label: 'No group' },
    ...chart.groups.map((g) => ({ value: g.id, label: g.label || g.id })),
  ];
  const text = (item: Item) => (value: string) =>
    change(withText(chart, item, value), { merge: itemKey(item) });
  const selectOnFocus = (next: Selection) => () => {
    if (JSON.stringify(next) !== JSON.stringify(selection)) select(next);
  };

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
            const item: Item = { kind: 'node', id: added.id };
            change(added.chart, {
              select: { kind: 'nodes', ids: [added.id] },
              edit: { item },
              announce: 'Added a box',
            });
          }}
        >
          <Plus aria-hidden /> Add a box
        </Button>
      </Section>

      {node && (
        <Section title="Box">
          <label className="diagram-field">
            <span>Label</span>
            <TextField
              multiline
              value={node.label}
              onValueChange={text({ kind: 'node', id: node.id })}
              data-field="label"
            />
          </label>
          <div className="diagram-field">
            <span id="diagram-shape-label">Shape</span>
            <div className="diagram-shapes" role="radiogroup" aria-labelledby="diagram-shape-label">
              {FLOW_SHAPES.map((shape, i) => (
                <button
                  key={shape}
                  type="button"
                  role="radio"
                  aria-checked={node.shape === shape}
                  aria-label={SHAPE_NAMES[shape]}
                  title={
                    i < 9
                      ? `${SHAPE_NAMES[shape]} (${keysLabel(`Mod ${i + 1}`)})`
                      : SHAPE_NAMES[shape]
                  }
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
          {chart.groups.length > 0 && (
            <label className="diagram-field">
              <span>Group</span>
              <Select
                aria-label="Group"
                value={node.group ?? '-'}
                options={groupOptions}
                onValueChange={(g) => change(moveToGroup(chart, [node.id], g === '-' ? null : g))}
              />
            </label>
          )}
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
                const item: Item = { kind: 'node', id: added.id };
                change(added.chart, {
                  select: { kind: 'nodes', ids: [added.id] },
                  edit: { item, anchor: { kind: 'node', id: node.id } },
                  announce: 'Added a connected box',
                });
              }}
            >
              <Plus aria-hidden /> Connected box
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                change(removeNodes(chart, [node.id]), { select: null, announce: 'Deleted the box' })
              }
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
          {chart.groups.length > 0 && (
            <label className="diagram-field">
              <span>Group</span>
              <Select
                aria-label="Group"
                value={
                  nodes.every((n) => n.group === nodes[0]!.group) ? (nodes[0]!.group ?? '-') : ''
                }
                placeholder="Several groups"
                options={groupOptions}
                onValueChange={(g) => change(moveToGroup(chart, ids, g === '-' ? null : g))}
              />
            </label>
          )}
          <div className="diagram-actions">
            <Button
              size="sm"
              onClick={() => {
                const grouped = groupNodes(chart, ids);
                change(grouped.chart, {
                  select: { kind: 'group', id: grouped.id },
                  edit: { item: { kind: 'group', id: grouped.id } },
                  announce: 'Grouped the boxes',
                });
              }}
            >
              <Group aria-hidden /> Group them
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                change(removeNodes(chart, ids), {
                  select: null,
                  announce: `Deleted ${ids.length} boxes`,
                })
              }
            >
              <Trash2 aria-hidden /> Delete
            </Button>
          </div>
        </Section>
      )}

      {edge && edgeIndex !== null && (
        <Section title={`Arrow: ${nodeLabel(edge.from)} → ${nodeLabel(edge.to)}`}>
          <label className="diagram-field">
            <span>Label</span>
            <TextField
              multiline
              value={edge.label}
              placeholder="No label"
              onValueChange={text({ kind: 'edge', index: edgeIndex })}
              data-field="label"
            />
          </label>
          <div className="diagram-field">
            <span>Line</span>
            <SegmentedControl
              label="Line"
              value={edge.line === 'invisible' ? 'solid' : edge.line}
              onValueChange={(line) => change(updateEdge(chart, edgeIndex, { line }))}
              segments={[...LINES]}
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
                  change(updateEdge(chart, edgeIndex, { start: v as FlowHead }))
                }
              />
            </label>
            <label className="diagram-field">
              <span>End</span>
              <Select
                aria-label="Arrow end"
                value={edge.end}
                options={HEADS}
                onValueChange={(v) => change(updateEdge(chart, edgeIndex, { end: v as FlowHead }))}
              />
            </label>
          </div>
          <div className="diagram-actions">
            <Button size="sm" onClick={() => change(reverseEdge(chart, edgeIndex))}>
              <ArrowLeftRight aria-hidden /> Reverse
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                change(removeEdge(chart, edgeIndex), {
                  select: null,
                  announce: 'Deleted the arrow',
                })
              }
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
            <TextField
              value={group.label}
              onValueChange={text({ kind: 'group', id: group.id })}
              data-field="label"
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
              onClick={() =>
                change(ungroup(chart, group.id), {
                  select: null,
                  announce: 'Removed the group; its boxes stay',
                })
              }
            >
              <Ungroup aria-hidden /> Ungroup
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                const inside = groupTree(chart, group.id);
                const count = chart.nodes.filter((n) => n.group && inside.has(n.group)).length;
                change(removeGroup(chart, group.id), {
                  select: null,
                  announce: `Deleted the group and its ${count} boxes`,
                });
              }}
            >
              <Trash2 aria-hidden /> Delete with its boxes
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
                  data-item={itemKey({ kind: 'node', id: n.id })}
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
                          data-item={itemKey({ kind: 'edge', index: i })}
                          className={cn(
                            'diagram-outline-item is-arrow',
                            edgeIndex === i && 'is-on',
                          )}
                          aria-pressed={edgeIndex === i}
                          onClick={selectOnFocus({ kind: 'edge', index: i })}
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
                  data-item={itemKey({ kind: 'group', id: g.id })}
                  className={cn(
                    'diagram-outline-item is-group',
                    selection?.kind === 'group' && selection.id === g.id && 'is-on',
                  )}
                  aria-pressed={selection?.kind === 'group' && selection.id === g.id}
                  onClick={selectOnFocus({ kind: 'group', id: g.id })}
                >
                  Group: {g.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="diagram-hint">
        Double-click, F2 or just type to edit words on the drawing. Drag a box onto another to
        connect them, onto a group to put it in. Shift and a drag selects several boxes. Press ? for
        every key.
      </p>
    </div>
  );
}
