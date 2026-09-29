import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/** A keyboard key or shortcut, for example <Kbd>Ctrl K</Kbd>. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-block whitespace-nowrap rounded-[4px] border border-line-strong bg-surface px-1.5 font-mono text-2xs leading-4 font-medium text-fg-2',
        className,
      )}
      {...props}
    />
  );
}
