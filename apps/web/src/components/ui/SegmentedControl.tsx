import { ToggleGroup } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface Segment<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
  /** Show only the icon; the label becomes the accessible name. */
  iconOnly?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  value: V;
  onValueChange: (value: V) => void;
  segments: readonly Segment<V>[];
  label: string;
  className?: string;
}

/** A small set of mutually exclusive options, for example Source / Split / Preview. */
export function SegmentedControl<V extends string>({
  value,
  onValueChange,
  segments,
  label,
  className,
}: SegmentedControlProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix sends "" when the active item is clicked again; keep the value.
      onValueChange={(v) => v && onValueChange(v as V)}
      aria-label={label}
      className={cn('inline-flex shrink-0 gap-0.5 rounded-full bg-hover p-0.5', className)}
    >
      {segments.map((s) => (
        <ToggleGroup.Item
          key={s.value}
          value={s.value}
          aria-label={s.iconOnly ? s.label : undefined}
          title={s.iconOnly ? s.label : undefined}
          className={cn(
            'inline-flex h-[1.625rem] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-fg-2 [&_svg]:size-3.5',
            'transition-colors duration-(--dur-fast) hover:text-fg',
            'data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--line)]',
            s.iconOnly && 'px-2',
          )}
        >
          {s.icon}
          {!s.iconOnly && s.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
