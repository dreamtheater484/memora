import { Folder, Inbox, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '../components/ui';
import { cn } from '../lib/cn';
import { fuzzyFilter } from '../lib/fuzzy';
import { hueStyle } from '../theme/sections';
import type { Destination } from './destinations';

/** A searchable list of places to pick one from; double-click picks and goes. */
export function DestinationPicker({
  all,
  picked,
  onPick,
  onChoose,
  placeholder,
}: {
  all: Destination[];
  picked: string | null;
  onPick: (id: string) => void;
  onChoose: () => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => (query.trim() ? fuzzyFilter(all, query, (d) => `${d.label} ${d.path}`) : all),
    [all, query],
  );
  return (
    <div className="flex flex-col gap-3">
      <Input
        pill
        icon={<Search />}
        aria-label="Search destinations"
        placeholder={placeholder}
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      <div
        role="radiogroup"
        aria-label="Destination"
        className="flex max-h-[45vh] flex-col gap-px overflow-y-auto"
      >
        {shown.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-fg-3">Nothing matches.</p>
        )}
        {shown.map((d) => (
          <label
            key={d.id}
            className={cn(
              'hue flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-base',
              picked === d.id
                ? 'bg-active font-semibold text-fg shadow-card'
                : 'text-fg-2 hover:bg-hover',
            )}
            style={hueStyle(d.color)}
          >
            <input
              type="radio"
              name="destination"
              value={d.id}
              checked={picked === d.id}
              onChange={() => onPick(d.id)}
              onDoubleClick={onChoose}
              className="sr-only"
            />
            {d.kind === 'section' && d.label === 'Inbox' && !d.notebookId ? (
              <Inbox className="size-4 shrink-0 text-fg-3" />
            ) : d.kind === 'group' ? (
              <Folder className="size-4 shrink-0 text-fg-3" />
            ) : d.kind === 'notebook' ? (
              <span aria-hidden className="size-3 shrink-0 rounded-[4px] bg-sec" />
            ) : (
              <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-sec" />
            )}
            <span className="min-w-0 truncate">{d.label}</span>
            {d.path && (
              <span className="ml-auto min-w-0 truncate text-xs font-normal text-fg-3">
                {d.path}
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
