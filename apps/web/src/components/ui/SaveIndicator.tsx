import { CircleDot, CloudCheck, CloudOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import { VisuallyHidden } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type SaveState = 'saved' | 'saving' | 'dirty' | 'offline' | 'conflict';

export interface SaveIndicatorProps {
  state: SaveState;
  /** Changes waiting in the offline outbox. */
  pending?: number;
  /** Opens details: the outbox when offline, the resolver on a conflict. */
  onClick?: () => void;
  /**
   * Hide the text and keep the icon ("auto" hides it when the surrounding
   * container is phone-sized). Offline and conflict always show their text.
   */
  compact?: boolean | 'auto';
  className?: string;
}

interface Look {
  icon: ReactNode;
  label: string;
  tone: string;
  /** Said by screen readers when the state appears. Saving/saved stay quiet. */
  announce?: string;
}

function saveLook(state: SaveState, pending = 0): Look {
  switch (state) {
    case 'saved':
      return { icon: <CloudCheck className="text-ok" />, label: 'Saved', tone: '' };
    case 'saving':
      return { icon: <LoaderCircle className="animate-spin" />, label: 'Saving…', tone: '' };
    case 'dirty':
      return { icon: <CircleDot className="text-warn" />, label: 'Unsaved changes', tone: '' };
    case 'offline': {
      const label = pending > 0 ? `Offline · ${pending} pending` : 'Offline';
      return {
        icon: <CloudOff />,
        label,
        tone: 'border-warn/45 bg-warn/10 text-warn',
        announce: `You are offline. ${pending > 0 ? `${pending} changes will be saved when you reconnect.` : 'Changes will be saved when you reconnect.'}`,
      };
    }
    case 'conflict':
      return {
        icon: <TriangleAlert />,
        label: 'Conflict',
        tone: 'border-danger/50 bg-danger/10 text-danger',
        announce: 'This page was changed elsewhere. Open the conflict to choose a version.',
      };
  }
}

/**
 * Shows whether the current page is saved. It must never claim "Saved" before
 * the server has confirmed the revision.
 */
export function SaveIndicator({
  state,
  pending = 0,
  onClick,
  compact = 'auto',
  className,
}: SaveIndicatorProps) {
  const look = saveLook(state, pending);
  const important = state === 'offline' || state === 'conflict';
  const labelClass = important
    ? ''
    : compact === true
      ? 'sr-only'
      : compact === 'auto'
        ? '@max-tablet:sr-only'
        : '';
  const Comp = onClick ? 'button' : 'span';
  return (
    <>
      <Comp
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        data-state={state}
        title={important ? undefined : look.label}
        className={cn(
          'inline-flex h-[1.875rem] shrink-0 items-center gap-1.5 rounded-full border border-(--glass-edge) bg-panel text-xs font-medium whitespace-nowrap text-fg-2 backdrop-blur-lg',
          '[&_svg]:size-[0.9375rem] [&_svg]:shrink-0',
          !important && compact === true ? 'px-2' : 'pr-3 pl-2.5',
          !important && compact === 'auto' && '@max-tablet:px-2',
          onClick && 'hover:text-fg',
          look.tone,
          className,
        )}
      >
        {look.icon}
        <span className={labelClass}>{look.label}</span>
      </Comp>
      <VisuallyHidden.Root role="status" aria-live="polite">
        {look.announce ?? ''}
      </VisuallyHidden.Root>
    </>
  );
}
