import { Dialog as D, VisuallyHidden } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { overlayClass } from './Dialog';

export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

const SIDE = {
  left: 'inset-y-0 left-0 w-[min(19rem,86vw)] animate-slide-in-left rounded-r-2xl',
  right: 'inset-y-0 right-0 w-[min(20rem,88vw)] animate-slide-in-right rounded-l-2xl',
  bottom:
    'inset-x-0 bottom-0 max-h-[80dvh] animate-slide-in-up rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
};

export interface SheetContentProps extends Omit<ComponentProps<typeof D.Content>, 'title'> {
  side?: keyof typeof SIDE;
  /** Accessible name; visually hidden unless `showTitle` is set. */
  title: ReactNode;
  showTitle?: boolean;
}

/** Panel that slides in from an edge: navigation drawers, page lists on phones. */
export function SheetContent({
  side = 'left',
  title,
  showTitle,
  className,
  children,
  ...props
}: SheetContentProps) {
  const heading = (
    <D.Title className="px-4 pt-4 font-display text-lg font-semibold">{title}</D.Title>
  );
  return (
    <D.Portal>
      <D.Overlay className={overlayClass} />
      <D.Content
        aria-describedby={undefined}
        className={cn(
          'glass-raised fixed z-50 flex flex-col overflow-hidden outline-none',
          SIDE[side],
          className,
        )}
        {...props}
      >
        {side === 'bottom' && (
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" />
        )}
        {showTitle ? heading : <VisuallyHidden.Root>{heading}</VisuallyHidden.Root>}
        {children}
      </D.Content>
    </D.Portal>
  );
}
