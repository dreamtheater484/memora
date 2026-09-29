import { cn } from '../lib/cn';
import type { Heading } from './outline';

/** The page's headings; clicking one shows it (in the outline popover and the details panel). */
export function OutlineList({
  headings,
  onJump,
}: {
  headings: Heading[];
  onJump: (line: number) => void;
}) {
  if (!headings.length) {
    return <p className="px-2 py-1 text-xs text-fg-3">Headings you write show up here.</p>;
  }
  const top = Math.min(...headings.map((h) => h.level));
  return (
    <nav aria-label="Outline">
      <ul className="flex max-h-80 flex-col overflow-auto">
        {headings.map((h) => (
          <li key={`${h.line}`}>
            <button
              type="button"
              onClick={() => onJump(h.line)}
              style={{ paddingLeft: `${0.5 + (h.level - top) * 0.85}rem` }}
              className={cn(
                'w-full truncate rounded-sm py-1 pr-2 text-left text-sm hover:bg-hover',
                h.level === top ? 'font-semibold text-fg' : 'text-fg-2',
              )}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
