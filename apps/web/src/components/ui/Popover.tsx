import { Popover as P } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';
import { floatingPanel } from './styles';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

/** Non-modal floating panel for small forms and pickers. */
export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          floatingPanel,
          'w-72 rounded-lg p-3 origin-(--radix-popover-content-transform-origin)',
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
