import {
  diagramMeaning,
  mindmapTopics,
  parseDiagram,
  printDiagram,
  type DiagramModel,
  type MindmapTopic,
  type SequenceStep,
} from '@memora/shared';
import mermaid from 'mermaid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DIAGRAM_CORPUS,
  TEXT_SAMPLES,
  textFields,
} from '../../../../packages/shared/src/diagrams/testCorpus';
import { BLANK, TEMPLATES } from './editor/templates';

/*
 * What Memora writes, read by Mermaid itself (§3.4): Mermaid's parser must accept it, and
 * what Mermaid reads (labels, messages, topics, tasks, groups) must be what the model says.
 */

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
});

const model = (code: string): DiagramModel => {
  const read = parseDiagram(code);
  if (!read.ok) throw new Error(`${read.reason} (line ${read.line}) in\n${code}`);
  return read.model;
};

/** Text as Mermaid holds it, as it is drawn: entity codes read, line breaks, trimmed. */
function drawn(text: unknown): string {
  if (typeof text !== 'string') return '';
  const area = document.createElement('textarea');
  // Line breaks first (a `<br>` written as `#lt;br>` is text), then the entity codes.
  const entities = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/ﬂ°°(\d+)¶ß/g, '&#$1;')
    .replace(/ﬂ°(\w+)¶ß/g, '&$1;');
  area.innerHTML = entities.replace(/</g, '&lt;');
  const out = area.value.trim();
  return out === '​' ? '' : out;
}

const sameText = (model: string) => model.trim();

type Db = Record<string, (...args: unknown[]) => unknown>;

/**
 * What Mermaid read, in the terms of Memora's model. Reading the diagram runs Mermaid's own
 * parser, which throws on code it doesn't accept (as `mermaid.parse` does).
 */
async function mermaidMeaning(code: string): Promise<unknown> {
  mermaid.mermaidAPI.reset?.();
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
  const db = diagram.db as unknown as Db;
  switch (diagram.type) {
    case 'flowchart-v2':
    case 'flowchart': {
      const groups = db.getSubGraphs!() as { id: string; title: string; nodes: string[] }[];
      const groupIds = new Set(groups.map((g) => g.id));
      const vertices = [
        ...(db.getVertices!() as Map<string, { id: string; text: string }>).values(),
      ];
      const edges = db.getEdges!() as {
        start: string;
        end: string;
        text: string;
        stroke: string;
      }[];
      return {
        nodes: vertices
          .filter((v) => !groupIds.has(v.id))
          .map((v) => [v.id, drawn(v.text)])
          .sort(),
        edges: edges.map((e) => [e.start, e.end, drawn(e.text), e.stroke]),
        groups: groups
          .map((g) => [g.id, drawn(g.title), [...g.nodes].sort()])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      };
    }
    case 'sequence': {
      const actors = [
        ...(
          db.getActors!() as Map<string, { name: string; description: string; type: string }>
        ).values(),
      ];
      const signals = db.getMessages!() as {
        from?: string;
        to?: string;
        message: unknown;
        type: number;
      }[];
      const starts = new Set([10, 12, 15, 19, 22, 27, 30]);
      const branches = new Set([13, 20, 28]);
      const ends = new Set([11, 14, 16, 21, 23, 29, 31]);
      const skipped = new Set([17, 18, 26]);
      return {
        title: drawn(db.getDiagramTitle!()),
        actors: actors.map((a) => [a.name, drawn(a.description), a.type]),
        steps: signals
          .filter((s) => !skipped.has(s.type))
          .map((s) =>
            starts.has(s.type)
              ? ['block', drawn(s.message)]
              : branches.has(s.type)
                ? ['branch', drawn(s.message)]
                : ends.has(s.type)
                  ? ['end']
                  : s.type === 2
                    ? ['note', drawn(s.message)]
                    : ['message', s.from, s.to, drawn(s.message)],
          ),
      };
    }
    case 'mindmap': {
      const walk = (node: { descr: string; type: number; children?: unknown[] }): unknown => [
        drawn(node.descr),
        node.type,
        (node.children ?? []).map((c) => walk(c as typeof node)),
      ];
      return walk(db.getMindmap!() as { descr: string; type: number });
    }
    case 'timeline': {
      const tasks = db.getTasks!() as { section: string; task: string; events: string[] }[];
      return {
        sections: (db.getSections!() as string[]).map(drawn),
        periods: tasks.map((t) => [drawn(t.section), drawn(t.task), t.events.map(drawn)]),
      };
    }
    case 'gantt': {
      const tasks = db.getTasks!() as { section: string; task: string }[];
      return {
        title: drawn(db.getDiagramTitle!()),
        tasks: tasks.map((t) => [drawn(t.section), drawn(t.task)]),
      };
    }
    case 'pie':
      return {
        title: drawn(db.getDiagramTitle!()),
        slices: [...(db.getSections!() as Map<string, number>).entries()].map(([k, v]) => [
          drawn(k),
          v,
        ]),
      };
    default:
      return null;
  }
}

