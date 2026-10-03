import { describe, expect, it } from 'vitest';
import {
  BRANCH_WORD,
  DIAGRAM_COLOURS,
  FLOW_SHAPES,
  GANTT_TAGS,
  MINDMAP_SHAPES,
  SEQUENCE_ARROWS,
  SEQUENCE_BLOCKS,
  diagramMeaning,
  parseDiagram,
  printDiagram,
  type DiagramModel,
  type FlowEdge,
  type FlowHead,
  type Flowchart,
  type Gantt,
  type GanttTask,
  type Mindmap,
  type MindmapTopic,
  type Pie,
  type SequenceBlockKind,
  type SequenceDiagram,
  type SequenceStep,
  type Timeline,
} from './index';
import { printCounts } from './source';
import { DIAGRAM_CORPUS, TEXT_SAMPLES, clone } from './testCorpus';

/*
 * Random edits, as the editor makes them (and some it doesn't yet), on every diagram of the
 * corpus: after each, the code written reads back as the model that was edited, and reading
 * it and writing it again gives the same code. A seeded generator makes failures repeatable.
 */

/** mulberry32: a small seeded random number generator. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(list: readonly T[]): T => list[int(list.length)]!;
  const WORDS = ['Plan', 'Ship it', 'Review', 'Paid?', 'Order received', 'Done', 'Next step'];
  return {
    int,
    pick,
    chance: (p: number) => next() < p,
    text: () => (next() < 0.6 ? pick(WORDS) : pick(TEXT_SAMPLES)),
  };
}
type Random = ReturnType<typeof random>;
type Edit<M> = (m: M, r: Random) => void;

const HEADS: FlowHead[] = ['none', 'arrow', 'circle', 'cross'];

const fresh = (used: Iterable<string>, prefix: string) => {
  const taken = new Set(used);
  let i = 1;
  while (taken.has(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
};

const arrow = (from: string, to: string): FlowEdge => ({
  from,
  to,
  label: '',
  line: 'solid',
  start: 'none',
  end: 'arrow',
  extra: 0,
});

const FLOW_EDITS: Edit<Flowchart>[] = [
  (m, r) => m.nodes.length && (r.pick(m.nodes).label = r.text()),
  (m, r) => m.nodes.length && (r.pick(m.nodes).shape = r.pick(FLOW_SHAPES)),
  (m, r) =>
    m.nodes.length && (r.pick(m.nodes).colour = r.chance(0.3) ? null : r.pick(DIAGRAM_COLOURS)),
  // A new box, connected from another and in its group (`addNode`).
  (m, r) => {
    const id = fresh([...m.nodes.map((n) => n.id), ...m.groups.map((g) => g.id)], 'n');
    const from = m.nodes.length && r.chance(0.7) ? r.pick(m.nodes) : null;
    const group = from ? from.group : m.groups.length && r.chance(0.3) ? r.pick(m.groups).id : null;
    m.nodes.push({ id, label: r.text(), shape: 'rect', colour: null, classes: [], group });
    if (from) m.edges.push(arrow(from.id, id));
  },
  // A box removed with its arrows (`removeNodes`).
  (m, r) => {
    if (!m.nodes.length) return;
    const id = r.pick(m.nodes).id;
    m.nodes = m.nodes.filter((n) => n.id !== id);
    m.edges = m.edges.filter((e) => e.from !== id && e.to !== id);
  },
  // Two boxes connected (`connect`).
  (m, r) => {
    if (m.nodes.length < 2) return;
    const a = r.pick(m.nodes).id;
    const b = r.pick(m.nodes).id;
    if (a !== b && !m.edges.some((e) => e.from === a && e.to === b)) m.edges.push(arrow(a, b));
  },
  (m, r) => m.edges.length && m.edges.splice(r.int(m.edges.length), 1),
  // An arrow restyled or relabelled (`updateEdge`).
  (m, r) => {
    if (!m.edges.length) return;
    const e = r.pick(m.edges);
    const what = r.int(5);
    if (what === 0) e.label = r.text();
    else if (what === 1) e.line = r.pick(['solid', 'dotted', 'thick', 'invisible'] as const);
    else if (what === 2) e.end = r.pick(HEADS);
    else if (what === 3) e.start = r.pick(HEADS);
    else e.extra = r.int(3);
  },
  // An arrow reversed (`reverseEdge`).
  (m, r) => {
    if (!m.edges.length) return;
    const e = r.pick(m.edges);
    [e.from, e.to] = [e.to, e.from];
    [e.start, e.end] = [e.end, e.start];
  },
  // Boxes put in a new group, inside the group they share (`groupNodes`).
  (m, r) => {
    const members = m.nodes.filter(() => r.chance(0.4));
    if (!members.length) return;
    const parents = new Set(members.map((n) => n.group));
    const id = fresh([...m.nodes.map((n) => n.id), ...m.groups.map((g) => g.id)], 'g');
    m.groups.push({
      id,
      label: r.text(),
      parent: parents.size === 1 ? [...parents][0]! : null,
      direction: null,
    });
    for (const n of members) n.group = id;
  },
  // A group removed, what it held kept in the group around it (`ungroup`).
  (m, r) => {
    if (!m.groups.length) return;
    const group = r.pick(m.groups);
    for (const n of m.nodes) if (n.group === group.id) n.group = group.parent;
    for (const g of m.groups) if (g.parent === group.id) g.parent = group.parent;
    m.groups = m.groups.filter((g) => g !== group);
    m.edges = m.edges.filter((e) => e.from !== group.id && e.to !== group.id);
  },
  (m, r) => {
    if (!m.groups.length) return;
    const g = r.pick(m.groups);
    if (r.chance(0.5)) g.label = r.text();
    else g.direction = r.chance(0.3) ? null : r.pick(['TB', 'BT', 'LR', 'RL'] as const);
  },
  (m, r) => (m.direction = r.pick(['TB', 'BT', 'LR', 'RL'] as const)),
];

/** Every list of steps, with where it is. */
function stepLists(steps: SequenceStep[], out: SequenceStep[][] = []): SequenceStep[][] {
  out.push(steps);
  for (const s of steps)
    if (s.kind === 'block') for (const b of s.branches) stepLists(b.steps, out);
  return out;
}
const allSteps = (m: SequenceDiagram) => stepLists(m.steps).flat();

