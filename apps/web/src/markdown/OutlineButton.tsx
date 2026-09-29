import { ListTree } from 'lucide-react';
import { useState } from 'react';
import { IconButton, Popover, PopoverContent, PopoverTrigger } from '../components/ui';
import type { Heading } from './outline';
import { OutlineList } from './OutlineList';

/** The page's headings, and how long it is (on narrower screens; wide ones show them in the details panel). */
export function OutlineButton({
  headings,
  onJump,
  words,
  minutes,
}: {
  headings: Heading[];
  onJump: (line: number) => void;
  words: number;
  minutes: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton label="Outline" icon={<ListTree />} size="sm" active={open} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <OutlineList
          headings={headings}
          onJump={(line) => {
            setOpen(false);
            onJump(line);
          }}
        />
        <p className="mt-2 border-t border-line px-2 pt-2 text-xs text-fg-3 tabular-nums">
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {minutes} min read
        </p>
      </PopoverContent>
    </Popover>
  );
}
