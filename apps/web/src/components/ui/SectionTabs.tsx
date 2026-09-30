import { Plus } from 'lucide-react';
import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { hueStyle, type SectionColorId } from '../../theme/sections';
import { IconButton } from './IconButton';

export interface SectionTab {
  id: string;
  name: string;
  color: SectionColorId;
  /** Draws a divider before this tab (between section groups). */
  divider?: boolean;
}

export interface SectionTabsProps {
  sections: readonly SectionTab[];
  value: string | null;
  onValueChange: (id: string) => void;
  /** Adds a "New section" button after the tabs. */
  onAdd?: () => void;
  /** Shown before the tabs, for example the current section group. */
  leading?: ReactNode;
  /** Id of the element the selected tab controls. */
  panelId?: string;
  label?: string;
  className?: string;
}

/**
 * Coloured section tabs along the top of the page.
 * Arrow keys move between tabs and select them; Home and End jump to the ends.
 */
export function SectionTabs({
  sections,
  value,
  onValueChange,
  onAdd,
  leading,
  panelId,
  label = 'Sections',
  className,
}: SectionTabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const focusable = value && sections.some((s) => s.id === value) ? value : sections[0]?.id;

  // Keep the selected tab visible when the row scrolls.
  useEffect(() => {
    if (value) refs.current.get(value)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (index + 1) % sections.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + sections.length) % sections.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = sections.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = sections[next]?.id;
    if (!id) return;
    refs.current.get(id)?.focus();
    onValueChange(id);
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {leading}
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        className="flex items-center gap-1"
      >
        {sections.map((s, i) => {
          const selected = s.id === value;
          return (
            <Fragment key={s.id}>
              {s.divider && i > 0 && (
                <span aria-hidden className="mx-1.5 h-[18px] w-px shrink-0 bg-line-strong" />
              )}
              <button
                ref={(el) => {
                  if (el) refs.current.set(s.id, el);
                  else refs.current.delete(s.id);
                }}
                type="button"
                role="tab"
                id={`sectab-${s.id}`}
                aria-selected={selected}
                aria-controls={selected ? panelId : undefined}
                tabIndex={s.id === focusable ? 0 : -1}
                onClick={() => onValueChange(s.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                style={hueStyle(s.color)}
                className={cn(
                  'hue inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-base font-medium whitespace-nowrap',
                  'transition-[background-color,color,box-shadow] duration-(--dur-fast)',
                  selected
                    ? 'bg-sec-soft font-semibold text-sec-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--sec)_40%,transparent)]'
                    : 'text-fg-2 hover:bg-hover hover:text-fg',
                )}
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-sec" />
                {s.name}
              </button>
            </Fragment>
          );
        })}
      </div>
      {onAdd && <IconButton label="New section" icon={<Plus />} size="sm" onClick={onAdd} round />}
    </div>
  );
}
