import { describe, expect, it } from 'vitest';
import { nextRun, parseSchedule } from './cron';

/* Times are local; the tests build them with local dates, so any TZ works. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe('backup schedules', () => {
  it('runs daily at 03:00 by default', () => {
    const daily = parseSchedule('0 3 * * *');
    expect(nextRun(daily, at(2026, 9, 30, 1, 15))).toEqual(at(2026, 9, 30, 3, 0));
    expect(nextRun(daily, at(2026, 9, 30, 3, 0))).toEqual(at(2026, 10, 1, 3, 0));
    expect(nextRun(daily, at(2026, 12, 31, 23, 59))).toEqual(at(2027, 1, 1, 3, 0));
  });

  it('understands steps, ranges, lists and names', () => {
    expect(nextRun(parseSchedule('*/15 * * * *'), at(2026, 9, 30, 10, 7))).toEqual(
      at(2026, 9, 30, 10, 15),
    );
    // Weekdays at 22:30: from a Friday night to Monday.
    const weekdays = parseSchedule('30 22 * * mon-fri');
    expect(nextRun(weekdays, at(2026, 10, 2, 23, 0))).toEqual(at(2026, 10, 5, 22, 30));
    expect(nextRun(parseSchedule('0 0 1,15 * *'), at(2026, 10, 2))).toEqual(at(2026, 10, 15));
    expect(nextRun(parseSchedule('0 4 * * 7'), at(2026, 10, 2))).toEqual(at(2026, 10, 4, 4));
  });

  it('matches either day when both the day and the weekday are set, like cron', () => {
    // The 13th, or any Friday.
    const either = parseSchedule('0 12 13 * 5');
    expect(nextRun(either, at(2026, 10, 1))).toEqual(at(2026, 10, 2, 12));
    expect(nextRun(either, at(2026, 10, 10))).toEqual(at(2026, 10, 13, 12));
  });

  it('refuses what isn’t a schedule', () => {
    for (const bad of ['0 3 * *', '60 3 * * *', '0 25 * * *', '*/0 * * * *', '5-1 * * * *', 'x']) {
      expect(() => parseSchedule(bad), bad).toThrow();
    }
    expect(nextRun(parseSchedule('0 0 31 2 *'), at(2026, 1, 1))).toBeNull();
  });
});
