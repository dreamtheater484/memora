import { Check, Minus } from 'lucide-react';
import { Checkbox as C } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export type CheckboxProps = ComponentProps<typeof C.Root>;

/** Checkbox; `checked="indeterminate"` shows a dash. */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <C.Root
      className={cn(
        'group grid size-[1.0625rem] shrink-0 place-items-center rounded-[5px] border-[1.5px] border-line-strong bg-surface text-on-accent',
        'transition-colors duration-(--dur-fast) hover:border-fg-3 disabled:opacity-50',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
        className,
      )}
      {...props}
    >
      <C.Indicator className="animate-fade-in">
        <Check className="size-3 group-data-[state=indeterminate]:hidden" strokeWidth={3} />
        <Minus className="hidden size-3 group-data-[state=indeterminate]:block" strokeWidth={3} />
      </C.Indicator>
    </C.Root>
  );
}
