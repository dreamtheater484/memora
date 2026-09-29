import { FileText } from 'lucide-react';
import { HoverCard } from 'radix-ui';
import type { ReactElement } from 'react';
import type { PageSummary } from '../notes/summary';
import { hueStyle } from '../theme/sections';

/* A preview of the page a link leads to (§9.9), shown while hovering the link. */

export function PageCard({ summary }: { summary: PageSummary }) {
  return (
    <div className="flex w-72 flex-col gap-1.5 text-left">
      <span className="flex items-center gap-2 text-sm font-semibold text-fg">
        <FileText aria-hidden className="size-4 shrink-0 text-fg-3" />
        <span className="min-w-0 truncate">{summary.title}</span>
      </span>
      {summary.place && (
        <span
          className="hue flex items-center gap-1.5 text-xs text-fg-3"
          style={summary.color ? hueStyle(summary.color) : undefined}
        >
          <span aria-hidden className="size-2 rounded-full bg-sec" />
          <span className="truncate">{summary.place}</span>
        </span>
      )}
      <span className="line-clamp-4 text-xs text-fg-2">
        {summary.snippet || <i className="text-fg-3">Nothing written yet.</i>}
      </span>
    </div>
  );
}

export const pageCardClass =
  'glass-raised z-50 rounded-lg p-3 shadow-lg animate-fade-in data-[state=closed]:hidden';

export function PageHoverCard({
  summary,
  children,
}: {
  summary: PageSummary | null;
  children: ReactElement;
}) {
  if (!summary) return children;
  return (
    <HoverCard.Root openDelay={400} closeDelay={100}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          role="tooltip"
          side="bottom"
          align="start"
          sideOffset={6}
          className={pageCardClass}
        >
          <PageCard summary={summary} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
