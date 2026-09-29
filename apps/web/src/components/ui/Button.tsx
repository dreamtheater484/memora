import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  default:
    'border-line-strong bg-surface text-fg hover:bg-[color-mix(in_oklab,var(--surface),var(--fg)_6%)]',
  primary:
    'border-transparent bg-accent text-on-accent hover:bg-[color-mix(in_oklab,var(--accent),var(--surface)_14%)]',
  ghost: 'border-transparent text-fg-2 hover:bg-hover hover:text-fg',
  danger: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/15',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5',
  md: 'h-8 gap-1.5 px-3 text-sm [&_svg]:size-4',
  lg: 'h-10 gap-2 px-4 text-base [&_svg]:size-[1.125rem]',
};

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (for example a link) with button styles. */
  asChild?: boolean;
}

/** Pill-shaped button. Icons passed as children are sized automatically. */
export function Button({
  variant = 'default',
  size = 'md',
  asChild,
  className,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full border font-semibold',
        'transition-colors duration-(--dur-fast) disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    />
  );
}
