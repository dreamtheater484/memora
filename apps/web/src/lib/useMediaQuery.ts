import { useSyncExternalStore } from 'react';

/** True while the media query matches; follows changes (resizing, OS settings). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** Matches the desktop breakpoint (64rem) and up, where drawers become columns. */
export const DESKTOP_QUERY = '(min-width: 64rem)';
