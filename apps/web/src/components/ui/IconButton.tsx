import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Tooltip } from './Tooltip';

export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE: Record<IconButtonSize, string> = {
  xs: 'size-6 [&_svg]:size-3.5',
  sm: 'size-7 [&_svg]:size-4',
  md: 'size-8 [&_svg]:size-[1.125rem]',
  lg: 'size-10 [&_svg]:size-5',
};

const RADIUS: Record<IconButtonSize, string> = {
  xs: 'rounded-xs',
  sm: 'rounded-sm',
  md: 'rounded-sm',
  lg: 'rounded-md',
};

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  icon: ReactNode;
  size?: IconButtonSize;
  /** Pressed or selected look (for toggles and open panels). */
  active?: boolean;
  /** Circle instead of a rounded square. */
  round?: boolean;
  /** Shortcut shown in the tooltip. */
  shortcut?: string;
  /** Set to false to skip the tooltip (for example inside menus). */
  tooltip?: boolean;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

/** Square icon-only button with a required label. */
export function IconButton({
  label,
  icon,
  size = 'md',
  active,
  round,
  shortcut,
  tooltip = true,
  tooltipSide,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      data-active={active || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-fg-2 transition-colors duration-(--dur-fast)',
        'hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50',
        'data-active:bg-hover data-active:text-fg aria-expanded:bg-hover aria-expanded:text-fg',
        SIZE[size],
        round ? 'rounded-full' : RADIUS[size],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}
