import {
  EMPTY_TEXT,
  INDENT,
  escapeEntities,
  keepEnds,
  writeBreaks,
  writeNumber,
  writeText,
  type FromOrigin,
} from './common';
import {
  arrange,
  common,
  indentOf,
  originsOf,
  printChecked,
  sameBag,
  sameJson,
  shiftLines,
  type Entry,
} from './source';
import {
  type Chunk,
  type SectionBlock,
  type EventsLine,
  type Gantt,
  type GanttLayout,
  type GanttLine,
  type GanttSection,
  type GanttTask,
  type Pie,
  type PieLayout,
  type PieLine,
  type Timeline,
  type TimelineLayout,
  type TimelineLine,
  type TimelinePeriod,
  type TimelineSection,
  chartSyntax,
} from './charts';

const {
  chartTitle,
  eventText,
  noComment,
  notKeyword,
  periodText,
  readGanttCode,
  readPieCode,
  readTimelineCode,
  sectionText,
} = chartSyntax;

/*
 * Timelines, Gantt charts and pie charts written back as Mermaid code (§9.4), changing as little of the code they
 * were read from as possible. Apart from the reading, so that what only reads diagrams
 * (snippets, search) does not load the writing.
 */

interface SectionedWriter<S extends FromOrigin & { label: string | null }, I extends FromOrigin> {
  out: string[];
  /** The lines before the first section; null when the model has no source. */
  preamble: number[] | null;
  /** By section origin. */
  blocks: SectionBlock[];
  itemCount: number;
  sections: S[];
  items: (section: S) => I[];
  /** A body line: an item's first line (by origin), another line, or null for an item's other lines. */
  entry: (line: number) => Entry | null;
  /** Another line, as it is written now ([] when it goes). */
  line: (line: number) => string[];
  /** Another line of a section that was removed. */
  goneLine: (line: number) => string[];
  sectionLine: (section: S, origin: number | null) => string;
  /** An item's lines; `indent` moves it there, null keeps it where it was. */
  item: (item: I, origin: number | null, indent: string | null) => string[];
  /** Where moved and new items go in: a section by origin, a new one (null), or before any. */
  itemIndent: (section: number | null | 'loose') => string;
}

function writeSectioned<S extends FromOrigin & { label: string | null }, I extends FromOrigin>(
  w: SectionedWriter<S, I>,
) {
  const seenSections = new Set<number>();
  const seenItems = new Set<number>();
  const items = (lines: number[], list: I[], section: number | null | 'loose') => {
    const keys = originsOf(list, w.itemCount, seenItems);
    const entries: Entry[] = [];
    for (const line of lines) {
      const entry = w.entry(line);
      if (entry) entries.push(entry);
    }
    for (const placed of arrange(entries, keys)) {
      if (placed.kind === 'line') w.out.push(...w.line(placed.line));
      else if (placed.kind === 'item') {
        const indent = placed.kept ? null : w.itemIndent(section);
        w.out.push(...w.item(list[placed.item]!, keys[placed.item]!, indent));
      }
    }
  };
  const before = w.blocks.findIndex((b) => b.line === null);
  const first = w.sections[0];
  const loose = first && first.label === null ? first : null;
  if (loose && loose.origin === before && before >= 0) seenSections.add(before);
  items(w.preamble ?? [], loose ? w.items(loose) : [], 'loose');
  const named = loose ? w.sections.slice(1) : w.sections;
  const keys = originsOf(named, w.blocks.length, seenSections).map((k) =>
    k !== null && w.blocks[k]!.line === null ? null : k,
  );
  const entries: Entry[] = w.blocks.flatMap((b, origin) =>
    b.line === null ? [] : [{ key: origin }],
  );
  for (const placed of arrange(entries, keys)) {
    if (placed.kind === 'gone') {
      if (!keys.includes(placed.key)) {
        for (const line of w.blocks[placed.key]!.body) w.out.push(...w.goneLine(line));
      }
    } else if (placed.kind === 'item') {
      const section = named[placed.item]!;
      const origin = keys[placed.item]!;
      w.out.push(w.sectionLine(section, origin));
      items(origin === null ? [] : w.blocks[origin]!.body, w.items(section), origin);
    }
  }
}

