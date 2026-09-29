/*
 * Which page versions to keep (§9.7): everything from the last 48 hours, then one per hour for
 * 14 days, one per day for 90 days, and one per week after that; named versions always. Of the
 * versions in one hour (day, week), the newest is kept. Times are UTC, so a bucket never
 * depends on the server's time zone.
 */

export interface RetentionRules {
  /** Everything younger than this is kept. */
  allMs: number;
  /** Until this age, one per hour. */
  hourlyMs: number;
  /** Until this age, one per day; older, one per week. */
  dailyMs: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const DEFAULT_RETENTION: RetentionRules = {
  allMs: 48 * HOUR,
  hourlyMs: 14 * DAY,
  dailyMs: 90 * DAY,
};

/**
 * Parses `MEMORA_HISTORY_RETENTION`: three ages, such as `48h,14d,90d` (keep everything, then
 * hourly, then daily; weekly after the last). Units: h, d, w.
 */
export function parseRetention(text: string): RetentionRules {
  const ages = text.split(',').map((part) => {
    const match = /^\s*(\d+)\s*([hdw])\s*$/i.exec(part);
    if (!match) throw new Error(`"${part.trim()}" isn't an age like 48h, 14d or 12w.`);
    const unit = { h: HOUR, d: DAY, w: WEEK }[match[2]!.toLowerCase() as 'h' | 'd' | 'w'];
    return Number(match[1]) * unit;
  });
  if (ages.length !== 3) throw new Error('Give three ages, such as 48h,14d,90d.');
  const [allMs, hourlyMs, dailyMs] = ages as [number, number, number];
  if (!(allMs <= hourlyMs && hourlyMs <= dailyMs)) {
    throw new Error('The ages must grow: everything, then hourly, then daily.');
  }
  return { allMs, hourlyMs, dailyMs };
}

export interface VersionStamp {
  id: string;
  createdAt: number;
  name: string | null;
}

/** The versions of one page that the rules no longer keep. */
export function versionsToThin(
  versions: readonly VersionStamp[],
  now: number,
  rules: RetentionRules = DEFAULT_RETENTION,
): string[] {
  const seen = new Set<string>();
  const thin: string[] = [];
  // Newest first: the first version met in a bucket is the one kept.
  for (const version of [...versions].sort((a, b) => b.createdAt - a.createdAt)) {
    const age = now - version.createdAt;
    if (version.name || age < rules.allMs) continue;
    const size = age < rules.hourlyMs ? HOUR : age < rules.dailyMs ? DAY : WEEK;
    // Weeks start on Mondays (1970-01-01 was a Thursday).
    const offset = size === WEEK ? 3 * DAY : 0;
    const bucket = `${size}:${Math.floor((version.createdAt + offset) / size)}`;
    if (seen.has(bucket)) thin.push(version.id);
    else seen.add(bucket);
  }
  return thin;
}
