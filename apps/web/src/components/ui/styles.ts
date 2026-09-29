/** Class names shared by menus, selects, popovers and the palette. */

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
