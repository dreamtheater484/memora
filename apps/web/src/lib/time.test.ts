import { describe, expect, it } from 'vitest';
import { formatDateTime, formatRelative } from './time';

// Midday UTC, so the dates hold in any time zone the tests run in.
describe('formatRelative', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const ago = (ms: number) => formatRelative(now - ms, now);
  const MINUTE = 60_000;

  it('counts up from "just now" to days', () => {
    expect(ago(20_000)).toBe('just now');
    expect(ago(MINUTE)).toBe('1 minute ago');
    expect(ago(45 * MINUTE)).toBe('45 minutes ago');
    expect(ago(3 * 60 * MINUTE)).toBe('3 hours ago');
    expect(ago(24 * 60 * MINUTE)).toBe('yesterday');
    expect(ago(6 * 24 * 60 * MINUTE)).toBe('6 days ago');
  });

  it('shows a date after a week', () => {
    expect(ago(9 * 24 * 60 * MINUTE)).toBe('Sep 20, 2026');
  });
});

describe('formatDateTime', () => {
  it('includes the date and the time', () => {
    const text = formatDateTime(Date.parse('2026-09-29T12:00:00Z'));
    expect(text).toMatch(/Sep 29, 2026/);
    expect(text).toMatch(/\d{2}:\d{2}/);
  });
});
