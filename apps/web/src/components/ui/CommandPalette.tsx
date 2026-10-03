import { Search } from 'lucide-react';
import { Dialog as D, VisuallyHidden } from 'radix-ui';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { fuzzyFilter } from '../../lib/fuzzy';
import { overlayClass } from './Dialog';
import { Kbd } from './Kbd';
import { sectionHeading } from './styles';

export interface PaletteItem {
  id: string;
  title: string;
  /** Group heading, for example "Pages" or "Commands". */
  group: string;
  subtitle?: string;
  icon?: ReactNode;
  /** Right-aligned hint: a shortcut, a date or a card key. */
  hint?: ReactNode;
  /** Extra words that should match, not shown. */
  keywords?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly PaletteItem[];
  /**
   * Filter the items here (default), or set to false when the caller filters,
   * for example with results from the server; it then gets `onQueryChange`.
   */
  filter?: boolean;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  /** Shown above the list, for example scope chips. */
  toolbar?: ReactNode;
  /** Preview of the active item, shown beside the list on wide screens. */
  renderPreview?: (item: PaletteItem) => ReactNode;
  emptyText?: ReactNode;
}

/**
 * Search and command launcher (Ctrl K). The input keeps focus; Up/Down move
 * the active result, Enter runs it, Escape closes. A phone gets it full screen.
 */
export function CommandPalette({ open, onOpenChange, ...props }: CommandPaletteProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          aria-describedby={undefined}
          // Its own shortcut closes it again; the app's others go on working over it.
          data-shortcuts=""
          className={cn(
            'glass-raised fixed z-50 flex flex-col overflow-hidden outline-none',
            'inset-0 animate-fade-in',
            'tablet:inset-x-auto tablet:top-[10vh] tablet:bottom-auto tablet:left-1/2 tablet:max-h-[min(40rem,80vh)] tablet:w-[min(55rem,calc(100vw-2rem))] tablet:-translate-x-1/2 tablet:animate-pop-in tablet:rounded-2xl',
          )}
        >
          <VisuallyHidden.Root>
            <D.Title>Search and commands</D.Title>
          </VisuallyHidden.Root>
          {/* Mounted only while open, so every opening starts fresh. */}
          <PaletteBody {...props} close={() => onOpenChange(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function PaletteBody({
  items,
  filter = true,
  onQueryChange,
  placeholder = 'Search notes, cards and commands',
  toolbar,
  renderPreview,
  emptyText = 'No results',
  close,
}: Omit<CommandPaletteProps, 'open' | 'onOpenChange'> & { close: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (item: PaletteItem) => `${baseId}-opt-${item.id}`;

  const groups = useMemo(() => {
    const list = filter
      ? fuzzyFilter(items, query, (i) => `${i.title} ${i.subtitle ?? ''} ${i.keywords ?? ''}`)
      : [...items];
    // Keep groups together, in the order their best result appears.
    const byGroup = new Map<string, PaletteItem[]>();
    for (const item of list) byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item]);
    return [...byGroup.entries()];
  }, [items, query, filter]);
  const results = useMemo(() => groups.flatMap(([, list]) => list), [groups]);
  const active: PaletteItem | undefined = results[Math.min(activeIndex, results.length - 1)];

  function onChange(q: string) {
    setQuery(q);
    setActiveIndex(0);
    onQueryChange?.(q);
  }

  function run(item: PaletteItem) {
    close();
    item.onSelect();
  }

  function moveTo(index: number) {
    const item = results[index];
    if (!item) return;
    setActiveIndex(index);
    const id = optionId(item);
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' }),
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;
    const last = results.length - 1;
    const cur = Math.min(activeIndex, last);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = cur === last ? 0 : cur + 1;
    else if (e.key === 'ArrowUp') next = cur === 0 ? last : cur - 1;
    else if (e.key === 'PageDown') next = Math.min(cur + 8, last);
    else if (e.key === 'PageUp') next = Math.max(cur - 8, 0);
    else if (e.key === 'Enter' && active) {
      e.preventDefault();
      run(active);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      moveTo(next);
    }
  }

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line pr-3.5 pl-4 text-fg-3">
        <Search className="size-[1.125rem] shrink-0" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-label="Search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-lg text-fg outline-none placeholder:text-fg-3"
        />
        <D.Close asChild>
          <button type="button" aria-label="Close" className="rounded-xs">
            <Kbd>Esc</Kbd>
          </button>
        </D.Close>
      </div>
      {toolbar && <div className="shrink-0 border-b border-line px-2.5 py-2">{toolbar}</div>}
      <div className={cn('grid min-h-0 flex-1', renderPreview && 'desktop:grid-cols-[1.15fr_1fr]')}>
        <div
          id={listId}
          role="listbox"
          aria-label="Results"
          className="min-h-0 overflow-auto p-1.5"
        >
          {results.length === 0 && (
            <div role="presentation" className="px-4 py-10 text-center text-fg-3">
              {emptyText}
            </div>
          )}
          {groups.map(([group, list], gi) => (
            <div key={group} role="group" aria-labelledby={`${baseId}-g${gi}`}>
              <div
                id={`${baseId}-g${gi}`}
                role="presentation"
                className={cn(sectionHeading, 'px-2.5 pt-2.5 pb-1')}
              >
                {group}
              </div>
              {list.map((item) => {
                const isActive = item === active;
                return (
                  <div
                    key={item.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={isActive}
                    onPointerMove={() => !isActive && setActiveIndex(results.indexOf(item))}
                    onClick={() => run(item)}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-sm px-2.5 py-2',
                      isActive && 'bg-accent-soft',
                    )}
                  >
                    {item.icon && (
                      <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-[8px] bg-hover text-fg-2 [&_svg]:size-4">
                        {item.icon}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-md font-semibold text-fg">{item.title}</span>
                      {item.subtitle && (
                        <span className="truncate text-xs text-fg-3">{item.subtitle}</span>
                      )}
                    </span>
                    {item.hint && (
                      <span className="shrink-0 self-center text-xs text-fg-3">{item.hint}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {renderPreview && active && (
          <div className="hidden min-h-0 overflow-auto border-l border-line bg-panel p-5 desktop:block">
            {renderPreview(active)}
          </div>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-4 border-t border-line px-4 py-2 text-xs whitespace-nowrap text-fg-3 tablet:flex">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
        </span>
        <span>
          <Kbd>Enter</Kbd> to open
        </span>
        <span>
          <Kbd>Esc</Kbd> to close
        </span>
      </div>
    </>
  );
}