/** Inserts lines after the given positions of `out` (the latest position first). */
function insertAfter(out: string[], inserts: [at: number, lines: string[]][]) {
  for (const [at, lines] of inserts.sort((a, b) => b[0] - a[0])) out.splice(at + 1, 0, ...lines);
}

const periodLine = (p: TimelinePeriod) =>
  periodText(p.label) + p.events.map((e) => ` : ${eventText(e)}`).join('');

/** Rewrites a period's lines, keeping the events that didn't change as written. */
function rewritePeriod(
  lines: EventsLine[],
  texts: string[],
  was: TimelinePeriod,
  now: TimelinePeriod,
) {
  const label = lines[0]!.label!;
  const labelText = now.label === was.label ? label.raw : periodText(now.label);
  const places: [number, number][] = [];
  lines.forEach((l, li) => l.chunks.forEach((_, ci) => places.push([li, ci])));
  const perLine: (Chunk | string)[][] = lines.map(() => []);
  const keptAt = new Map(common(was.events, now.events).map(([before, after]) => [after, before]));
  let lineOfLast = 0;
  now.events.forEach((event, n) => {
    const before = keptAt.get(n);
    if (before === undefined) perLine[lineOfLast]!.push(event);
    else {
      const [li, ci] = places[before]!;
      perLine[li]!.push(lines[li]!.chunks[ci]!);
      lineOfLast = li;
    }
  });
  const out: string[] = [];
  lines.forEach((line, li) => {
    const list = perLine[li]!;
    const same = list.length === line.chunks.length && list.every((c, k) => c === line.chunks[k]);
    if (same && (li > 0 || labelText === label.raw)) {
      out.push(texts[li]!);
      return;
    }
    if (li > 0 && !list.length) return;
    let text = line.indent + (li === 0 ? labelText + label.suffix : line.lead);
    for (const chunk of list) {
      if (typeof chunk === 'string') {
        text += `${text.trim() && !/\s$/.test(text) ? ' ' : ''}: ${eventText(chunk)}`;
      } else text += chunk.prefix + chunk.raw + chunk.suffix;
    }
    out.push(text.trimEnd());
  });
  return out;
}

