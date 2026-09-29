import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/** Loading placeholder with a soft shimmer. Size it with classes. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-sm bg-[linear-gradient(90deg,var(--hover)_25%,var(--line-strong)_50%,var(--hover)_75%)] bg-size-[200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
