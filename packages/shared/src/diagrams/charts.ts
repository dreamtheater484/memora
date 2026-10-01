import {
  INDENT,
  decodeEntities,
  readLabel,
  refuse,
  splitSource,
  withHead,
  type ParseResult,
} from './common';

/*
 * The diagrams edited as small tables (§9.4): timelines, Gantt charts and pie charts.
 * Settings the tables don't show (axis formats, today's marker, comments) are kept as
 * written.
 */

// Timelines

export interface TimelinePeriod {
  label: string;
  events: string[];
}

export interface TimelineSection {
  /** Null for periods before the first section. */
  label: string | null;
  periods: TimelinePeriod[];
}

export interface Timeline {
  type: 'timeline';
  head: string[];
  title: string;
  sections: TimelineSection[];
  extras: string[];
}

/** Text in a timeline: `:` separates events, so it is written as an entity. */
const timelineText = (text: string) =>
  text.replace(/#/g, '#35;').replace(/:/g, '#58;').replace(/\r?\n/g, '<br>');

export function parseTimeline(code: string): ParseResult<Timeline> {
  const source = splitSource(code);
  if (!source) return refuse('The diagram is empty');
  const first = /^timeline\b\s*(.*)$/.exec(source.first);
  if (!first) return refuse('This isn’t a timeline', source.firstNumber);
  const timeline: Timeline = {
    type: 'timeline',
    head: source.head,
    title: '',
    sections: [],
    extras: [],
  };
  if (first[1]) timeline.extras.push(first[1]);
  let section: TimelineSection | null = null;
  let period: TimelinePeriod | null = null;
  const read = (t: string) => decodeEntities(t.trim().replace(/<br\s*\/?>/gi, '\n'));
  for (const { text: raw, number } of source.body) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%') || /^(accTitle|accDescr)\b/.test(line)) {
      timeline.extras.push(line);
      continue;
    }
    const title = /^title\s+(.*)$/.exec(line);
    if (title) {
      timeline.title = read(title[1]!);
      continue;
    }
    const named = /^section\s+(.*)$/.exec(line);
    if (named) {
      section = { label: read(named[1]!), periods: [] };
      timeline.sections.push(section);
      period = null;
      continue;
    }
    const parts = line.split(':').map((p) => p.trim());
    if (line.startsWith(':')) {
      // More events for the period above.
      if (!period) return refuse('Events have no period', number);
      period.events.push(...parts.slice(1).filter(Boolean).map(read));
      continue;
    }
    if (!section) {
      section = { label: null, periods: [] };
      timeline.sections.push(section);
    }
    period = { label: read(parts[0]!), events: parts.slice(1).filter(Boolean).map(read) };
    section.periods.push(period);
  }
  return { ok: true, model: timeline };
}

export function printTimeline(timeline: Timeline): string {
  const out = ['timeline'];
  const write = (depth: number, text: string) => out.push(INDENT.repeat(depth) + text);
  if (timeline.title) write(1, `title ${timelineText(timeline.title)}`);
  for (const section of timeline.sections) {
    const depth = section.label === null ? 1 : 2;
    if (section.label !== null) write(1, `section ${timelineText(section.label)}`);
    for (const period of section.periods) {
      const events = period.events.map((e) => ` : ${timelineText(e)}`).join('');
      write(depth, `${timelineText(period.label)}${events}`);
    }
  }
  for (const extra of timeline.extras) write(1, extra);
  return withHead(timeline.head, out);
}

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

export interface GanttTask {
  name: string;
  tags: GanttTag[];
  id: string | null;
  start: GanttStart;
  end: GanttEnd;
}

export interface GanttSection {
  label: string | null;
  tasks: GanttTask[];
}

export interface Gantt {
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

export function parseGantt(code: string): ParseResult<Gantt> {
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
  };
  let section: GanttSection | null = null;
  for (const { text: raw, number } of source.body) {
    const line = raw.trim();
    if (!line) continue;
    const setting = /^(\w+)\b\s*(.*)$/.exec(line);
    const word = setting?.[1];
    if (line.startsWith('%%')) {
      gantt.extras.push(line);
      continue;
    }
    if (word === 'title') {
      gantt.title = decodeEntities(setting![2]!.trim());
      continue;
    }
    if (word === 'dateFormat') {
      gantt.dateFormat = setting![2]!.trim();
      continue;
    }
    if (word === 'excludes' && setting![2]!.trim() === 'weekends') {
      gantt.excludesWeekends = true;
      continue;
    }
    if (word === 'section') {
      section = { label: decodeEntities(setting![2]!.trim()), tasks: [] };
      gantt.sections.push(section);
      continue;
    }
    const colon = line.indexOf(':');
    if (
      word &&
      colon < 0 &&
      [
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
      ].includes(word)
    ) {
      gantt.extras.push(line);
      continue;
    }
    if (word && ['accTitle', 'accDescr', 'click'].includes(word)) {
      gantt.extras.push(line);
      continue;
    }
    if (colon <= 0) return refuse(`Couldn’t read “${line.slice(0, 40)}”`, number);
    const task = readTask(decodeEntities(line.slice(0, colon).trim()), line.slice(colon + 1));
    if (!task) return refuse('A task has no dates or length', number);
    if (!section) {
      section = { label: null, tasks: [] };
      gantt.sections.push(section);
    }
    section.tasks.push(task);
  }
  return { ok: true, model: gantt };
}

