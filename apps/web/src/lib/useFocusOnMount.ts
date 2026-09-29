import { useEffect, type RefObject } from 'react';

/**
 * Focuses a field (and selects its text) once it appears. It waits a frame: a field opened
 * from a menu item appears while the menu still holds the focus, and would lose it again.
 */
export function useFocusOnMount(ref: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}
