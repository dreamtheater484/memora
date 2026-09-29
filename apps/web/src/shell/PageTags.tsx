import { MAX_PAGE_TAGS, MAX_TAG_NAME, tagKey, type PageMeta, type Tag } from '@memora/shared';
import { useNavigate } from '@tanstack/react-router';
import { Tag as TagIcon } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { Chip } from '../components/ui';
import { cn } from '../lib/cn';
import { fuzzyFilter } from '../lib/fuzzy';
import { useFocusOnMount } from '../lib/useFocusOnMount';
import { useNotes, useNotesActions } from '../notes/queries';

/*
 * A page's tags (§9.9): chips under the title. A chip opens the tag's pages; typing offers the
 * tags there are, and a new name makes a new tag. Enter or a comma adds, Backspace in an empty
 * field takes the last one off.
 */

function TagInput({
  tags,
  taken,
  onAdd,
  onRemoveLast,
  onDone,
}: {
  tags: Tag[];
  taken: string[];
  onAdd: (name: string) => void;
  onRemoveLast: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  useFocusOnMount(ref);
  const takenKeys = new Set(taken.map(tagKey));
  const free = tags.filter((t) => !takenKeys.has(tagKey(t.name)));
  const typed = text.trim();
  const suggestions = useMemo(
    () => (typed ? fuzzyFilter(free, typed, (t) => t.name) : free).slice(0, 8),
    [free, typed],
  );
  const exact = suggestions.some((t) => tagKey(t.name) === tagKey(typed));
  const options = [
    ...suggestions.map((t) => ({ name: t.name, tag: t as Tag | null })),
    ...(typed && !exact && !takenKeys.has(tagKey(typed)) ? [{ name: typed, tag: null }] : []),
  ];
  const add = (name: string) => {
    const clean = name.replace(/[",]/g, '').trim().slice(0, MAX_TAG_NAME);
    if (clean && !takenKeys.has(tagKey(clean))) onAdd(clean);
    setText('');
    setActive(0);
  };
  return (
    <span className="relative inline-flex">
      <input
        ref={ref}
        role="combobox"
        aria-label="Add a tag"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        placeholder="Tag name"
        value={text}
        maxLength={MAX_TAG_NAME}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onBlur={() => {
          if (typed) add(typed);
          onDone();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && options.length) {
            e.preventDefault();
            setActive((a) => (a + 1) % options.length);
          } else if (e.key === 'ArrowUp' && options.length) {
            e.preventDefault();
            setActive((a) => (a - 1 + options.length) % options.length);
          } else if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const option = options[active];
            if (option && (typed || e.key === 'Enter')) add(option.name);
            else if (!typed) onDone();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setText('');
            onDone();
          } else if (e.key === 'Backspace' && !text) onRemoveLast();
        }}
        className="h-[1.375rem] w-32 rounded-full border border-accent bg-surface px-2 text-xs text-fg outline-none placeholder:text-fg-3"
      />
      {options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Tags"
          className="glass-raised absolute top-full left-0 z-30 mt-1 flex max-h-60 w-52 flex-col overflow-y-auto rounded-md p-1 text-sm"
        >
          {options.map((option, i) => (
            <li
              key={option.tag?.id ?? `new-${option.name}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps the field's focus: a blur would close the list first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(option.name)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1',
                i === active ? 'bg-active text-fg' : 'text-fg-2',
              )}
            >
              {option.tag ? (
                <Chip color={option.tag.color ?? undefined}>{option.tag.name}</Chip>
              ) : (
                <span>
                  Create <b className="font-semibold text-fg">“{option.name}”</b>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function PageTags({ page }: { page: PageMeta }) {
  const index = useNotes();
  const actions = useNotesActions();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const tags = (page.tags ?? []).map((id) => index.tag.get(id)).filter((t) => !!t);
  const names = tags.map((t) => t.name);
  const set = (next: string[]) => void actions.setPageTags(page.id, next);
  return (
    <>
      {tags.map((tag) => (
        <Chip
          key={tag.id}
          color={tag.color ?? undefined}
          removeLabel={`Remove tag ${tag.name}`}
          onRemove={() => set(names.filter((n) => n !== tag.name))}
        >
          <button
            type="button"
            title={`Pages tagged ${tag.name}`}
            onClick={() => void navigate({ to: '/search', search: { tag: tag.id } })}
            className="rounded-xs hover:underline"
          >
            {tag.name}
          </button>
        </Chip>
      ))}
      {adding ? (
        <TagInput
          tags={index.tags}
          taken={names}
          onAdd={(name) => set([...names, name])}
          onRemoveLast={() => names.length && set(names.slice(0, -1))}
          onDone={() => setAdding(false)}
        />
      ) : (
        names.length < MAX_PAGE_TAGS && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-[1.375rem] items-center gap-1 rounded-full border border-dashed border-line-strong px-2 font-medium text-fg-2 hover:bg-hover [&_svg]:size-3.5"
          >
            <TagIcon aria-hidden /> {names.length ? 'Tag' : 'Add tag'}
          </button>
        )
      )}
    </>
  );
}