const ganttText = (text: string) => text.replace(/#/g, '#35;').replace(/:/g, '#58;');

export function printGantt(gantt: Gantt): string {
  const out = ['gantt'];
  const write = (text: string) => out.push(INDENT + text);
  if (gantt.title) write(`title ${ganttText(gantt.title)}`);
  write(`dateFormat ${gantt.dateFormat}`);
  if (gantt.excludesWeekends) write('excludes weekends');
  for (const extra of gantt.extras) write(extra);
  // A task with an id needs a start written out: "right after the task above" becomes
  // `after <its id>`, giving that task an id too when it has none.
  const tasks = gantt.sections.flatMap((s) => s.tasks);
  const ids = new Map(tasks.map((t) => [t, t.id]));
  const used = new Set(tasks.map((t) => t.id).filter(Boolean));
  let next = 1;
  for (let i = tasks.length - 1; i > 0; i -= 1) {
    const task = tasks[i]!;
    const before = tasks[i - 1]!;
    if (ids.get(task) && task.start.kind === 'previous' && !ids.get(before)) {
      while (used.has(`task${next}`)) next += 1;
      ids.set(before, `task${next}`);
      used.add(`task${next}`);
    }
  }
  let i = 0;
  for (const section of gantt.sections) {
    if (section.label !== null) write(`section ${ganttText(section.label)}`);
    for (const task of section.tasks) {
      const id = ids.get(task) ?? null;
      const start =
        task.start.kind === 'date'
          ? task.start.value
          : task.start.kind === 'after'
            ? `after ${task.start.ids.join(' ')}`
            : id && i > 0
              ? `after ${ids.get(tasks[i - 1]!)}`
              : null;
      const end = task.end.kind === 'until' ? `until ${task.end.ids.join(' ')}` : task.end.value;
      const meta = [...task.tags, ...(id && start ? [id, start] : start ? [start] : []), end];
      write(`${ganttText(task.name)} :${meta.join(', ')}`);
      i += 1;
    }
  }
  return withHead(gantt.head, out);
}

// Pie charts

export interface PieSlice {
  label: string;
  value: number;
}

export interface Pie {
  type: 'pie';
  head: string[];
  title: string;
  showData: boolean;
  slices: PieSlice[];
  extras: string[];
}

export function parsePie(code: string): ParseResult<Pie> {
  const source = splitSource(code);
  if (!source) return refuse('The diagram is empty');
  const first = /^pie\b(\s+showData)?(?:\s+title\s+(.*))?$/.exec(source.first);
  if (!first) return refuse('This isn’t a pie chart', source.firstNumber);
  const pie: Pie = {
    type: 'pie',
    head: source.head,
    title: first[2] ? decodeEntities(first[2].trim()) : '',
    showData: !!first[1],
    slices: [],
    extras: [],
  };
  for (const { text: raw, number } of source.body) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%') || /^(accTitle|accDescr)\b/.test(line)) {
      pie.extras.push(line);
      continue;
    }
    if (line === 'showData') {
      pie.showData = true;
      continue;
    }
    const title = /^title\s+(.*)$/.exec(line);
    if (title) {
      pie.title = decodeEntities(title[1]!.trim());
      continue;
    }
    const slice = /^("(?:[^"]*)")\s*:\s*(-?\d+(?:\.\d+)?)$/.exec(line);
    if (!slice) return refuse(`Couldn’t read “${line.slice(0, 40)}”`, number);
    pie.slices.push({ label: readLabel(slice[1]!), value: Number(slice[2]) });
  }
  return { ok: true, model: pie };
}

export function printPie(pie: Pie): string {
  const out = [pie.showData ? 'pie showData' : 'pie'];
  if (pie.title) out.push(`${INDENT}title ${pie.title}`);
  for (const slice of pie.slices) {
    out.push(`${INDENT}"${slice.label.replace(/"/g, '#quot;')}" : ${slice.value}`);
  }
  for (const extra of pie.extras) out.push(INDENT + extra);
  return withHead(pie.head, out);
}
