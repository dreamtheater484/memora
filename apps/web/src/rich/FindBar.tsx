import type { Editor } from '@tiptap/core';
import { CaseSensitive, ChevronDown, ChevronUp, Replace, X } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Button, IconButton, Input } from '../components/ui';
import { useFocusOnMount } from '../lib/useFocusOnMount';
import { findNext, findState, replaceAll, replaceCurrent, setFind } from './find';

/* The find and replace bar of a rich page (Ctrl/Cmd+F). */
export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, ' ');
    return selected.length < 100 && !selected.includes('\n') ? selected : '';
  });
  const [replacement, setReplacement] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<HTMLInputElement>(null);
  useFocusOnMount(ref);

  useEffect(() => {
    editor.on('transaction', rerender);
    return () => {
      editor.off('transaction', rerender);
    };
  }, [editor]);
  useEffect(() => {
    if (!editor.isDestroyed) setFind(editor, { query, caseSensitive, current: 0 });
  }, [editor, query, caseSensitive]);
  // Closing clears the marks.
  useEffect(
    () => () => {
      if (!editor.isDestroyed) setFind(editor, { query: '' });
    },
    [editor],
  );

  const { matches, current } = findState(editor);
  const close = () => {
    onClose();
    editor.commands.focus();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  return (
    <div
      role="search"
      aria-label="Find in page"
      onKeyDown={keys}
      className="glass-raised flex flex-col gap-1.5 rounded-lg p-1.5 shadow-lg"
    >
      <div className="flex items-center gap-1">
        <Input
          ref={ref}
          aria-label="Find"
          placeholder="Find"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              findNext(editor, e.shiftKey ? -1 : 1);
            }
          }}
          wrapperClassName="h-7 w-52"
          trailing={
            <span className="text-xs whitespace-nowrap text-fg-3 tabular-nums" aria-live="polite">
              {query ? (matches.length ? `${current + 1} of ${matches.length}` : 'No matches') : ''}
            </span>
          }
        />
        <IconButton
          label="Match case"
          icon={<CaseSensitive />}
          size="sm"
          active={caseSensitive}
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive(!caseSensitive)}
        />
        <IconButton
          label="Previous match"
          icon={<ChevronUp />}
          size="sm"
          disabled={!matches.length}
          onClick={() => findNext(editor, -1)}
        />
        <IconButton
          label="Next match"
          icon={<ChevronDown />}
          size="sm"
          disabled={!matches.length}
          onClick={() => findNext(editor, 1)}
        />
        <IconButton
          label="Replace"
          icon={<Replace />}
          size="sm"
          active={replacing}
          aria-expanded={replacing}
          onClick={() => setReplacing(!replacing)}
        />
        <IconButton label="Close" icon={<X />} size="sm" onClick={close} />
      </div>
      {replacing && (
        <div className="flex items-center gap-1">
          <Input
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceCurrent(editor, replacement);
              }
            }}
            wrapperClassName="h-7 w-52"
          />
          <Button
            size="sm"
            disabled={!matches.length}
            onClick={() => replaceCurrent(editor, replacement)}
          >
            Replace
          </Button>
          <Button
            size="sm"
            disabled={!matches.length}
            onClick={() => replaceAll(editor, replacement)}
          >
            Replace all
          </Button>
        </div>
      )}
    </div>
  );
}
