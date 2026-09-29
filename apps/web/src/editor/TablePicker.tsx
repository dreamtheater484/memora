import { useState } from 'react';
import { cn } from '../lib/cn';

/** The Word-like size picker: hover a grid, click to insert a table of that size. */
export function TablePicker({ onPick }: { onPick: (columns: number, rows: number) => void }) {
  const [size, setSize] = useState({ columns: 3, rows: 2 });
  const max = 8;
  return (
    <div className="flex flex-col gap-2">
      <div
        role="grid"
        aria-label="Table size"
        className="grid w-max grid-cols-8 gap-0.5"
        onMouseLeave={() => setSize({ columns: 3, rows: 2 })}
      >
        {Array.from({ length: max * max }, (_, i) => {
          const columns = (i % max) + 1;
          const rows = Math.floor(i / max) + 1;
          const on = columns <= size.columns && rows <= size.rows;
          return (
            <button
              key={i}
              type="button"
              aria-label={`${columns} columns, ${rows} rows`}
              onMouseEnter={() => setSize({ columns, rows })}
              onFocus={() => setSize({ columns, rows })}
              onClick={() => onPick(columns, rows)}
              className={cn(
                'size-4.5 rounded-[3px] border',
                on ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface',
              )}
            />
          );
        })}
      </div>
      <p className="text-xs text-fg-2 tabular-nums">
        {size.columns} × {size.rows} (plus a header row)
      </p>
    </div>
  );
}
