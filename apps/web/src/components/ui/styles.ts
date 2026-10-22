import { cn } from '../../lib/cn';

/** Class names shared by menus, selects, popovers, the palette and the section tabs. */

/** Floating layer: menus, select lists, popovers. */
export const floatingPanel =
  'glass-raised z-50 overflow-hidden rounded-md text-sm text-fg animate-pop-in outline-none';

/** One row in a menu or list. Highlighted by keyboard or pointer. */
export const menuItem =
  'relative flex h-8 cursor-default select-none items-center gap-2.5 rounded-sm px-2 text-sm text-fg outline-none ' +
  'data-highlighted:bg-hover data-disabled:pointer-events-none data-disabled:opacity-50 ' +
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-2';

export const menuSeparator = '-mx-1 my-1 h-px bg-line';

export const menuLabel = 'px-2 pt-2 pb-1 text-2xs font-semibold tracking-wider text-fg-3 uppercase';

/** Small uppercase heading used in the sidebar, inspector and palette. */
export const sectionHeading = 'text-2xs font-semibold tracking-[0.07em] text-fg-3 uppercase';

/**
 * A section tab (the element needs the section's `hueStyle`). The open one is filled with its
 * colour and stands on a line of that colour under the row (`sectionTabsLine`), like a binder's
 * divider; the others stay quiet.
 */
export const sectionTabClass = (selected: boolean) =>
  cn(
    'hue relative inline-flex h-8 shrink-0 items-center gap-2 rounded-t-lg px-3 text-base font-medium whitespace-nowrap',
    'transition-[background-color,color] duration-(--dur-fast)',
    selected
      ? 'bg-sec-strong font-semibold text-on-accent'
      : 'text-fg-2 hover:bg-hover hover:text-fg',
  );

/** The row's line in the open section's colour (the row needs that `hueStyle`). */
export const sectionTabsLine = 'hue items-end border-b-[3px] border-sec-strong';
