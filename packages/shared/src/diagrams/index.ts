import { parseGantt, parsePie, parseTimeline } from './charts';
import type { Gantt, Pie, Timeline } from './charts';
import {
  detectDiagram,
  readLabel,
  splitSource,
  type DiagramType,
  type ParseResult,
} from './common';
import { parseFlowchart, type Flowchart } from './flowchart';
import { mindmapTopics, parseMindmap, type Mindmap } from './mindmap';
import { parseSequence, type SequenceDiagram, type SequenceStep } from './sequence';

/*
 * Diagrams (§9.3, §9.4): Mermaid code read into a model the visual editor changes, and
 * written back. A diagram is stored as Mermaid text in both kinds of page: a ```mermaid
 * block in Markdown, a code block in Mermaid in rich text.
 */

export * from './charts';
export * from './common';
export * from './flowchart';
export * from './mindmap';
export * from './palette';
export * from './print';
export * from './sequence';

export type DiagramModel = Flowchart | SequenceDiagram | Mindmap | Timeline | Gantt | Pie;

/** The language of a code block or fence that is a diagram. */
export const DIAGRAM_LANGUAGE = 'mermaid';

/** Reads a diagram the visual editor can take; `other` types and unreadable code are refused. */
export function parseDiagram(code: string): ParseResult<DiagramModel> {
  const type = detectDiagram(code);
  switch (type) {
    case 'flowchart':
      return parseFlowchart(code);
    case 'sequence':
      return parseSequence(code);
    case 'mindmap':
      return parseMindmap(code);
    case 'timeline':
      return parseTimeline(code);
    case 'gantt':
      return parseGantt(code);
    case 'pie':
      return parsePie(code);
    case null:
      return { ok: false, reason: 'The diagram is empty' };
    default:
      return { ok: false, reason: 'This kind of diagram is edited as code' };
  }
}

/** What each diagram type is called. */
export const DIAGRAM_NAMES: Record<DiagramType | 'other', string> = {
  flowchart: 'Flowchart',
  sequence: 'Sequence diagram',
  mindmap: 'Mind map',
  timeline: 'Timeline',
  gantt: 'Gantt chart',
  pie: 'Pie chart',
  other: 'Diagram',
};

/** The words of a diagram type without a model, from its statements. */
type Words = (lines: string[]) => string[];

const after =
  (pattern: RegExp, group = 1): Words =>
  (lines) =>
    lines.flatMap((line) => {
      const found = pattern.exec(line)?.[group];
      return found ? [found] : [];
    });

const both =
  (...takers: Words[]): Words =>
  (lines) =>
    takers.flatMap((take) => take(lines));

const classWords: Words = both(
  (lines) =>
    lines.flatMap((line) => {
      const named = /^class\s+([\w-]+)(?:\s*\["([^"]+)"\])?/.exec(line);
      return named ? [named[2] ?? named[1]!] : [];
    }),
  (lines) =>
    lines.flatMap((line) => {
      const relation =
        /^([\w-]+)\s*(?:"[^"]*"\s*)?(?:<\|--|--\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|\.\.\|>|<\|\.\.|--|\.\.)\s*(?:"[^"]*"\s*)?([\w-]+)(?:\s*:\s*(.+))?$/.exec(
          line,
        );
      return relation ? [relation[1]!, relation[2]!, ...(relation[3] ? [relation[3]] : [])] : [];
    }),
);

const stateWords: Words = (lines) =>
  lines.flatMap((line) => {
    const named = /^state\s+"([^"]+)"/.exec(line);
    if (named) return [named[1]!];
    const move = /^([\w-]+|\[\*\])\s*-->\s*([\w-]+|\[\*\])(?:\s*:\s*(.+))?$/.exec(line);
    if (!move) return [];
    return [move[1]!, move[2]!, move[3] ?? ''].filter((w) => w && w !== '[*]');
  });

const erWords: Words = (lines) =>
  lines.flatMap((line) => {
    const relation = /^([\w-]+)\s+\S*--\S*\s+([\w-]+)\s*:\s*(.+)$/.exec(line);
    if (relation) return [relation[1]!, relation[2]!, readLabel(relation[3]!)];
    const entity = /^([\w-]+)\s*\{/.exec(line);
    return entity ? [entity[1]!] : [];
  });

const journeyWords: Words = both(
  after(/^title\s+(.+)$/),
  after(/^section\s+(.+)$/),
  after(/^([^:]+?)\s*:\s*\d+\s*(?::|$)/),
);

const quadrantWords: Words = both(
  after(/^title\s+(.+)$/),
  (lines) =>
    lines.flatMap((line) => {
      const axis = /^[xy]-axis\s+(.+?)(?:\s+-->\s+(.+))?$/.exec(line);
      return axis ? [axis[1]!, ...(axis[2] ? [axis[2]] : [])] : [];
    }),
  after(/^quadrant-\d\s+(.+)$/),
  after(/^(.+?)\s*:\s*\[/),
);

const gitWords: Words = after(/^branch\s+(\S+)/);

const architectureWords: Words = after(/^(?:service|group)\s+\S+?(?:\([^)]*\))?\[([^\]]+)\]/);

const c4Words: Words = (lines) =>
  lines.flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]!));

/**
 * Diagram types without a visual editor: their names, how to find their words, and whether
 * the words found in any diagram (quoted text, labels) add to them.
 */
