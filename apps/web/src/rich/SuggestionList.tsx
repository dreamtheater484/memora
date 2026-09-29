import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { floatingPanel, menuItem } from '../components/ui/styles';
import { cn } from '../lib/cn';
import type { MenuItem } from './suggestions';

/** The list of a `/` or `[[` menu: arrow keys move, Enter or Tab picks. */
export interface ListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SuggestionList = forwardRef<
  ListHandle,
  { items: MenuItem[]; command: (item: MenuItem) => void; label: string; empty: string }
>(function SuggestionList({ items, command, label, empty }, ref) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === 'ArrowDown') {
        setActive((i) => (items.length ? (i + 1) % items.length : 0));
        return true;
      }
      if (event.key === 'ArrowUp') {
        setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[active];
        if (!item) return false;
        command(item);
        return true;
      }
      return false;
    },
  }));
  return (
    <div
      role="listbox"
      aria-label={label}
      className={cn(floatingPanel, 'max-h-80 w-72 overflow-y-auto p-1')}
    >
      {items.length === 0 && <p className="px-2.5 py-2 text-sm text-fg-3">{empty}</p>}
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          role="option"
          aria-selected={i === active}
          ref={(el) => {
            if (i === active) el?.scrollIntoView({ block: 'nearest' });
          }}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => command(item)}
          className={cn(menuItem, 'w-full text-left', i === active && 'bg-hover')}
        >
          {item.icon}
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {item.hint && <span className="shrink-0 text-xs text-fg-3">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
});
