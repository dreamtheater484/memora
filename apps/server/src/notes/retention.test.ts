import { describe, expect, it } from 'vitest';
import { parseRetention, versionsToThin, type VersionStamp } from './retention';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 8, 30, 12, 0);

const at = (id: string, ago: number, name: string | null = null): VersionStamp => ({
  id,
  createdAt: now - ago,
  name,
});

describe('version retention', () => {
  it('keeps everything from the last 48 hours', () => {
    const recent = [at('a', 1000), at('b', 2000), at('c', 47 * HOUR)];
    expect(versionsToThin(recent, now)).toEqual([]);
  });

  it('keeps the newest per hour, then per day, then per week', () => {
    const versions = [
      // Three days ago, in one hour: one stays.
      at('h1', 3 * DAY + 10 * 60_000),
      at('h2', 3 * DAY + 20 * 60_000),
      at('h3', 3 * DAY + 30 * 60_000),
      // Twenty days ago, in one day: one stays.
      at('d1', 20 * DAY + 1 * HOUR),
      at('d2', 20 * DAY + 5 * HOUR),
      // Two hundred days ago, a week apart and in one week.
      at('w1', 200 * DAY),
      at('w2', 200 * DAY + 60_000),
      at('w3', 214 * DAY),
    ];
    expect(versionsToThin(versions, now).sort()).toEqual(['d2', 'h2', 'h3', 'w2']);
  });

  it('always keeps named versions', () => {
    const versions = [at('n', 3 * DAY + 60_000, 'Before the rewrite'), at('x', 3 * DAY)];
    expect(versionsToThin(versions, now)).toEqual([]);
  });

  it('reads the setting', () => {
    expect(parseRetention('48h,14d,90d')).toEqual({
      allMs: 48 * HOUR,
      hourlyMs: 14 * DAY,
      dailyMs: 90 * DAY,
    });
    expect(parseRetention('1w, 4w, 52w').dailyMs).toBe(364 * DAY);
    expect(() => parseRetention('14d,48h,90d')).toThrow();
    expect(() => parseRetention('48h,14d')).toThrow();
    expect(() => parseRetention('forever')).toThrow();
  });
});