const MINDMAP_TYPES: Record<MindmapTopic['shape'], number> = {
  default: 0,
  rounded: 1,
  square: 2,
  circle: 3,
  cloud: 4,
  bang: 5,
  hexagon: 6,
};
const STROKES = { solid: 'normal', dotted: 'dotted', thick: 'thick', invisible: 'invisible' };

/** What the model says, in the terms Mermaid reads. */
function modelMeaning(m: DiagramModel): unknown {
  switch (m.type) {
    case 'flowchart':
      return {
        nodes: m.nodes.map((n) => [n.id, sameText(n.label)]).sort(),
        edges: m.edges.map((e) => [e.from, e.to, sameText(e.label), STROKES[e.line]]),
        groups: m.groups
          .map((g) => [
            g.id,
            sameText(g.label),
            [
              ...m.nodes.filter((n) => n.group === g.id).map((n) => n.id),
              ...m.groups.filter((c) => c.parent === g.id).map((c) => c.id),
            ].sort(),
          ])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      };
    case 'sequence': {
      const steps: unknown[] = [];
      const walk = (list: SequenceStep[]) => {
        for (const s of list) {
          if (s.kind === 'message') steps.push(['message', s.from, s.to, sameText(s.text)]);
          if (s.kind === 'note') steps.push(['note', sameText(s.text)]);
          if (s.kind === 'block') {
            s.branches.forEach((b, i) => {
              steps.push([i === 0 ? 'block' : 'branch', sameText(b.text)]);
              walk(b.steps);
            });
            steps.push(['end']);
          }
        }
      };
      walk(m.steps);
      return {
        title: sameText(m.title ?? ''),
        actors: m.participants.map((p) => [p.id, sameText(p.label), p.kind]),
        steps,
      };
    }
    case 'mindmap': {
      const walk = (t: MindmapTopic): unknown => [
        sameText(t.label),
        MINDMAP_TYPES[t.shape],
        t.children.map(walk),
      ];
      return walk(m.root);
    }
    case 'timeline':
      return {
        sections: m.sections.filter((s) => s.label !== null).map((s) => sameText(s.label!)),
        periods: m.sections.flatMap((s) =>
          s.periods.map((p) => [
            sameText(s.label ?? ''),
            sameText(p.label),
            p.events.map(sameText),
          ]),
        ),
      };
    case 'gantt':
      return {
        title: sameText(m.title),
        tasks: m.sections.flatMap((s) =>
          s.tasks.map((t) => [sameText(s.label ?? ''), sameText(t.name)]),
        ),
      };
    case 'pie': {
      // Mermaid keeps one slice per label (as written): the first.
      const slices = new Map<string, number>();
      for (const s of m.slices) if (!slices.has(s.label)) slices.set(s.label, s.value);
      return {
        title: sameText(m.title),
        slices: [...slices].map(([label, value]) => [sameText(label), value]),
      };
    }
  }
}

/** Mermaid accepts the code and reads what the model says; Memora reads the model back. */
async function valid(m: DiagramModel, what: string) {
  const code = printDiagram(m);
  let read: unknown;
  try {
    read = await mermaidMeaning(code);
  } catch (error) {
    throw new Error(`${what}: Mermaid refuses\n${code}\n${String(error).split('\n')[0]}`, {
      cause: error,
    });
  }
  expect(read, `${what}\n${code}`).toEqual(modelMeaning(m));
  expect(diagramMeaning(model(code)), `${what}\n${code}`).toEqual(diagramMeaning(m));
  return code;
}

/** The editor's templates and blank diagrams: every kind of field of every type. */
const STARTS = [
  ...TEMPLATES.filter((t) => t.type !== 'other'),
  ...Object.entries(BLANK).map(([name, code]) => ({ name: `blank ${name}`, code })),
];
const ALL = [...DIAGRAM_CORPUS, ...STARTS];
/** For the many samples, a smaller set (the shared tests run them on the whole corpus). */
const SOME = [...STARTS, ...DIAGRAM_CORPUS.filter((d) => !d.name.startsWith('docs:'))];

describe('Mermaid reads what Memora writes', () => {
  it.each(ALL.map((d) => [d.name, d.code]))('%s, as written and unchanged', async (name, code) => {
    // The corpus is valid Mermaid, means the same to both, and is written back byte for byte.
    const m = model(code);
    expect(printDiagram(m)).toBe(code);
    await expect(mermaid.parse(code)).resolves.toBeTruthy();
    expect(await mermaidMeaning(code), name).toEqual(modelMeaning(m));
  });

  it.each(ALL.map((d) => [d.name, d.code]))(
    '%s, with every text field empty',
    async (name, code) => {
      const m = structuredClone(model(code));
      for (const field of textFields(m)) field.set(m, '');
      await valid(m, `${name}, all empty`);
    },
  );

  it.each(SOME.map((d) => [d.name, d.code]))(
    '%s, with special characters in each field',
    async (name, code) => {
      const base = model(code);
      const fields = textFields(base);
      for (const [i, sample] of TEXT_SAMPLES.entries()) {
        // Each sample in every field…
        const every = structuredClone(base);
        for (const field of fields) field.set(every, sample);
        await valid(every, `${name}, ${JSON.stringify(sample)} everywhere`);
        // …and (every other one) next to others: each field gets a different one.
        if (i % 2) continue;
        const mixed = structuredClone(base);
        fields.forEach((field, f) =>
          field.set(mixed, TEXT_SAMPLES[(i + f) % TEXT_SAMPLES.length]!),
        );
        await valid(mixed, `${name}, samples from ${JSON.stringify(sample)} on`);
      }
    },
  );
});

