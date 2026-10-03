import {
  EMPTY_TEXT,
  entity,
  escapeEntities,
  keepEnds,
  readLabel,
  readText,
  refuse,
  splitSource,
  writeBreaks,
  writeText,
  type FromOrigin,
  type FromSource,
  type ParseResult,
} from './common';
import { modelOf, remembered, type Reading } from './source';

/*
 * The diagrams edited as small tables (§9.4): timelines, Gantt charts and pie charts.
 * Settings the tables don't show (axis formats, today's marker, comments) are kept as
 * written, where they were.
 */

/** A `#` and a `:` as entities, for text where either would end it. */
const hashAndColon = (text: string) => text.replace(/#/g, '#35;').replace(/:/g, '#58;');

/** The first character as an entity when the text would start like a keyword's line. */
const notKeyword = (text: string, keywords: RegExp) =>
  keywords.test(text) ? entity(text[0]!) + text.slice(1) : text;

/*
 * Sections, as timelines and Gantt charts write them: the lines before the first `section`
 * (settings, and items before any section), then each section's line and the lines after it.
 */
export interface SectionBlock {
  /** The `section` line; null for the items before any section. */
  line: number | null;
  /** The lines after it, up to the next section. */
  body: number[];
}

// Timelines

export interface TimelinePeriod extends FromOrigin {
  label: string;
  events: string[];
}

export interface TimelineSection extends FromOrigin {
  /** Null for periods before the first section. */
  label: string | null;
  periods: TimelinePeriod[];
}

export interface Timeline extends FromSource {
  type: 'timeline';
  head: string[];
  title: string;
  sections: TimelineSection[];
  extras: string[];
}

/** One event as written: `: text`, with the spaces around it. */
export interface Chunk {
  /** `:` and the spaces after it. */
  prefix: string;
  raw: string;
  suffix: string;
}

/** A line of a period: its label (on the first line) and events. */
export interface EventsLine {
  indent: string;
  label: { raw: string; suffix: string } | null;
  /** What comes before the first event on a line of more events. */
  lead: string;
  chunks: Chunk[];
}

export type TimelineLine =
  | { kind: 'other' | 'title'; text: string }
  | { kind: 'extra'; text: string; extra: number }
  | { kind: 'section'; text: string; section: number }
  | { kind: 'period' | 'events'; text: string; period: number; events: EventsLine };

export interface TimelineLayout {
  was: Timeline;
  eol: string;
  firstLine: string;
  tail: string[];
  lines: TimelineLine[];
  preamble: number[];
  blocks: SectionBlock[];
  /** By period origin: its lines. */
  periods: number[][];
  titleAt: number | null;
}

/*
 * Timeline text. A period ends at the first `:`, and neither it nor a section can hold a `#`;
 * an event ends at a `:` followed by a space; `%%` in a line starts a comment. Those are
 * written as entities. Mermaid has no empty period, event or section, so those are written as
 * EMPTY_TEXT.
 */
const TIMELINE_KEYWORDS = /^(title|section|acctitle|accdescr)\b|^%%/i;
/** `%%` (which starts a comment in these charts' lines) with its first `%` as an entity. */
const noComment = (text: string) => text.replace(/%(?=%)/g, '#37;');
const periodText = (text: string) =>
  text === ''
    ? EMPTY_TEXT
    : notKeyword(
        keepEnds(writeBreaks(noComment(hashAndColon(text)).replace(/<(?=br\s*\/?>)/gi, '#lt;'))),
        TIMELINE_KEYWORDS,
      );
const sectionText = (text: string) =>
  text === ''
    ? EMPTY_TEXT
    : keepEnds(writeBreaks(noComment(hashAndColon(text)).replace(/<(?=br\s*\/?>)/gi, '#lt;')));
const eventText = (text: string) =>
  text === ''
    ? EMPTY_TEXT
    : keepEnds(writeBreaks(noComment(escapeEntities(text)).replace(/:(?=\s|$)/g, '#58;')));
const chartTitle = (text: string) => noComment(writeText(text));

/** Reads a period's line (or a line of more events, without a label). */
function readEvents(content: string, labelled: boolean, indent: string): EventsLine {
  const line: EventsLine = { indent, label: null, lead: '', chunks: [] };
  let rest = content;
  if (labelled) {
    const colon = content.indexOf(':');
    const text = colon < 0 ? content : content.slice(0, colon);
    const raw = text.trimEnd();
    line.label = { raw, suffix: text.slice(raw.length) };
    rest = colon < 0 ? '' : content.slice(colon);
  }
  // Events start at the first `:` and at each `:` followed by a space.
  const starts: number[] = [];
  for (let k = 0; k < rest.length; k += 1) {
    if (rest[k] === ':' && (k === 0 || /\s/.test(rest[k + 1] ?? ' '))) starts.push(k);
  }
  starts.forEach((start, n) => {
    const piece = rest.slice(start, starts[n + 1] ?? rest.length);
    const body = piece.slice(1);
    const lead = /^\s*/.exec(body)![0];
    const raw = body.trim();
    if (!raw) {
      // An empty event: Mermaid has none, so it is kept with the text before it.
      const last = line.chunks.at(-1);
      if (last) last.suffix += piece;
      else if (line.label) line.label.suffix += piece;
      else line.lead += piece;
      return;
    }
    line.chunks.push({ prefix: `:${lead}`, raw, suffix: body.slice(lead.length + raw.length) });
  });
  return line;
}

const readTimelineCode = remembered((code: string): Reading<Timeline, TimelineLayout> => {
  const source = splitSource(code);
  if (!source) return refuse('The diagram is empty');
  if (!/^timeline\b/.test(source.first)) return refuse('This isn’t a timeline', source.firstNumber);
  const timeline: Timeline = {
    type: 'timeline',
    head: source.head,
    title: '',
    sections: [],
    extras: [],
    source: code,
  };
  const layout: TimelineLayout = {
    was: timeline,
    eol: source.eol,
    firstLine: source.firstLine,
    tail: source.tail,
    lines: [],
    preamble: [],
    blocks: [],
    periods: [],
    titleAt: null,
  };
  let section: TimelineSection | null = null;
  let period: TimelinePeriod | null = null;
  let body = layout.preamble;
  let periods = 0;
  for (let i = 0; i < source.body.length; i += 1) {
    const { text: raw, number } = source.body[i]!;
    const line = raw.trim();
    const content = raw.trimStart();
    const indent = raw.slice(0, raw.length - content.length);
    if (!line) {
      layout.lines.push({ kind: 'other', text: raw });
      body.push(i);
      continue;
    }
    if (line.startsWith('%%') || /^(accTitle|accDescr)\b/.test(line)) {
      timeline.extras.push(line);
      layout.lines.push({ kind: 'extra', text: raw, extra: timeline.extras.length - 1 });
      body.push(i);
      continue;
    }
    const title = /^title\s+(.*)$/.exec(line);
    if (title) {
      timeline.title = readText(title[1]!);
      layout.lines.push({ kind: 'title', text: raw });
      layout.titleAt = i;
      body.push(i);
      continue;
    }
    const named = /^section\s+(.*)$/.exec(line);
    if (named) {
      section = { label: readText(named[1]!, true), periods: [], origin: timeline.sections.length };
      timeline.sections.push(section);
      const block: SectionBlock = { line: i, body: [] };
      layout.blocks.push(block);
      layout.lines.push({ kind: 'section', text: raw, section: section.origin! });
      body = block.body;
      period = null;
      continue;
    }
    if (line.startsWith(':')) {
      // More events for the period above.
      if (!period) return refuse('Events have no period', number);
      const events = readEvents(content, false, indent);
      period.events.push(...events.chunks.map((c) => readText(c.raw, true)));
      layout.lines.push({ kind: 'events', text: raw, period: period.origin!, events });
      layout.periods[period.origin!]!.push(i);
      continue;
    }
    if (!section) {
      section = { label: null, periods: [], origin: timeline.sections.length };
      timeline.sections.push(section);
      layout.blocks.push({ line: null, body: layout.preamble });
    }
    const events = readEvents(content, true, indent);
    period = {
      label: readText(events.label!.raw, true),
      events: events.chunks.map((c) => readText(c.raw, true)),
      origin: periods,
    };
    periods += 1;
    section.periods.push(period);
    layout.lines.push({ kind: 'period', text: raw, period: period.origin!, events });
    layout.periods[period.origin!] = [i];
    body.push(i);
  }
  return { ok: true, model: timeline, layout };
});

export function parseTimeline(code: string): ParseResult<Timeline> {
  return modelOf(readTimelineCode(code));
}

/** A new period's line: `When : what : what`. */
// Gantt charts

export const GANTT_TAGS = ['done', 'active', 'crit', 'milestone'] as const;
export type GanttTag = (typeof GANTT_TAGS)[number];

export type GanttStart =
  | { kind: 'date'; value: string }
  | { kind: 'after'; ids: string[] }
  /** Right after the task above. */
  | { kind: 'previous' };

export type GanttEnd =
  | { kind: 'duration'; value: string }
  | { kind: 'date'; value: string }
  | { kind: 'until'; ids: string[] };

export interface GanttTask extends FromOrigin {
  name: string;
  tags: GanttTag[];
  id: string | null;
  start: GanttStart;
  end: GanttEnd;
}

export interface GanttSection extends FromOrigin {
  label: string | null;
  tasks: GanttTask[];
}

export interface Gantt extends FromSource {
  type: 'gantt';
  head: string[];
  title: string;
  dateFormat: string;
  excludesWeekends: boolean;
  sections: GanttSection[];
  /** Settings kept as written (`axisFormat`, `todayMarker`, other `excludes`…). */
  extras: string[];
}

const DURATION = /^\d+(?:\.\d+)?(?:ms|s|m|h|d|w|M|y)$/;

/** Reads a task's `: tags, id, start, end` part. */
function readTask(name: string, meta: string): GanttTask | null {
  const parts = meta
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const tags: GanttTag[] = [];
  while (parts.length && (GANTT_TAGS as readonly string[]).includes(parts[0]!)) {
    tags.push(parts.shift() as GanttTag);
  }
  let id: string | null = null;
  let start: GanttStart = { kind: 'previous' };
  let endText: string;
  if (parts.length === 3) {
    id = parts[0]!;
    start = startOf(parts[1]!);
    endText = parts[2]!;
  } else if (parts.length === 2) {
    start = startOf(parts[0]!);
    endText = parts[1]!;
  } else if (parts.length === 1) {
    endText = parts[0]!;
  } else return null;
  const until = /^until\s+(.+)$/.exec(endText);
  const end: GanttEnd = until
    ? { kind: 'until', ids: until[1]!.split(/\s+/) }
    : DURATION.test(endText)
      ? { kind: 'duration', value: endText }
      : { kind: 'date', value: endText };
  return { name, tags, id, start, end };
}

function startOf(text: string): GanttStart {
  const after = /^after\s+(.+)$/.exec(text);
  return after ? { kind: 'after', ids: after[1]!.split(/\s+/) } : { kind: 'date', value: text };
}

export type GanttLine =
  | { kind: 'other' | 'title' | 'dateFormat' | 'excludes'; text: string }
  | { kind: 'extra'; text: string; extra: number }
  | { kind: 'section'; text: string; section: number }
  /** `colon` is where the name ends. */
  | { kind: 'task'; text: string; task: number; colon: number };

export interface GanttLayout {
  was: Gantt;
  eol: string;
  firstLine: string;
  tail: string[];
  lines: GanttLine[];
  preamble: number[];
  blocks: SectionBlock[];
  /** By task origin: its line. */
  tasks: number[];
  at: { title: number | null; dateFormat: number | null; excludes: number | null };
}

const SETTINGS = [
  'axisFormat',
  'tickInterval',
  'todayMarker',
  'excludes',
  'includes',
  'weekday',
  'inclusiveEndDates',
  'topAxis',
  'displayMode',
  'accTitle',
  'accDescr',
  'weekend',
];

const readGanttCode = remembered((code: string): Reading<Gantt, GanttLayout> => {
  const source = splitSource(code);
  if (!source) return refuse('The diagram is empty');
  if (!/^gantt\b/.test(source.first)) return refuse('This isn’t a Gantt chart', source.firstNumber);
  const gantt: Gantt = {
    type: 'gantt',
    head: source.head,
    title: '',
    dateFormat: 'YYYY-MM-DD',
    excludesWeekends: false,
    sections: [],
    extras: [],
    source: code,
  };
  const layout: GanttLayout = {
    was: gantt,
    eol: source.eol,
    firstLine: source.firstLine,
    tail: source.tail,
    lines: [],
    preamble: [],
    blocks: [],
    tasks: [],
    at: { title: null, dateFormat: null, excludes: null },
  };
  let section: GanttSection | null = null;
  let body = layout.preamble;
  let tasks = 0;
  for (let i = 0; i < source.body.length; i += 1) {
    const { text: raw, number } = source.body[i]!;
    const line = raw.trim();
    const add = (entry: GanttLine) => {
      layout.lines.push(entry);
      body.push(i);
    };
    const extra = () => {
      gantt.extras.push(line);
      add({ kind: 'extra', text: raw, extra: gantt.extras.length - 1 });
    };
    if (!line) {
      add({ kind: 'other', text: raw });
      continue;
    }
    const setting = /^(\w+)\b\s*(.*)$/.exec(line);
    const word = setting?.[1];
    if (line.startsWith('%%')) {
      extra();
      continue;
    }
    if (word === 'title') {
      gantt.title = readText(setting![2]!);
      layout.at.title = i;
      add({ kind: 'title', text: raw });
      continue;
    }
    if (word === 'dateFormat') {
      gantt.dateFormat = setting![2]!.trim();
      layout.at.dateFormat = i;
      add({ kind: 'dateFormat', text: raw });
      continue;
    }
    if (word === 'excludes' && setting![2]!.trim() === 'weekends') {
      gantt.excludesWeekends = true;
      layout.at.excludes = i;
      add({ kind: 'excludes', text: raw });
      continue;
    }
    if (word === 'section') {
      section = { label: readText(setting![2]!, true), tasks: [], origin: gantt.sections.length };
      gantt.sections.push(section);
      const block: SectionBlock = { line: i, body: [] };
      layout.blocks.push(block);
      layout.lines.push({ kind: 'section', text: raw, section: section.origin! });
      body = block.body;
      continue;
    }
    const colon = line.indexOf(':');
    // A line that starts with a setting's keyword is that setting, as Mermaid reads it,
    // whatever it holds (`axisFormat %H:%M`).
    if (word && (SETTINGS.includes(word) || ['click'].includes(word))) {
      extra();
      continue;
    }
    if (colon <= 0) return refuse(`Couldn’t read “${line.slice(0, 40)}”`, number);
    const task = readTask(readText(line.slice(0, colon), true), line.slice(colon + 1));
    if (!task) return refuse('A task has no dates or length', number);
    if (!section) {
      section = { label: null, tasks: [], origin: gantt.sections.length };
      gantt.sections.push(section);
      layout.blocks.push({ line: null, body: layout.preamble });
    }
    task.origin = tasks;
    tasks += 1;
    section.tasks.push(task);
    layout.tasks[task.origin] = i;
    add({ kind: 'task', text: raw, task: task.origin, colon: raw.indexOf(':') });
  }
  return { ok: true, model: gantt, layout };
});

export function parseGantt(code: string): ParseResult<Gantt> {
  return modelOf(readGanttCode(code));
}

/*
 * Gantt text. A task's name ends at its `:`, `%%` starts a comment, and a line that starts
 * with a keyword (or a date) is that setting, so those are written as entities. Mermaid has
 * no empty task name or section, so those are written as EMPTY_TEXT.
 */
// Pie charts

export interface PieSlice extends FromOrigin {
  label: string;
  value: number;
}

export interface Pie extends FromSource {
  type: 'pie';
  head: string[];
  title: string;
  showData: boolean;
  slices: PieSlice[];
  extras: string[];
}

export type PieLine =
  | { kind: 'other' | 'title' | 'showData'; text: string }
  | { kind: 'extra'; text: string; extra: number }
  /** A slice's line in pieces: `indent "label" between value after`. */
  | {
      kind: 'slice';
      text: string;
      slice: number;
      indent: string;
      label: string;
      between: string;
      value: string;
      after: string;
    };

export interface PieLayout {
  was: Pie;
  eol: string;
  firstLine: string;
  tail: string[];
  lines: PieLine[];
  /** Where the title and `showData` are: on the first line, on a line of the body, or nowhere. */
  titleAt: 'first' | number | null;
  showDataAt: 'first' | number | null;
}

const readPieCode = remembered((code: string): Reading<Pie, PieLayout> => {
  const source = splitSource(code);
  if (!source) return refuse('The diagram is empty');
  const first = /^pie\b(\s+showData)?(?:\s+title(?:\s+(.*))?)?$/.exec(source.first);
  if (!first) return refuse('This isn’t a pie chart', source.firstNumber);
  const pie: Pie = {
    type: 'pie',
    head: source.head,
    title: first[2] ? readText(first[2]) : '',
    showData: !!first[1],
    slices: [],
    extras: [],
    source: code,
  };
  const layout: PieLayout = {
    was: pie,
    eol: source.eol,
    firstLine: source.firstLine,
    tail: source.tail,
    lines: [],
    titleAt: first[2] ? 'first' : null,
    showDataAt: first[1] ? 'first' : null,
  };
  for (let i = 0; i < source.body.length; i += 1) {
    const { text: raw, number } = source.body[i]!;
    const line = raw.trim();
    if (!line) {
      layout.lines.push({ kind: 'other', text: raw });
      continue;
    }
    if (line.startsWith('%%') || /^(accTitle|accDescr)\b/.test(line)) {
      pie.extras.push(line);
      layout.lines.push({ kind: 'extra', text: raw, extra: pie.extras.length - 1 });
      continue;
    }
    if (line === 'showData') {
      pie.showData = true;
      layout.showDataAt = i;
      layout.lines.push({ kind: 'showData', text: raw });
      continue;
    }
    const title = /^title\s+(.*)$/.exec(line);
    if (title) {
      pie.title = readText(title[1]!);
      layout.titleAt = i;
      layout.lines.push({ kind: 'title', text: raw });
      continue;
    }
    const slice = /^(\s*)("[^"]*")(\s*:\s*)(-?\d+(?:\.\d+)?)(\s*)$/.exec(raw);
    if (!slice) return refuse(`Couldn’t read “${line.slice(0, 40)}”`, number);
    pie.slices.push({
      label: readLabel(slice[2]!),
      value: Number(slice[4]),
      origin: pie.slices.length,
    });
    layout.lines.push({
      kind: 'slice',
      text: raw,
      slice: pie.slices.length - 1,
      indent: slice[1]!,
      label: slice[2]!,
      between: slice[3]!,
      value: slice[4]!,
      after: slice[5]!,
    });
  }
  return { ok: true, model: pie, layout };
});

export function parsePie(code: string): ParseResult<Pie> {
  return modelOf(readPieCode(code));
}

/**
 * A slice's label: always in quotes, which keep every character but `"` and `\` (Mermaid's
 * pie charts read `\"` as a quote in the text), written as entities.
 */

/** What the printer (`chartsPrint.ts`) writes with; not for use elsewhere. */
export const chartSyntax = {
  chartTitle,
  eventText,
  noComment,
  notKeyword,
  periodText,
  readGanttCode,
  readPieCode,
  readTimelineCode,
  sectionText,
};