const SEQUENCE_EDITS: Edit<SequenceDiagram>[] = [
  (m, r) => m.participants.length && (r.pick(m.participants).label = r.text()),
  (m, r) => {
    if (!m.participants.length) return;
    const p = r.pick(m.participants);
    p.kind = p.kind === 'actor' ? 'participant' : 'actor';
  },
  (m, r) =>
    m.participants.push({
      id: fresh(
        m.participants.map((p) => p.id),
        'P',
      ),
      label: r.text(),
      kind: 'participant',
    }),
  // A participant removed with its messages and notes (`removeParticipant`).
  (m, r) => {
    if (m.participants.length < 2) return;
    const id = r.pick(m.participants).id;
    m.participants = m.participants.filter((p) => p.id !== id);
    const keep = (steps: SequenceStep[]): SequenceStep[] =>
      steps.filter((s) => {
        if (s.kind === 'message') return s.from !== id && s.to !== id;
        if (s.kind === 'note') return !s.of.includes(id);
        if (s.kind === 'block') for (const b of s.branches) b.steps = keep(b.steps);
        return true;
      });
    m.steps = keep(m.steps);
  },
  (m, r) => {
    if (m.participants.length < 2) return;
    const i = 1 + r.int(m.participants.length - 1);
    const list = m.participants;
    [list[i - 1], list[i]] = [list[i]!, list[i - 1]!];
  },
  // A message or note changed.
  (m, r) => {
    const said = allSteps(m).filter((s) => s.kind === 'message' || s.kind === 'note');
    if (!said.length) return;
    const s = r.pick(said);
    if (s.kind === 'message') {
      const what = r.int(4);
      if (what === 0) s.text = r.text();
      else if (what === 1) s.arrow = r.pick(SEQUENCE_ARROWS);
      else if (what === 2 && m.participants.length) s.to = r.pick(m.participants).id;
      else s.activation = r.pick(['+', '-', null] as const);
    } else if (s.kind === 'note') {
      if (r.chance(0.6)) s.text = r.text();
      else s.side = r.pick(['left of', 'right of', 'over'] as const);
    }
  },
  // A step inserted in a list (`insertStep`).
  (m, r) => {
    const list = r.pick(stepLists(m.steps));
    const who = m.participants.length ? m.participants : [{ id: 'A' }];
    const step: SequenceStep = r.pick([
      {
        kind: 'message',
        from: r.pick(who).id,
        to: r.pick(who).id,
        arrow: '->>',
        text: r.text(),
        activation: null,
      },
      { kind: 'note', side: 'over', of: [r.pick(who).id], text: r.text() },
      { kind: 'block', block: r.pick(SEQUENCE_BLOCKS), branches: [{ text: r.text(), steps: [] }] },
    ] as SequenceStep[]);
    list.splice(r.int(list.length + 1), 0, step);
  },
  // A step removed; a block's steps stay in its place (`removeStep`).
  (m, r) => {
    const list = r.pick(stepLists(m.steps));
    if (!list.length) return;
    const at = r.int(list.length);
    const step = list[at]!;
    list.splice(at, 1, ...(step.kind === 'block' ? step.branches.flatMap((b) => b.steps) : []));
  },
  // A step moved up or down in its list (`moveStep`).
  (m, r) => {
    const list = r.pick(stepLists(m.steps));
    if (list.length < 2) return;
    const at = 1 + r.int(list.length - 1);
    [list[at - 1], list[at]] = [list[at]!, list[at - 1]!];
  },
  // A step moved into another list.
  (m, r) => {
    const lists = stepLists(m.steps);
    const from = r.pick(lists);
    if (!from.length) return;
    const [step] = from.splice(r.int(from.length), 1);
    const to = r.pick(stepLists(m.steps));
    to.splice(r.int(to.length + 1), 0, step!);
  },
  // Blocks: branches added, removed and relabelled, the kind changed.
  (m, r) => {
    const blocks = allSteps(m).filter((s) => s.kind === 'block');
    if (!blocks.length) return;
    const block = r.pick(blocks);
    if (block.kind !== 'block') return;
    const what = r.int(4);
    if (what === 0 && BRANCH_WORD[block.block]) block.branches.push({ text: '', steps: [] });
    else if (what === 1 && block.branches.length > 1) {
      const at = 1 + r.int(block.branches.length - 1);
      const [gone] = block.branches.splice(at, 1);
      block.branches[at - 1]!.steps.push(...gone!.steps);
    } else if (what === 2) r.pick(block.branches).text = r.text();
    else {
      block.block = r.pick(SEQUENCE_BLOCKS) as SequenceBlockKind;
      if (!BRANCH_WORD[block.block] && block.branches.length > 1) {
        block.branches = [
          { text: block.branches[0]!.text, steps: block.branches.flatMap((b) => b.steps) },
        ];
      }
    }
  },
  (m, r) => (m.title = r.chance(0.3) ? null : r.text() || null),
  (m) => (m.autonumber = !m.autonumber),
];

