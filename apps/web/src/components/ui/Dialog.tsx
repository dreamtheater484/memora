import { X } from 'lucide-react';
import { Dialog as D, VisuallyHidden } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export const overlayClass = 'fixed inset-0 z-40 bg-overlay backdrop-blur-[3px] animate-fade-in';

const WIDTH = {
  sm: 'tablet:w-[min(26rem,calc(100vw-2rem))]',
  md: 'tablet:w-[min(32rem,calc(100vw-2rem))]',
  lg: 'tablet:w-[min(45rem,calc(100vw-2rem))]',
};

export interface DialogContentProps extends Omit<ComponentProps<typeof D.Content>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Keep the title for screen readers only. */
  hideTitle?: boolean;
  size?: keyof typeof WIDTH;
  /** Buttons along the bottom edge. */
  footer?: ReactNode;
  /** Hide the close button in the corner. */
  hideClose?: boolean;
}

/**
 * Modal dialog: centred on tablets and larger, a bottom sheet on phones.
 * Focus is trapped inside and returns to the trigger when it closes.
 */
export function DialogContent({
  title,
  description,
  hideTitle,
  size = 'md',
  footer,
  hideClose,
  className,
  children,
  ...props
}: DialogContentProps) {
  const heading = (
    <D.Title className="font-display text-xl font-semibold tracking-tight">{title}</D.Title>
  );
  return (
    <D.Portal>
      <D.Overlay className={overlayClass} />
      <D.Content
        // Without a description, opt out of Radix's default aria-describedby.
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'glass-raised fixed z-50 flex max-h-[85dvh] flex-col outline-none',
          // Phone: bottom sheet.
          'inset-x-0 bottom-0 animate-slide-in-up rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
          // Tablet and up: centred card.
          'tablet:inset-x-auto tablet:top-[12vh] tablet:bottom-auto tablet:left-1/2 tablet:-translate-x-1/2 tablet:animate-pop-in tablet:rounded-xl tablet:pb-0',
          WIDTH[size],
          className,
        )}
        {...props}
      >
        <div
          aria-hidden
          className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong tablet:hidden"
        />
        <div className="flex items-start gap-3 px-5 pt-4 tablet:pt-5">
          <div className="min-w-0 flex-1">
            {hideTitle ? <VisuallyHidden.Root>{heading}</VisuallyHidden.Root> : heading}
            {description && (
              <D.Description className="mt-1 text-sm text-fg-2">{description}</D.Description>
            )}
          </div>
          {!hideClose && (
            <D.Close asChild>
              <IconButton
                label="Close"
                icon={<X />}
                size="sm"
                tooltip={false}
                className="-mt-1 -mr-2"
              />
            </D.Close>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </D.Content>
    </D.Portal>
  );
}
