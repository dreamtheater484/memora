import { parseGantt, parsePie, parseTimeline, printGantt, printPie, printTimeline } from './charts';
import type { Gantt, Pie, Timeline } from './charts';
import {
  detectDiagram,
  readLabel,
  splitSource,
  type DiagramType,
  type ParseResult,
} from './common';
import { parseFlowchart, printFlowchart, type Flowchart } from './flowchart';
import { mindmapTopics, parseMindmap, printMindmap, type Mindmap } from './mindmap';
import { parseSequence, printSequence, type SequenceDiagram, type SequenceStep } from './sequence';

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

export function printDiagram(model: DiagramModel): string {
  switch (model.type) {
    case 'flowchart':
      return printFlowchart(model);
    case 'sequence':
      return printSequence(model);
    case 'mindmap':
      return printMindmap(model);
    case 'timeline':
      return printTimeline(model);
    case 'gantt':
      return printGantt(model);
    case 'pie':
      return printPie(model);
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

/** For diagrams the editor doesn't model: quoted text, bracketed labels and text after `:`. */
function looseWords(code: string): string[] {
  const source = splitSource(code);
  if (!source) return [];
  const out: string[] = [];
  for (const { text } of source.body) {
    const line = text.trim();
    if (!line || line.startsWith('%%')) continue;
    const found = [...line.matchAll(/"([^"]+)"|\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}/g)].map(
      (m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? '',
    );
    const after = /:\s*([^:]+)$/.exec(line)?.[1];
    if (found.length) out.push(...found.map(readLabel));
    else if (after) out.push(after);
  }
  return out;
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
  const type = detectDiagram(code) ?? 'other';
  const text = diagramText(code);
  const name = DIAGRAM_NAMES[type];
  if (!text) return name;
  const words = text.split(' · ').slice(0, 12).join(', ');
  return `${name}: ${words}`;
}
