import { Tooltip as T } from 'radix-ui';
import type { ReactNode } from 'react';
import { Kbd } from './Kbd';

export const TooltipProvider = T.Provider;

export interface TooltipProps {
  content: ReactNode;
  /** Keyboard shortcut shown after the text, for example "Ctrl K". */
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}

/** Short label on hover and keyboard focus. Needs a TooltipProvider above it. */
export function Tooltip({ content, shortcut, side = 'bottom', children }: TooltipProps) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex animate-fade-in items-center gap-2 rounded-sm bg-fg px-2 py-1 text-xs font-medium text-bg shadow-pop"
        >
          {content}
          {shortcut && <Kbd className="border-bg/25 bg-transparent text-bg/80">{shortcut}</Kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
