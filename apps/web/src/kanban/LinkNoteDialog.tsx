import { markedParts, type PageMeta } from '@memora/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FilePlus, FileText } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Button, DialogContent, Input, Select, toast } from '../components/ui';
import { errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { useRecent } from '../notes/places';
import { useNotes, useNotesActions, useUiState } from '../notes/queries';
import { searchQuery } from '../search/api';
import { useShell } from '../shell/store';
import { cardActions, cardQuery } from './api';

/*
 * Linking notes to a card (§9.11): recently opened and edited notes first, each with where it
 * is; typing searches all notes (150 ms after the last key). ↑/↓ move, Enter links, Space
 * picks several; "Create new note" makes one in a chosen section and links it.
 */

const close = () => useShell.getState().closeDialog();
const DEBOUNCE_MS = 150;

interface Option {
  id: string;
  title: string;
  path: string;
}

export function LinkNoteDialog({ cardId, boardId }: { cardId: string; boardId: string }) {
  const queryClient = useQueryClient();
  const index = useNotes();
  const recent = useRecent();
  const ui = useUiState();
  const actions = useNotesActions();
  const linked = new Set((useQuery(cardQuery(cardId)).data?.pages ?? []).map((p) => p.pageId));
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [sectionId, setSectionId] = useState(ui.lastSectionId ?? index.inbox.id);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const searched = useQuery({ ...searchQuery({ q: query, limit: 20 }), enabled: !!query }).data;

  const pathOf = (page: PageMeta) => {
    const path = index.pathOf(page.sectionId);
    if (!path) return '';
    return [
      path.notebook?.name ?? 'Inbox',
      ...path.groups.map((g) => g.name),
      path.section.isInbox ? null : path.section.name,
    ]
      .filter(Boolean)
      .join(' › ');
  };

  const options: Option[] = useMemo(() => {
    if (query) {
      return (searched?.hits ?? []).map((h) => ({
        id: h.id,
        title: markedParts(h.title)
          .map((p) => p.text)
          .join(''),
        path: index.page.get(h.id) ? pathOf(index.page.get(h.id)!) : '',
      }));
    }
    // Recently opened first, then recently edited.
    const seen = new Set<string>();
    const pages: PageMeta[] = [];
    for (const r of recent) {
      const page = r.type === 'page' ? index.page.get(r.id) : undefined;
      if (page && !seen.has(page.id)) {
        seen.add(page.id);
        pages.push(page);
      }
    }
    for (const page of [...index.tree.pages].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (pages.length >= 30) break;
      if (!seen.has(page.id)) {
        seen.add(page.id);
        pages.push(page);
      }
    }
    return pages.map((p) => ({ id: p.id, title: p.title || 'Untitled page', path: pathOf(p) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searched, recent, index]);

  const createIndex = options.length;
  const count = options.length + (text.trim() ? 1 : 0);

  const link = async (ids: string[]) => {
    const actionsOf = cardActions(queryClient, { id: cardId, boardId });
    close();
    try {
      for (const id of ids) if (!linked.has(id)) await actionsOf.linkPage(id);
      toast({
        title: ids.length === 1 ? 'Note linked' : `${ids.length} notes linked`,
        tone: 'success',
      });
    } catch {
      // Told by cardActions.
    }
  };

  const create = async () => {
    const title = text.trim();
    if (!title) return;
    try {
      const changes = await actions.createPage({ sectionId, title });
      const page = changes?.pages?.[0];
      if (page) await link([page.id]);
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'error' });
    }
  };

  const choose = (i: number) => {
    if (i === createIndex) return void create();
    const option = options[i];
    if (!option) return;
    void link(picked.length ? [...new Set([...picked, option.id])] : [option.id]);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (picked.length && !(e.ctrlKey || e.metaKey) && active >= createIndex)
        return void link(picked);
      choose(active);
    } else if (e.key === ' ' && (e.ctrlKey || !text)) {
      // Space picks (Ctrl+Space while typing a search).
      const option = options[active];
      if (!option) return;
      e.preventDefault();
      setPicked((p) =>
        p.includes(option.id) ? p.filter((x) => x !== option.id) : [...p, option.id],
      );
    }
  };

  const sections = [...index.tree.sections]
    .filter((s) => s.isInbox || (s.notebookId && index.notebook.has(s.notebookId)))
    .map((s) => ({
      value: s.id,
      label: s.isInbox ? 'Inbox' : `${index.notebook.get(s.notebookId!)?.name ?? ''} › ${s.name}`,
    }));

  return (
    <DialogContent
      title="Link notes"
      description="↑ ↓ to choose, Enter to link, Space to pick several."
      footer={
        <>
          <span className="mr-auto text-xs text-fg-3">
            {picked.length ? `${picked.length} picked` : ''}
          </span>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!picked.length} onClick={() => void link(picked)}>
            Link {picked.length || ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" onKeyDown={onKeyDown}>
        <Input
          aria-label="Find a note"
          placeholder="Search notes"
          autoFocus
          value={text}
          role="combobox"
          aria-expanded
          aria-controls="link-note-options"
          aria-activedescendant={count ? `link-note-${active}` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
        />
        <ul
          id="link-note-options"
          role="listbox"
          aria-label="Notes"
          aria-multiselectable
          className="flex max-h-80 flex-col overflow-y-auto"
        >
          {!query && options.length > 0 && (
            <li
              role="presentation"
              className="px-2 pt-1 pb-0.5 text-2xs font-semibold tracking-wider text-fg-3 uppercase"
            >
              Recent
            </li>
          )}
          {options.map((o, i) => {
            const isPicked = picked.includes(o.id);
            return (
              <li
                key={o.id}
                id={`link-note-${i}`}
                role="option"
                aria-selected={i === active}
                aria-checked={isPicked}
                onMouseEnter={() => setActive(i)}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey)
                    setPicked((p) =>
                      p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id],
                    );
                  else choose(i);
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                  i === active && 'bg-accent-soft',
                )}
              >
                {isPicked ? (
                  <Check aria-hidden className="size-4 shrink-0" />
                ) : (
                  <FileText aria-hidden className="size-4 shrink-0 text-fg-3" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{o.title}</span>
                  <span className="block truncate text-xs text-fg-3">{o.path}</span>
                </span>
                {linked.has(o.id) && <span className="text-2xs text-fg-3">Linked</span>}
              </li>
            );
          })}
          {query && options.length === 0 && (
            <li className="px-2 py-2 text-sm text-fg-3">No notes match.</li>
          )}
          {text.trim() && (
            <li
              id={`link-note-${createIndex}`}
              role="option"
              aria-selected={active === createIndex}
              onMouseEnter={() => setActive(createIndex)}
              onClick={() => void create()}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                active === createIndex && 'bg-accent-soft',
              )}
            >
              <FilePlus aria-hidden className="size-4 shrink-0 text-fg-3" />
              Create new note “{text.trim()}”
            </li>
          )}
        </ul>
        {text.trim() && (
          <label className="flex items-center gap-2 text-xs text-fg-3">
            New notes go in
            <Select
              aria-label="Section for new notes"
              value={sectionId}
              onValueChange={setSectionId}
              options={sections}
            />
          </label>
        )}
      </div>
    </DialogContent>
  );
}
