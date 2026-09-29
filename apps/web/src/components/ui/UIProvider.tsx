import type { ReactNode } from 'react';
import { Toaster } from './Toast';
import { TooltipProvider } from './Tooltip';

/** Shared providers for the UI kit: tooltip timing and the toast area. */
export function UIProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={250}>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