function writeTimeline(timeline: Timeline, layout: TimelineLayout | null): string {
  const was = layout?.was;
  const out = [layout?.firstLine ?? 'timeline'];
  const lines = layout?.lines ?? [];
  const wasPeriods = was ? was.sections.flatMap((s) => s.periods) : [];
  const pairs = was ? common(was.extras, timeline.extras) : [];
  const keptExtras = new Set(pairs.map(([b]) => b));
  const newExtras = timeline.extras.filter((_, j) => !pairs.some(([, a]) => a === j));
  const firstIndent = (kind: TimelineLine['kind'], within?: number[]) => {
    const at = (within ?? lines.map((_, i) => i)).find((i) => lines[i]!.kind === kind);
    return at === undefined ? null : indentOf(lines[at]!.text);
  };
  const statementIndent =
    lines
      .map((l) => l.text)
      .find((t) => t.trim() !== '')
      ?.match(/^[ \t]*/)?.[0] || INDENT;
  const sectionIndent = firstIndent('section') ?? INDENT;
  const titleChanged = !was || timeline.title !== was.title;
  const keptLine = (i: number): string[] => {
    const line = lines[i]!;
    if (line.kind === 'extra') return keptExtras.has(line.extra) ? [line.text] : [];
    if (line.kind === 'title') {
      if (!titleChanged) return [line.text];
      return i === layout!.titleAt && timeline.title
        ? [`${indentOf(line.text)}title ${chartTitle(timeline.title)}`]
        : [];
    }
    return [line.text];
  };
  writeSectioned<TimelineSection, TimelinePeriod>({
    out,
    preamble: layout ? layout.preamble : null,
    blocks: layout?.blocks ?? [],
    itemCount: wasPeriods.length,
    sections: timeline.sections,
    items: (s) => s.periods,
    entry: (i) => {
      const line = lines[i]!;
      if (line.kind === 'period') return { key: line.period };
      return line.kind === 'events' ? null : { line: i };
    },
    line: (i) => keptLine(i),
    goneLine: (i) => (lines[i]!.kind === 'extra' || lines[i]!.kind === 'title' ? keptLine(i) : []),
    sectionLine: (section, origin) => {
      const label = section.label ?? '';
      if (origin !== null && layout) {
        const line = lines[layout.blocks[origin]!.line!]!;
        if (was!.sections[origin]!.label === section.label) return line.text;
        return `${indentOf(line.text)}section ${sectionText(label)}`;
      }
      return `${sectionIndent}section ${sectionText(label)}`;
    },
    item: (period, origin, indent) => {
      if (origin === null || !layout) return [(indent ?? statementIndent) + periodLine(period)];
      const at = layout.periods[origin]!;
      const own = at.map((i) => lines[i] as Extract<TimelineLine, { kind: 'period' | 'events' }>);
      const texts = own.map((l) => l.text);
      const before = wasPeriods[origin]!;
      const written =
        before.label === period.label && sameJson(before.events, period.events)
          ? texts
          : rewritePeriod(
              own.map((l) => l.events),
              texts,
              before,
              period,
            );
      return indent === null ? written : shiftLines(written, own[0]!.events.indent, indent);
    },
    itemIndent: (origin) => {
      if (origin === 'loose') {
        return (layout && firstIndent('period', layout.preamble)) ?? statementIndent;
      }
      if (layout && origin !== null) {
        const found = firstIndent('period', layout.blocks[origin]!.body);
        if (found !== null) return found;
      }
      // As in the other sections, or one step in from the section's line.
      for (const block of layout?.blocks ?? []) {
        if (block.line === null) continue;
        const found = firstIndent('period', block.body);
        if (found !== null) return found;
      }
      return sectionIndent + INDENT;
    },
  });
  const inserts: [number, string[]][] = [];
  if (timeline.title && (!layout || layout.titleAt === null)) {
    inserts.push([0, [`${statementIndent}title ${chartTitle(timeline.title)}`]]);
  }
  insertAfter(out, inserts);
  out.push(...newExtras.map((e) => statementIndent + e));
  return [...timeline.head, ...out, ...(layout?.tail ?? [])].join(layout?.eol ?? '\n');
}

/** Sections that say something: no items before any section is no such section. */
const written = <S extends { label: string | null }>(sections: S[], items: (s: S) => unknown[]) =>
  sections.filter((s, i) => !(i === 0 && s.label === null && !items(s).length));

const timelineMeaning = (t: Timeline) => ({
  head: t.head,
  title: t.title,
  sections: written(t.sections, (s) => s.periods).map((s) => ({
    label: s.label,
    periods: s.periods.map((p) => ({ label: p.label, events: p.events })),
  })),
});

const sameTimeline = (a: Timeline, b: Timeline) =>
  sameJson(timelineMeaning(a), timelineMeaning(b)) && sameBag(a.extras, b.extras);

export function printTimeline(timeline: Timeline): string {
  return printChecked(timeline, readTimelineCode, writeTimeline, sameTimeline);
}

const GANTT_KEYWORDS =
  /^(title|section|dateFormat|axisFormat|tickInterval|todayMarker|excludes|includes|weekday|weekend|inclusiveEndDates|topAxis|displayMode|accTitle|accDescr|click)\b|^\d{4}-\d\d-\d\d/i;
const ganttName = (text: string) =>
  text === ''
    ? EMPTY_TEXT
    : notKeyword(
        keepEnds(writeBreaks(noComment(escapeEntities(text)).replace(/:/g, '#58;'))),
        GANTT_KEYWORDS,
      );
const ganttSection = (text: string) => (text === '' ? EMPTY_TEXT : noComment(writeText(text)));

/**
 * How each task is written: a task with an id needs a start written out, so "right after the
 * task above" becomes `after <its id>`, giving that task an id too when it has none. (The
 * first task can't start after another, so its id is left out.)
 */