const topicsOf = (
  t: MindmapTopic,
  out: { topic: MindmapTopic; parent: MindmapTopic | null }[] = [],
  parent: MindmapTopic | null = null,
) => {
  out.push({ topic: t, parent });
  t.children.forEach((c) => topicsOf(c, out, t));
  return out;
};
const newTopic = (label: string): MindmapTopic => ({
  label,
  shape: 'default',
  id: null,
  decorations: [],
  children: [],
});

const MINDMAP_EDITS: Edit<Mindmap>[] = [
  (m, r) => (r.pick(topicsOf(m.root)).topic.label = r.text()),
  (m, r) => (r.pick(topicsOf(m.root)).topic.shape = r.pick(MINDMAP_SHAPES)),
  (m, r) => r.pick(topicsOf(m.root)).topic.children.push(newTopic(r.text())),
  (m, r) => {
    const place = r.pick(topicsOf(m.root));
    if (place.parent)
      place.parent.children.splice(
        place.parent.children.indexOf(place.topic) + 1,
        0,
        newTopic(r.text()),
      );
  },
  (m, r) => {
    const place = r.pick(topicsOf(m.root));
    if (place.parent) place.parent.children.splice(place.parent.children.indexOf(place.topic), 1);
  },
  // Tab: the last child of the topic before it.
  (m, r) => {
    const place = r.pick(topicsOf(m.root));
    if (!place.parent) return;
    const at = place.parent.children.indexOf(place.topic);
    if (at === 0) return;
    place.parent.children.splice(at, 1);
    place.parent.children[at - 1]!.children.push(place.topic);
  },
  // Shift+Tab: the next sibling of its parent.
  (m, r) => {
    const all = topicsOf(m.root);
    const place = r.pick(all);
    const up = all.find((t) => t.topic === place.parent);
    if (!place.parent || !up?.parent) return;
    place.parent.children.splice(place.parent.children.indexOf(place.topic), 1);
    up.parent.children.splice(up.parent.children.indexOf(up.topic) + 1, 0, place.topic);
  },
  (m, r) => {
    const place = r.pick(topicsOf(m.root));
    const list = place.parent?.children;
    if (!list || list.length < 2) return;
    const at = 1 + r.int(list.length - 1);
    [list[at - 1], list[at]] = [list[at]!, list[at - 1]!];
  },
];

