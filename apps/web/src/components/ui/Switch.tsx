import { Switch as S } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export type SwitchProps = ComponentProps<typeof S.Root>;

/** On/off toggle for settings that apply immediately. */
export function Switch({ className, ...props }: SwitchProps) {
  return (
    <S.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-line-strong p-0.5 forced-colors:border',
        'transition-colors duration-(--dur-base) disabled:opacity-50 data-[state=checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <S.Thumb className="size-4 rounded-full bg-white shadow-card data-[state=checked]:bg-on-accent transition-transform duration-(--dur-base) ease-(--ease-out) data-[state=checked]:translate-x-4" />
    </S.Root>
  );
}