function ganttPlan(gantt: Gantt): Map<GanttTask, GanttTask> {
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
  const plan = new Map<GanttTask, GanttTask>();
  tasks.forEach((task, i) => {
    let id = ids.get(task) ?? null;
    let start = task.start;
    if (start.kind === 'previous' && id) {
      if (i > 0) start = { kind: 'after', ids: [ids.get(tasks[i - 1]!)!] };
      else id = null;
    }
    plan.set(task, { name: task.name, tags: task.tags, id, start, end: task.end });
  });
  return plan;
}

const taskMeta = (task: GanttTask) => {
  const start =
    task.start.kind === 'date'
      ? task.start.value
      : task.start.kind === 'after'
        ? `after ${task.start.ids.join(' ')}`
        : null;
  const end = task.end.kind === 'until' ? `until ${task.end.ids.join(' ')}` : task.end.value;
  return [
    ...task.tags,
    ...(task.id && start ? [task.id] : []),
    ...(start ? [start] : []),
    end,
  ].join(', ');
};

const sameMeta = (a: GanttTask, b: GanttTask) =>
  sameJson([a.tags, a.id, a.start, a.end], [b.tags, b.id, b.start, b.end]);

function writeGantt(gantt: Gantt, layout: GanttLayout | null): string {
  const was = layout?.was;
  const out = [layout?.firstLine ?? 'gantt'];
  const lines = layout?.lines ?? [];
  const wasTasks = was ? was.sections.flatMap((s) => s.tasks) : [];
  const plan = ganttPlan(gantt);
  const pairs = was ? common(was.extras, gantt.extras) : [];
  const keptExtras = new Set(pairs.map(([b]) => b));
  const newExtras = gantt.extras.filter((_, j) => !pairs.some(([, a]) => a === j));
  const statementIndent =
    lines
      .map((l) => l.text)
      .find((t) => t.trim() !== '')
      ?.match(/^[ \t]*/)?.[0] || INDENT;
  const firstIndent = (kind: GanttLine['kind'], within?: number[]) => {
    const at = (within ?? lines.map((_, i) => i)).find((i) => lines[i]!.kind === kind);
    return at === undefined ? null : indentOf(lines[at]!.text);
  };
  const sectionIndent = firstIndent('section') ?? statementIndent;
  const taskIndent = firstIndent('task') ?? sectionIndent;
  const marks: { title?: number; dateFormat?: number } = {};
  const setting = (kind: 'title' | 'dateFormat' | 'excludes', line: GanttLine): string[] => {
    if (kind === 'title') {
      if (!gantt.title) return [];
      marks.title = out.length;
      if (gantt.title === was!.title) return [line.text];
      return [`${indentOf(line.text)}title ${chartTitle(gantt.title)}`];
    }
    if (kind === 'dateFormat') {
      marks.dateFormat = out.length;
      return gantt.dateFormat === was!.dateFormat
        ? [line.text]
        : [`${indentOf(line.text)}dateFormat ${gantt.dateFormat}`];
    }
    return gantt.excludesWeekends ? [line.text] : [];
  };
  writeSectioned<GanttSection, GanttTask>({
    out,
    preamble: layout ? layout.preamble : null,
    blocks: layout?.blocks ?? [],
    itemCount: wasTasks.length,
    sections: gantt.sections,
    items: (s) => s.tasks,
    entry: (i) => {
      const line = lines[i]!;
      return line.kind === 'task' ? { key: line.task } : { line: i };
    },
    line: (i) => {
      const line = lines[i]!;
      if (line.kind === 'extra') return keptExtras.has(line.extra) ? [line.text] : [];
      if (line.kind === 'title' || line.kind === 'dateFormat' || line.kind === 'excludes') {
        // Only the last of each setting counts; the others stay as written.
        const last = layout!.at[line.kind] === i;
        return last ? setting(line.kind, line) : [line.text];
      }
      return [line.text];
    },
    goneLine: (i) => {
      const line = lines[i]!;
      if (line.kind === 'extra') return keptExtras.has(line.extra) ? [line.text] : [];
      if (line.kind === 'title' || line.kind === 'dateFormat' || line.kind === 'excludes') {
        return layout!.at[line.kind] === i ? setting(line.kind, line) : [line.text];
      }
      return [];
    },
    sectionLine: (section, origin) => {
      const label = section.label ?? '';
      if (origin !== null && layout) {
        const line = lines[layout.blocks[origin]!.line!]!;
        if (was!.sections[origin]!.label === section.label) return line.text;
        return `${indentOf(line.text)}section ${ganttSection(label)}`;
      }
      return `${sectionIndent}section ${ganttSection(label)}`;
    },
    item: (task, origin, indent) => {
      const planned = plan.get(task)!;
      if (origin === null || !layout) {
        return [`${indent ?? taskIndent}${ganttName(task.name)} :${taskMeta(planned)}`];
      }
      const line = lines[layout.tasks[origin]!] as Extract<GanttLine, { kind: 'task' }>;
      const before = wasTasks[origin]!;
      const own = indentOf(line.text);
      let name = line.text.slice(own.length, line.colon);
      let meta = line.text.slice(line.colon + 1);
      if (task.name !== before.name) {
        name = ganttName(task.name) + (/\s*$/.exec(name)?.[0] ?? '');
      }
      if (!sameMeta(planned, before)) meta = (/^\s*/.exec(meta)?.[0] ?? '') + taskMeta(planned);
      return [`${indent ?? own}${name}:${meta}`];
    },
    itemIndent: (origin) => {
      const block =
        origin === 'loose'
          ? layout?.preamble
          : origin === null
            ? undefined
            : layout?.blocks[origin]?.body;
      return (block && firstIndent('task', block)) ?? taskIndent;
    },
  });
  // Settings the code didn't have go at the top.
  const settings: string[] = [];
  if (gantt.title && (!layout || layout.at.title === null)) {
    settings.push(`${statementIndent}title ${chartTitle(gantt.title)}`);
  }
  const inserts: [number, string[]][] = [];
  const dateFormat = `${statementIndent}dateFormat ${gantt.dateFormat}`;
  const needsDateFormat = !layout
    ? true
    : layout.at.dateFormat === null && gantt.dateFormat !== was!.dateFormat;
  const excludes =
    gantt.excludesWeekends && (!layout || layout.at.excludes === null)
      ? [`${statementIndent}excludes weekends`]
      : [];
  if (needsDateFormat) {
    if (marks.title !== undefined && !settings.length)
      inserts.push([marks.title, [dateFormat, ...excludes]]);
    else settings.push(dateFormat, ...excludes);
  } else if (excludes.length) {
    const after = marks.dateFormat ?? marks.title;
    if (after !== undefined && !settings.length) inserts.push([after, excludes]);
    else settings.push(...excludes);
  }
  if (!layout) {
    // Afresh: the settings, then the kept ones, then the tasks.
    out.splice(1, 0, ...settings, ...newExtras.map((e) => statementIndent + e));
  } else {
    inserts.push([0, settings]);
    insertAfter(out, inserts);
    out.push(...newExtras.map((e) => statementIndent + e));
  }
  return [...gantt.head, ...out, ...(layout?.tail ?? [])].join(layout?.eol ?? '\n');
}

