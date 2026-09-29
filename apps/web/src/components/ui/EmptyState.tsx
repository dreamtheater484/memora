import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { hueStyle, type SectionColorId } from '../../theme/sections';

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  /** Buttons, for example "New page" and "From a template". */
  actions?: ReactNode;
  /** Small print under the actions. */
  hint?: ReactNode;
  /** Section colour for the illustration; defaults to the current accent. */
  color?: SectionColorId;
  className?: string;
}

const accentHue = { '--h': 'var(--ah)', '--c': 'var(--ac)' } as CSSProperties;

/** Friendly placeholder for empty sections, lists and search results. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  hint,
  color,
  className,
}: EmptyStateProps) {
  const card = 'absolute h-[5.5rem] w-[4.375rem] rounded-[10px] border-[1.5px] border-sec';
  return (
    <div
      style={color ? hueStyle(color) : accentHue}
      className={cn(
        'hue flex flex-1 flex-col items-center justify-center gap-2.5 px-6 py-10 text-center',
        className,
      )}
    >
      <div aria-hidden className="relative mb-2.5 h-[6.25rem] w-32">
        <i className={cn(card, 'top-2 left-1.5 -rotate-9 bg-sec-softer opacity-55')} />
        <i className={cn(card, 'top-1.5 left-[3.125rem] rotate-8 bg-sec-softer opacity-75')} />
        <i
          className={cn(
            card,
            'top-0 left-[1.8rem] grid place-items-center bg-surface text-sec [&_svg]:size-[1.625rem]',
          )}
        >
          {icon}
        </i>
      </div>
      <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
      {description && <p className="max-w-[25rem] text-fg-2">{description}</p>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
      {hint && <p className="mt-1.5 text-xs text-fg-3">{hint}</p>}
    </div>
  );
}
