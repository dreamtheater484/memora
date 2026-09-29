import { useEffect, useState } from 'react';

/** `value` once it has stopped changing for `ms`: for work too slow to redo on every keystroke. */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