const ganttMeaning = (gantt: Gantt) => {
  const plan = ganttPlan(gantt);
  return {
    head: gantt.head,
    title: gantt.title,
    dateFormat: gantt.dateFormat,
    excludesWeekends: gantt.excludesWeekends,
    sections: written(gantt.sections, (s) => s.tasks).map((s) => ({
      label: s.label,
      tasks: s.tasks.map((t) => {
        const p = plan.get(t)!;
        return [p.name, p.tags, p.id, p.start, p.end];
      }),
    })),
  };
};

const sameGantt = (a: Gantt, b: Gantt) =>
  sameJson(ganttMeaning(a), ganttMeaning(b)) && sameBag(a.extras, b.extras);

export function printGantt(gantt: Gantt): string {
  return printChecked(gantt, readGanttCode, writeGantt, sameGantt);
}

const sliceLabel = (label: string) =>
  `"${writeBreaks(escapeEntities(label)).replace(/"/g, '#quot;').replace(/\\/g, '#92;')}"`;

function writePie(pie: Pie, layout: PieLayout | null): string {
  const was = layout?.was;
  const lines = layout?.lines ?? [];
  const indent =
    lines
      .map((l) => l.text)
      .find((t) => t.trim() !== '')
      ?.match(/^[ \t]*/)?.[0] || INDENT;
  const titleChanged = !was || pie.title !== was.title;
  // `showData` on a line of its own (which Mermaid doesn't read) stays while it's on.
  const ownShowData = typeof layout?.showDataAt === 'number' && pie.showData;
  const showDataFirst = pie.showData && !ownShowData;
  const titleFirst = layout?.titleAt === 'first';
  let first: string;
  if (
    layout &&
    showDataFirst === (layout.showDataAt === 'first') &&
    (!titleFirst || !titleChanged)
  ) {
    first = layout.firstLine;
  } else {
    const title = titleFirst && pie.title ? ` title ${chartTitle(pie.title)}` : '';
    first = `${indentOf(layout?.firstLine ?? '')}pie${showDataFirst ? ' showData' : ''}${title}`;
  }
  const out = [first];
  const pairs = was ? common(was.extras, pie.extras) : [];
  const keptExtras = new Set(pairs.map(([b]) => b));
  const newExtras = pie.extras.filter((_, j) => !pairs.some(([, a]) => a === j));
  const keys = was
    ? originsOf(pie.slices, was.slices.length, new Set())
    : pie.slices.map(() => null);
  const entries: Entry[] = lines.map((l, i) =>
    l.kind === 'slice' ? { key: l.slice } : { line: i },
  );
  const sliceAt = new Map<number, Extract<PieLine, { kind: 'slice' }>>();
  for (const l of lines) if (l.kind === 'slice') sliceAt.set(l.slice, l);
  const sliceIndent = [...sliceAt.values()][0]?.indent ?? indent;
  for (const placed of arrange(entries, keys)) {
    if (placed.kind === 'line') {
      const line = lines[placed.line]!;
      if (line.kind === 'extra') {
        if (keptExtras.has(line.extra)) out.push(line.text);
      } else if (line.kind === 'title') {
        if (!titleChanged) out.push(line.text);
        else if (placed.line === layout!.titleAt && pie.title) {
          out.push(`${indentOf(line.text)}title ${chartTitle(pie.title)}`);
        }
      } else if (line.kind === 'showData') {
        if (ownShowData) out.push(line.text);
      } else out.push(line.text);
    } else if (placed.kind === 'item') {
      const slice = pie.slices[placed.item]!;
      const origin = keys[placed.item]!;
      const line = origin === null ? undefined : sliceAt.get(origin);
      if (line) {
        const before = was!.slices[origin!]!;
        const label = slice.label === before.label ? line.label : sliceLabel(slice.label);
        const value = slice.value === before.value ? line.value : writeNumber(slice.value);
        out.push(line.indent + label + line.between + value + line.after);
      } else out.push(`${sliceIndent}${sliceLabel(slice.label)} : ${writeNumber(slice.value)}`);
    }
  }
  if (pie.title && !titleFirst && (layout?.titleAt ?? null) === null) {
    out.splice(1, 0, `${indent}title ${chartTitle(pie.title)}`);
  }
  out.push(...newExtras.map((e) => indent + e));
  return [...pie.head, ...out, ...(layout?.tail ?? [])].join(layout?.eol ?? '\n');
}

const pieMeaning = (pie: Pie) => ({
  head: pie.head,
  title: pie.title,
  showData: pie.showData,
  slices: pie.slices.map((s) => [s.label, s.value]),
});

const samePie = (a: Pie, b: Pie) =>
  sameJson(pieMeaning(a), pieMeaning(b)) && sameBag(a.extras, b.extras);

export function printPie(pie: Pie): string {
  return printChecked(pie, readPieCode, writePie, samePie);
}

/** What a chart means, without how its code is written (for comparing two of them). */
export const chartMeaning = {
  timeline: (t: Timeline) => ({ ...timelineMeaning(t), extras: [...t.extras].sort() }),
  gantt: (g: Gantt) => ({ ...ganttMeaning(g), extras: [...g.extras].sort() }),
  pie: (p: Pie) => ({ ...pieMeaning(p), extras: [...p.extras].sort() }),
};