describe('edits the editor makes stay valid Mermaid', () => {
  it('flowcharts: new, moved, regrouped and restyled boxes', async () => {
    for (const template of ALL.filter((t) => model(t.code).type === 'flowchart')) {
      const m = structuredClone(model(template.code)) as Extract<
        DiagramModel,
        { type: 'flowchart' }
      >;
      if (!m.nodes.length) continue;
      m.nodes[0]!.shape = 'hexagon';
      m.nodes[0]!.colour = 'teal';
      m.nodes.push({
        id: 'zz1',
        label: 'New (box)',
        shape: 'diamond',
        colour: 'red',
        classes: [],
        group: m.groups[0]?.id ?? null,
      });
      m.edges.push({
        from: m.nodes[0]!.id,
        to: 'zz1',
        label: 'go | stop',
        line: 'dotted',
        start: 'none',
        end: 'arrow',
        extra: 0,
      });
      if (m.edges.length > 1) m.edges.splice(0, 1);
      m.groups.push({ id: 'zzg', label: 'A group', parent: null, direction: 'LR' });
      m.nodes.at(-2)!.group = 'zzg';
      await valid(m, `${template.name}, edited`);
    }
  });

  it('sequence diagrams: steps moved into and out of blocks', async () => {
    for (const template of ALL.filter((t) => model(t.code).type === 'sequence')) {
      const m = structuredClone(model(template.code)) as Extract<
        DiagramModel,
        { type: 'sequence' }
      >;
      const first = m.participants[0]?.id ?? 'A';
      // (Without activations: Mermaid checks that each one ends after it starts.)
      const calm = (steps: SequenceStep[]) =>
        steps.forEach((s) => {
          if (s.kind === 'message') s.activation = null;
          if (s.kind === 'block') s.branches.forEach((b) => calm(b.steps));
        });
      calm(m.steps);
      const said = m.steps.findIndex((s) => s.kind === 'message' || s.kind === 'note');
      const moved = said < 0 ? [] : m.steps.splice(said, 1);
      m.steps.push({
        kind: 'block',
        block: 'alt',
        branches: [
          { text: 'yes; really', steps: moved },
          { text: '', steps: [{ kind: 'note', side: 'over', of: [first], text: 'a # b' }] },
        ],
      });
      m.participants.push({ id: 'P9', label: 'New one', kind: 'actor' });
      m.participants.reverse();
      await valid(m, `${template.name}, edited`);
    }
  });

  it('mind maps: topics moved between levels', async () => {
    for (const template of ALL.filter((t) => model(t.code).type === 'mindmap')) {
      const m = structuredClone(model(template.code)) as Extract<DiagramModel, { type: 'mindmap' }>;
      const all = mindmapTopics(m);
      const deepest = all.reduce((a, b) => (b.depth > a.depth ? b : a));
      m.root.children.push({
        label: 'New (topic)',
        shape: 'cloud',
        id: null,
        decorations: [],
        children: [],
      });
      if (deepest.depth > 0) {
        const parent = all.find((t) => t.topic.children.includes(deepest.topic))!.topic;
        parent.children.splice(parent.children.indexOf(deepest.topic), 1);
        m.root.children.unshift(deepest.topic);
      }
      await valid(m, `${template.name}, edited`);
    }
  });

  it('timelines, Gantt charts and pie charts: rows moved and added', async () => {
    for (const template of ALL.filter((t) =>
      ['timeline', 'gantt', 'pie'].includes(model(t.code).type),
    )) {
      const m = structuredClone(model(template.code));
      if (m.type === 'timeline') {
        m.sections.push({
          label: 'Later: maybe',
          periods: [{ label: '10:30', events: ['a: b', 'c'] }],
        });
        const moved = m.sections[0]!.periods.shift();
        if (moved) m.sections.at(-1)!.periods.push(moved);
      }
      if (m.type === 'gantt') {
        m.sections.push({ label: 'More', tasks: [] });
        const moved = m.sections[0]!.tasks.pop();
        if (moved)
          m.sections.at(-1)!.tasks.push({ ...moved, start: { kind: 'date', value: '2026-02-01' } });
        m.sections.at(-1)!.tasks.push({
          name: 'Then: this',
          tags: ['crit'],
          id: null,
          start: { kind: 'previous' },
          end: { kind: 'duration', value: '2d' },
        });
      }
      if (m.type === 'pie') {
        m.slices.reverse();
        m.slices.push({ label: 'More "stuff"', value: 3.5 });
      }
      await valid(m, `${template.name}, edited`);
    }
  });
});
