import type { CSSProperties } from 'react';
import { cn } from '../../lib/cn';
import { initials, nameHue } from '../../lib/names';

const SIZE = {
  xs: 'size-5 text-[0.53rem]',
  sm: 'size-6 text-2xs',
  md: 'size-7 text-2xs',
  lg: 'size-10 text-sm',
};

export interface AvatarProps {
  name: string;
  size?: keyof typeof SIZE;
  /** Hide from screen readers when the name is already shown next to it. */
  decorative?: boolean;
  className?: string;
}

/** Round badge with a person's initials. */
export function Avatar({ name, size = 'md', decorative, className }: AvatarProps) {
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : name}
      style={{ '--h': nameHue(name) } as CSSProperties}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full bg-[oklch(0.55_0.12_var(--h))] font-semibold tracking-wide text-white select-none',
        SIZE[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