const TIMELINE_EDITS: Edit<Timeline>[] = [
  (m, r) => (m.title = r.text()),
  (m, r) => {
    const named = m.sections.filter((s) => s.label !== null);
    if (named.length) r.pick(named).label = r.text();
  },
  (m, r) => {
    const periods = m.sections.flatMap((s) => s.periods);
    if (!periods.length) return;
    const p = r.pick(periods);
    const what = r.int(4);
    if (what === 0) p.label = r.text();
    else if (what === 1 && p.events.length) p.events[r.int(p.events.length)] = r.text();
    else if (what === 2) p.events.push(r.text());
    else if (p.events.length) p.events.splice(r.int(p.events.length), 1);
  },
  (m, r) =>
    m.sections.length && r.pick(m.sections).periods.push({ label: r.text(), events: [r.text()] }),
  (m, r) => {
    const s = m.sections.length ? r.pick(m.sections) : null;
    if (s?.periods.length) s.periods.splice(r.int(s.periods.length), 1);
  },
  (m, r) => {
    const s = m.sections.length ? r.pick(m.sections) : null;
    if (!s || s.periods.length < 2) return;
    const at = 1 + r.int(s.periods.length - 1);
    [s.periods[at - 1], s.periods[at]] = [s.periods[at]!, s.periods[at - 1]!];
  },
  (m, r) => {
    const from = m.sections.length ? r.pick(m.sections) : null;
    if (!from?.periods.length) return;
    const [p] = from.periods.splice(r.int(from.periods.length), 1);
    r.pick(m.sections).periods.splice(0, 0, p!);
  },
  (m, r) =>
    m.sections.push({ label: r.text(), periods: [{ label: r.text(), events: [r.text()] }] }),
  (m, r) => {
    const named = m.sections.filter((s) => s.label !== null);
    if (named.length) m.sections.splice(m.sections.indexOf(r.pick(named)), 1);
  },
];

const newTask = (r: Random, first: boolean): GanttTask => ({
  name: r.text(),
  tags: [],
  id: null,
  start: first ? { kind: 'date', value: '2026-01-05' } : { kind: 'previous' },
  end: { kind: 'duration', value: `${1 + r.int(9)}d` },
});

