import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';
import { hueStyle, type SectionColorId } from '../../theme/sections';

export interface ChipProps extends ComponentProps<'span'> {
  /** Tint in a section colour (labels, tags). */
  color?: SectionColorId;
  /** Adds a remove button with this accessible name, for example "Remove tag roadmap". */
  removeLabel?: string;
  onRemove?: () => void;
}

/** Small rounded label: tags, card labels, filters. */
export function Chip({
  color,
  removeLabel,
  onRemove,
  className,
  style,
  children,
  ...props
}: ChipProps) {
  return (
    <span
      style={color ? { ...hueStyle(color), ...style } : style}
      className={cn(
        'inline-flex h-[1.375rem] max-w-full items-center gap-1 rounded-full text-xs font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0',
        color ? 'hue bg-sec-soft text-sec-ink' : 'bg-hover text-fg-2',
        onRemove ? 'pr-0.5 pl-2' : 'px-2',
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel ?? 'Remove'}
          onClick={onRemove}
          className="grid size-[1.125rem] place-items-center rounded-full opacity-70 hover:bg-hover hover:opacity-100"
        >
          <X className="size-3!" />
        </button>
      )}
    </span>
  );
}

export type BadgeTone = 'accent' | 'neutral' | 'ok' | 'warn' | 'danger';

const TONE: Record<BadgeTone, string> = {
  accent: 'bg-accent text-on-accent',
  neutral: 'bg-hover text-fg-2',
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
};

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
}

/** Count or short status, for example unread items or "WIP 3/4". */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums',
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
