/*
 * The backup schedule (§9.14) in cron syntax: minute, hour, day of month, month and day of week,
 * each `*`, a number, a range (`1-5`), a step (`*\/15`, `0-30/10`) or a list of those. Times are
 * the server's local time (the container's `TZ`). Like cron, a restricted day of month and day
 * of week match when either does.
 */

export interface Schedule {
  source: string;
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  anyDay: boolean;
  anyWeekday: boolean;
}

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
] as const;

const NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function parseField(text: string, { name, min, max }: (typeof FIELDS)[number]): Set<number> {
  const values = new Set<number>();
  const number = (part: string) => {
    const value = NAMES[part.toLowerCase()] ?? (/^\d+$/.test(part) ? Number(part) : NaN);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`"${part}" isn't a valid ${name} (${min}–${max}).`);
    }
    return value;
  };
  for (const item of text.split(',')) {
    const [range = '', stepText] = item.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`"${item}" has a bad step.`);
    let from: number;
    let to: number;
    if (range === '*') [from, to] = [min, max];
    else if (range.includes('-')) {
      const [a = '', b = ''] = range.split('-');
      [from, to] = [number(a), number(b)];
      if (from > to) throw new Error(`"${range}" runs backwards.`);
    } else {
      from = number(range);
      to = stepText === undefined ? from : max;
    }
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return values;
}

/** Parses a five-field cron expression; throws with a readable message when it isn't one. */
export function parseSchedule(source: string): Schedule {
  const parts = source.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      'A schedule has five fields: minute hour day month weekday (like "0 3 * * *").',
    );
  }
  const [minutes, hours, days, months, weekdays] = parts.map((part, i) =>
    parseField(part, FIELDS[i]!),
  ) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  // Sunday is 0 or 7.
  if (weekdays.has(7)) weekdays.add(0);
  return {
    source: source.trim(),
    minutes,
    hours,
    days,
    months,
    weekdays,
    anyDay: parts[2] === '*',
    anyWeekday: parts[4] === '*',
  };
}

function dayMatches(schedule: Schedule, date: Date): boolean {
  const day = schedule.days.has(date.getDate());
  const weekday = schedule.weekdays.has(date.getDay());
  if (schedule.anyDay && schedule.anyWeekday) return true;
  if (schedule.anyDay) return weekday;
  if (schedule.anyWeekday) return day;
  return day || weekday;
}

/** The first time after `after` that the schedule names (to the minute), or null for none. */
export function nextRun(schedule: Schedule, after: Date): Date | null {
  const t = new Date(after.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  // Four years is enough for any schedule that matches at all (29 February).
  const limit = after.getTime() + 4 * 366 * 24 * 3_600_000;
  while (t.getTime() <= limit) {
    if (!schedule.months.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(schedule, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!schedule.hours.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!schedule.minutes.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  return null;
}