const GANTT_EDITS: Edit<Gantt>[] = [
  (m, r) => (m.title = r.text()),
  (m) => (m.excludesWeekends = !m.excludesWeekends),
  (m, r) => {
    const named = m.sections.filter((s) => s.label !== null);
    if (named.length) r.pick(named).label = r.text();
  },
  (m, r) => {
    const tasks = m.sections.flatMap((s) => s.tasks);
    if (!tasks.length) return;
    const t = r.pick(tasks);
    const what = r.int(4);
    if (what === 0) t.name = r.text();
    else if (what === 1) t.tags = r.chance(0.3) ? [] : [r.pick(GANTT_TAGS)];
    else if (what === 2)
      t.end = { kind: 'duration', value: `${1 + r.int(20)}${r.pick(['h', 'd', 'w'])}` };
    else {
      // Starts after another task, which gets an id for it when it has none (`idFor`).
      const other = r.pick(tasks);
      if (other === t) t.start = { kind: 'date', value: '2026-02-02' };
      else {
        other.id ??= fresh(
          tasks.map((x) => x.id ?? ''),
          't',
        );
        t.start = { kind: 'after', ids: [other.id] };
      }
    }
  },
  (m, r) => {
    if (!m.sections.length) return;
    const all = m.sections.flatMap((s) => s.tasks);
    r.pick(m.sections).tasks.push(newTask(r, !all.length));
  },
  (m, r) => {
    const s = m.sections.length ? r.pick(m.sections) : null;
    if (s?.tasks.length) s.tasks.splice(r.int(s.tasks.length), 1);
  },
  (m, r) => {
    const s = m.sections.length ? r.pick(m.sections) : null;
    if (!s || s.tasks.length < 2) return;
    const at = 1 + r.int(s.tasks.length - 1);
    [s.tasks[at - 1], s.tasks[at]] = [s.tasks[at]!, s.tasks[at - 1]!];
  },
  (m, r) => {
    const from = m.sections.length ? r.pick(m.sections) : null;
    if (!from?.tasks.length) return;
    const [t] = from.tasks.splice(r.int(from.tasks.length), 1);
    r.pick(m.sections).tasks.push(t!);
  },
  (m, r) => m.sections.push({ label: r.text(), tasks: [newTask(r, false)] }),
  (m, r) => {
    const named = m.sections.filter((s) => s.label !== null);
    if (named.length) m.sections.splice(m.sections.indexOf(r.pick(named)), 1);
  },
];

const PIE_EDITS: Edit<Pie>[] = [
  (m, r) => (m.title = r.text()),
  (m) => (m.showData = !m.showData),
  (m, r) => m.slices.length && (r.pick(m.slices).label = r.text()),
  (m, r) => m.slices.length && (r.pick(m.slices).value = r.int(100) + (r.chance(0.3) ? 0.5 : 0)),
  (m, r) => m.slices.push({ label: r.text(), value: r.int(50) }),
  (m, r) => m.slices.length && m.slices.splice(r.int(m.slices.length), 1),
  (m, r) => {
    if (m.slices.length < 2) return;
    const at = 1 + r.int(m.slices.length - 1);
    [m.slices[at - 1], m.slices[at]] = [m.slices[at]!, m.slices[at - 1]!];
  },
];

const EDITS: Record<DiagramModel['type'], Edit<never>[]> = {
  flowchart: FLOW_EDITS,
  sequence: SEQUENCE_EDITS,
  mindmap: MINDMAP_EDITS,
  timeline: TIMELINE_EDITS,
  gantt: GANTT_EDITS,
  pie: PIE_EDITS,
};

const read = (code: string): DiagramModel => {
  const result = parseDiagram(code);
  if (!result.ok) throw new Error(`${result.reason} (line ${result.line}) in\n${code}`);
  return result.model;
};

describe('random edits', () => {
  const kept = { before: 0, after: 0 };
  it.each(DIAGRAM_CORPUS.map((d, i) => [d.name, d.code, i] as const))(
    '%s: reads back as edited, every time',
    (name, code, index) => {
      for (let seed = 1; seed <= 3; seed += 1) {
        const r = random(seed * 7919 + index);
        let model = read(code);
        for (let round = 0; round < 12; round += 1) {
          // Sometimes several edits before writing, sometimes one (as each keystroke does).
          const next = clone(model);
          const edits = EDITS[next.type] as Edit<DiagramModel>[];
          for (let n = 1 + (r.chance(0.3) ? r.int(3) : 0); n > 0; n -= 1) r.pick(edits)(next, r);
          const before = printCounts.kept;
          const printed = printDiagram(next);
          kept.before += 1;
          kept.after += printCounts.kept - before;
          const again = read(printed);
          expect(
            diagramMeaning(again),
            `${name}, seed ${seed}, round ${round}\n${printed}`,
          ).toEqual(diagramMeaning(next));
          // Unchanged, it is written back as it is.
          expect(printDiagram(again)).toBe(printed);
          // Next time, the editor works on what it reads (or, now and then, on its own copy).
          model = r.chance(0.8) ? again : next;
        }
      }
    },
  );

  it('changes the code it has, rather than writing it afresh', () => {
    // Writing afresh is the safety net for what the code can't say with small changes (a box
    // moved between groups that already exist, say); edits should rarely need it.
    expect(kept.before).toBeGreaterThan(1000);
    expect(kept.after / kept.before).toBeGreaterThan(0.97);
  });
});