const OTHER_TYPES: [RegExp, string, Words?, boolean?][] = [
  [/^classDiagram(-v2)?\b/, 'Class diagram', classWords, true],
  [/^stateDiagram(-v2)?\b/, 'State diagram', stateWords],
  [/^erDiagram\b/, 'Entity relationship diagram', erWords, true],
  [/^journey\b/, 'User journey', journeyWords, true],
  [/^quadrantChart\b/, 'Quadrant chart', quadrantWords, true],
  [/^xychart(-beta)?\b/, 'XY chart', after(/^title\s+"?([^"]+)"?$/)],
  [/^sankey(-beta)?\b/, 'Sankey diagram'],
  [/^block(-beta)?\b/, 'Block diagram'],
  [/^architecture(-beta)?\b/, 'Architecture diagram', architectureWords],
  [/^gitGraph\b/, 'Git graph', gitWords],
  [/^packet(-beta)?\b/, 'Packet diagram'],
  [/^requirementDiagram\b/, 'Requirement diagram', after(/^\w+\s+([\w-]+)\s*\{/)],
  [/^C4Context\b/, 'C4 context diagram', c4Words],
  [/^C4Container\b/, 'C4 container diagram', c4Words],
  [/^C4Component\b/, 'C4 component diagram', c4Words],
  [/^C4Dynamic\b/, 'C4 dynamic diagram', c4Words],
  [/^C4Deployment\b/, 'C4 deployment diagram', c4Words],
  [/^kanban\b/, 'Kanban board'],
  [/^radar(-beta)?\b/, 'Radar chart'],
  [/^treemap(-beta)?\b/, 'Treemap'],
  [/^zenuml\b/, 'Sequence diagram'],
];

const otherType = (code: string) => {
  const first = splitSource(code)?.first ?? '';
  return OTHER_TYPES.find(([pattern]) => pattern.test(first));
};

/** What a diagram is called, from its first keyword: "Flowchart", "Class diagram"… */
export function diagramName(code: string): string {
  const type = detectDiagram(code) ?? 'other';
  if (type !== 'other') return DIAGRAM_NAMES[type];
  return otherType(code)?.[1] ?? DIAGRAM_NAMES.other;
}

function stepWords(steps: SequenceStep[], out: string[]) {
  for (const step of steps) {
    if (step.kind === 'message' || step.kind === 'note') out.push(step.text);
    if (step.kind === 'block') {
      for (const branch of step.branches) {
        out.push(branch.text);
        stepWords(branch.steps, out);
      }
    }
  }
}

/** The words of a model: labels, messages, topics, tasks. */
function modelWords(model: DiagramModel): string[] {
  const out: string[] = [];
  switch (model.type) {
    case 'flowchart':
      out.push(...model.groups.map((g) => g.label), ...model.nodes.map((n) => n.label));
      out.push(...model.edges.map((e) => e.label));
      break;
    case 'sequence':
      if (model.title) out.push(model.title);
      out.push(...model.participants.map((p) => p.label));
      stepWords(model.steps, out);
      break;
    case 'mindmap':
      out.push(...mindmapTopics(model).map((t) => t.topic.label));
      break;
    case 'timeline':
      out.push(model.title);
      for (const s of model.sections) {
        if (s.label) out.push(s.label);
        for (const p of s.periods) out.push(p.label, ...p.events);
      }
      break;
    case 'gantt':
      out.push(model.title);
      for (const s of model.sections) {
        if (s.label) out.push(s.label);
        out.push(...s.tasks.map((t) => t.name));
      }
      break;
    case 'pie':
      out.push(model.title, ...model.slices.map((s) => s.label));
      break;
  }
  return out;
}

/**
 * For diagrams the editor doesn't model: the words its type is known to have (class names,
 * states, entities…) first, then quoted text, bracketed labels and text after `:`.
 */
function looseWords(code: string): string[] {
  const source = splitSource(code);
  if (!source) return [];
  const lines = source.body.map((l) => l.text.trim()).filter((l) => l && !l.startsWith('%%'));
  const type = otherType(code);
  const own = type?.[2]?.(lines) ?? [];
  if (own.length && !type?.[3]) return [...new Set(own.map((w) => w.trim()).filter(Boolean))];
  const out: string[] = [];
  for (const line of lines) {
    const found = [...line.matchAll(/"([^"]+)"|\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}/g)].map(
      (m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? '',
    );
    const after = /:\s*([^:]+)$/.exec(line)?.[1];
    if (found.length) out.push(...found.map(readLabel));
    else if (after) out.push(after);
  }
  // With words of its own, a diagram's numbers (coordinates, scores) aren't words.
  const loose = own.length ? out.filter((w) => /\p{L}/u.test(w)) : out;
  return [...new Set([...own, ...loose].map((w) => w.trim()).filter(Boolean))];
}

/** The human words of a diagram, for snippets, search and descriptions; one line. */
export function diagramText(code: string): string {
  const parsed = parseDiagram(code);
  const words = parsed.ok ? modelWords(parsed.model) : looseWords(code);
  return words
    .map((w) => w.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ');
}

/** A short description for screen readers: "Flowchart: Order received, Paid?, Ship". */
export function diagramSummary(code: string): string {
  const text = diagramText(code);
  const name = diagramName(code);
  if (!text) return name;
  const words = text.split(' · ').slice(0, 12).join(', ');
  return `${name}: ${words}`;
}
