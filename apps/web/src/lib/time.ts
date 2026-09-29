const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const dateOnly = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "just now", "5 minutes ago", "yesterday", "3 days ago", then a date. */
export function formatRelative(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return relative.format(-Math.floor(diff / MINUTE), 'minute');
  if (diff < DAY) return relative.format(-Math.floor(diff / HOUR), 'hour');
  if (diff < 7 * DAY) return relative.format(-Math.floor(diff / DAY), 'day');
  return dateOnly.format(ms);
}

/** Full date and time, for tooltips and the audit log. */
export const formatDateTime = (ms: number): string => dateTime.format(ms);
