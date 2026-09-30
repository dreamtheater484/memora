import { dueState, type Card, type Label } from '@memora/shared';
import { CalendarClock, CheckSquare, FileText, MessageSquare, Paperclip } from 'lucide-react';
import { memo, type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { hueStyle } from '../theme/sections';
import { PRIORITY, shortDate } from './format';

/*
 * A card as the board shows it (§9.11): cover colour, labels, title, key, priority, due date
 * (red when overdue, amber when due soon), checklist progress and the counts of comments,
 * files and linked notes.
 */

export interface CardFaceProps extends HTMLAttributes<HTMLDivElement> {
  card: Card;
  cardKey: string;
  labels: ReadonlyMap<string, Label>;
  now: number;
}

export const CardFace = memo(function CardFace({
  card,
  cardKey,
  labels,
  now,
  className,
  ...props
}: CardFaceProps) {
  const due = dueState(card, now);
  const priority = PRIORITY[card.priority];
  const cardLabels = card.labelIds.map((id) => labels.get(id)).filter((l): l is Label => !!l);
  const done = !!card.completedAt;
  return (
    <div
      role="button"
      data-kb-card={card.id}
      aria-label={`${cardKey}: ${card.title}${done ? ', completed' : ''}`}
      className={cn(
        'group relative flex w-full cursor-grab flex-col gap-1.5 overflow-hidden rounded-lg border border-line bg-surface px-3 py-2.5 text-left shadow-[0_1px_2px_rgb(0_0_0/0.06)] outline-none select-none',
        'hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        className,
      )}
      {...props}
    >
      {card.coverColor && (
        <span
          aria-hidden
          className="hue absolute inset-x-0 top-0 h-1.5 bg-sec"
          style={hueStyle(card.coverColor)}
        />
      )}
      {cardLabels.length > 0 && (
        <span className="flex flex-wrap gap-1 pt-0.5">
          {cardLabels.map((l) => (
            <span
              key={l.id}
              className="hue rounded-full bg-sec-soft px-2 py-px text-2xs font-semibold text-sec-ink"
              style={hueStyle(l.color)}
            >
              {l.name}
            </span>
          ))}
        </span>
      )}
      <span
        className={cn(
          'text-sm leading-snug font-medium break-words',
          done && 'text-fg-2 line-through decoration-fg-3',
        )}
      >
        {card.title}
      </span>
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-fg-3 [&_svg]:size-3.5">
        <span className="font-mono text-2xs tracking-tight">{cardKey}</span>
        {priority.icon && (
          <span
            className={cn('inline-flex items-center gap-0.5', priority.className)}
            title={`${priority.label} priority`}
          >
            {priority.icon}
            <span className="sr-only">{priority.label} priority</span>
          </span>
        )}
        {card.dueDate && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-sm px-1',
              due === 'overdue' && 'bg-danger/12 font-semibold text-danger',
              (due === 'today' || due === 'soon') &&
                'bg-[oklch(0.8_0.14_85/0.22)] font-semibold text-[oklch(0.5_0.12_75)]',
            )}
            title={due === 'overdue' ? 'Overdue' : due === 'today' ? 'Due today' : 'Due'}
          >
            <CalendarClock aria-hidden />
            {shortDate(card.dueDate)}
            {due === 'overdue' && <span className="sr-only">, overdue</span>}
          </span>
        )}
        {card.checklist.total > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              card.checklist.done === card.checklist.total && 'text-[oklch(0.55_0.13_150)]',
            )}
            title="Checklist"
          >
            <CheckSquare aria-hidden />
            {card.checklist.done}/{card.checklist.total}
          </span>
        )}
        {card.comments > 0 && (
          <span className="inline-flex items-center gap-1" title="Comments">
            <MessageSquare aria-hidden />
            {card.comments}
          </span>
        )}
        {card.attachments > 0 && (
          <span className="inline-flex items-center gap-1" title="Files">
            <Paperclip aria-hidden />
            {card.attachments}
          </span>
        )}
        {card.pages > 0 && (
          <span className="inline-flex items-center gap-1" title="Linked notes">
            <FileText aria-hidden />
            {card.pages}
          </span>
        )}
      </span>
    </div>
  );
});
