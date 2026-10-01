import { useLayoutEffect, type RefObject } from 'react';

/**
 * Focuses a field (and selects its text) as it appears, so the first keystroke after a click
 * lands in it. A field opened from a menu item appears while the menu still holds the focus,
 * and the menu takes it back as it closes: a frame later the field gets it again.
 */
export function useFocusOnMount(ref: RefObject<HTMLInputElement | null>): void {
  useLayoutEffect(() => {
    const field = ref.current;
    field?.focus();
    field?.select();
    const frame = requestAnimationFrame(() => {
      if (!field || document.activeElement === field) return;
      field.focus();
      field.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}
