import { CloudCheck, CloudOff, OctagonAlert, TriangleAlert } from 'lucide-react';
import { VisuallyHidden } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** The states of §9.6. */
export type SaveState = 'saved' | 'saving' | 'local' | 'conflict' | 'failed';

export interface SaveIndicatorProps {
  state: SaveState;
  /** When the server last confirmed the text, for the "Saved" tooltip. */
  savedAt?: number | null;
  /** Changes waiting to be sent (said in the "on this device" tooltip). */
  pending?: number;
  /** More about a failure, for its tooltip. */
  detail?: string;
  /** Opens details: the conflict, or the page with it. */
  onClick?: () => void;
  /**
   * Hide the text and keep the icon ("auto" hides it when the surrounding container is
   * phone-sized). The states that need attention always show their text.
   */
  compact?: boolean | 'auto';
  /** Say nothing to screen readers (another indicator on screen announces). */
  quiet?: boolean;
  /** Added to the tooltip (how changes from elsewhere arrive, say). */
  hint?: string;
  className?: string;
}

interface Look {
  icon: ReactNode;
  label: string;
  title: string;
  tone: string;
  /** Said by screen readers when the state appears. Saving and saved stay quiet. */
  announce?: string;
}

const time = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function saveLook(
  state: SaveState,
  savedAt: number | null,
  pending: number,
  detail?: string,
): Look {
  switch (state) {
    case 'saved':
      return {
        icon: <CloudCheck className="text-ok" />,
        label: 'Saved',
        title: savedAt ? `Saved to server at ${time.format(savedAt)}` : 'Saved to server',
        tone: '',
      };
    case 'saving':
      return {
        icon: (
          <span aria-hidden className="grid size-[0.9375rem] place-items-center">
            <span className="size-2 animate-pulse rounded-full bg-accent" />
          </span>
        ),
        label: 'Saving…',
        title: 'Sending your changes to the server',
        tone: '',
      };
    case 'local': {
      const waiting =
        pending > 1
          ? `${pending} changes wait`
          : pending === 1
            ? 'One change waits'
            : 'Changes wait';
      return {
        icon: <CloudOff />,
        label: 'Saved on this device',
        title: `${waiting} on this device until the server can be reached.`,
        tone: 'border-warn/40 text-fg',
        announce: 'Saved on this device. Changes will be sent when the server can be reached.',
      };
    }
    case 'conflict':
      return {
        icon: <TriangleAlert />,
        label: 'Changed elsewhere, review',
        title: 'This page was changed on another device too. Both versions are kept.',
        tone: 'border-warn/50 bg-warn/12 text-warn',
        announce: 'This page was changed elsewhere as well. Review the changes to choose.',
      };
    case 'failed':
      return {
        icon: <OctagonAlert />,
        label: 'Not saved, retrying',
        title: detail ?? 'Changes couldn’t be stored on this device. Memora keeps trying.',
        tone: 'border-danger/50 bg-danger/10 text-danger',
        announce: `Not saved. ${detail ?? 'Memora keeps trying.'}`,
      };
  }
}

/**
 * Shows whether the page (or everything) is saved. It must never claim "Saved" before the
 * server has confirmed the revision.
 */
export function SaveIndicator({
  state,
  savedAt = null,
  pending = 0,
  detail,
  onClick,
  compact = 'auto',
  quiet,
  hint,
  className,
}: SaveIndicatorProps) {
  const look = saveLook(state, savedAt, pending, detail);
  const important = state === 'local' || state === 'conflict' || state === 'failed';
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
        data-save-state={state}
        title={hint ? `${look.title}\n${hint}` : look.title}
        className={cn(
          'inline-flex h-[1.875rem] min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-(--glass-edge) bg-panel text-xs font-medium whitespace-nowrap text-fg-2 backdrop-blur-lg',
          '[&_svg]:size-[0.9375rem] [&_svg]:shrink-0',
          !important && compact === true ? 'px-2' : 'pr-3 pl-2.5',
          !important && compact === 'auto' && '@max-tablet:px-2',
          onClick && 'hover:text-fg',
          look.tone,
          className,
        )}
      >
        {look.icon}
        <span className={cn('truncate', labelClass)}>{look.label}</span>
      </Comp>
      {!quiet && (
        <VisuallyHidden.Root role="status" aria-live="polite">
          {look.announce ?? ''}
        </VisuallyHidden.Root>
      )}
    </>
  );
}
