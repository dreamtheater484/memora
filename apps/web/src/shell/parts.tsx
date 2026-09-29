import type { NotebookIcon as NotebookIconId } from '@memora/shared';
import { Notebook } from 'lucide-react';
import { useRef, useState } from 'react';
import { useDropZone } from '../lib/dnd';
import { cn } from '../lib/cn';
import { useFocusOnMount } from '../lib/useFocusOnMount';
import { NOTEBOOK_ICON } from './icons';

/** The notebook's icon on a tile in its colour (the element needs the "hue" class). */
export function NotebookTile({ icon, className }: { icon: NotebookIconId; className?: string }) {
  const Icon = NOTEBOOK_ICON[icon] ?? Notebook;
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-[6px] bg-sec text-on-accent',
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2.2} />
    </span>
  );
}

/** Where a dragged item would land on this row or tab: a line before or after, or a ring. */
export function DropIndicator({
  kind,
  id,
  axis = 'y',
}: {
  kind: string;
  id: string;
  axis?: 'x' | 'y';
}) {
  const zone = useDropZone(kind, id);
  if (!zone) return null;
  if (zone === 'inside') {
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-accent/10 ring-2 ring-accent ring-inset"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute rounded-full bg-accent',
        axis === 'y' ? 'inset-x-1 h-0.5' : 'inset-y-1 w-0.5',
        axis === 'y' && (zone === 'before' ? '-top-px' : '-bottom-px'),
        axis === 'x' && (zone === 'before' ? '-left-0.5' : '-right-0.5'),
      )}
    />
  );
}

/**
 * A name edited in place: Enter or leaving the field saves, Escape cancels. Empty names are
 * not saved.
 */
export function InlineRename({
  value,
  label,
  onDone,
  className,
}: {
  value: string;
  label: string;
  onDone: (name: string | null) => void;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useFocusOnMount(ref);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = text.trim();
    onDone(save && name && name !== value ? name : null);
  };
  return (
    <input
      ref={ref}
      aria-label={label}
      value={text}
      maxLength={100}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      className={cn(
        'h-6 min-w-0 flex-1 rounded-xs border border-accent bg-surface px-1.5 text-base text-fg outline-none',
        className,
      )}
    />
  );
}
