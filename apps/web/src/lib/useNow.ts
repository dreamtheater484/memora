import { useEffect, useState } from 'react';

/** The current time, updated every `everyMs`: enough for "5 minutes ago" labels. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
