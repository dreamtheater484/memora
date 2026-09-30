import {
  COLOR_IDS,
  MODIFIED_WITHIN,
  type ColorId,
  type ModifiedWithin,
  type PageType,
  type SearchHit,
  type SearchQuery,
  type Tag,
} from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  Clock,
  Ellipsis,
  FileText,
  Palette,
  Pencil,
  Search,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Select,
  Skeleton,
} from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { errorMessage, isUnreachable } from '../lib/api';
import { cn } from '../lib/cn';
import { fuzzyFilter } from '../lib/fuzzy';
import { formatRelative } from '../lib/time';
import { useSettled } from '../lib/useSettled';
import type { NotesIndex } from '../notes/model';
import { useRecent } from '../notes/places';
import { useNotes, useNotesActions } from '../notes/queries';
import { useGo } from '../shell/location';
import { hueStyle, sectionColor } from '../theme/sections';
import { searchQuery, type SearchParams } from './api';
import { Marked } from './Marked';

/*
 * Search (§9.8): results as you type, with the matches marked, filters, and the search syntax;
 * with nothing typed, recent pages and the tag browser. Without a connection, titles on this
 * device are searched instead.
 */

const ANY = 'any';

const MODIFIED_LABEL: Record<ModifiedWithin, string> = {
  day: 'Past day',
  week: 'Past week',
  month: 'Past month',
  year: 'Past year',
};

function placeOf(index: NotesIndex, sectionId: string): string {
  const path = index.pathOf(sectionId);
  if (!path) return '';
  return [path.notebook?.name, ...path.groups.map((g) => g.name), path.section.name]
    .filter(Boolean)
    .join(' › ');
}

function TagChip({ tag, onClick }: { tag: Tag; onClick?: () => void }) {
  const chip = <Chip color={tag.color ?? undefined}>{tag.name}</Chip>;
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-full">
      {chip}
    </button>
  ) : (
    chip
  );
}

function Hit({ hit, index, onOpen }: { hit: SearchHit; index: NotesIndex; onOpen: () => void }) {
  const section = index.section.get(hit.sectionId);
  return (
    <li>
      <button
        type="button"
        data-hit
        onClick={onOpen}
        className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
      >
        <span className="flex items-center gap-2 text-base font-semibold text-fg">
          <FileText aria-hidden className="size-4 shrink-0 text-fg-3" />
          <span className="min-w-0 truncate">
            {hit.title ? <Marked text={hit.title} /> : 'Untitled page'}
          </span>
        </span>
        {hit.snippet && (
          <span className="line-clamp-2 text-sm text-fg-2">
            <Marked text={hit.snippet} />
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
          {section && (
            <span className="hue inline-flex items-center gap-1.5" style={hueStyle(section.color)}>
              <span aria-hidden className="size-2 rounded-full bg-sec" />
              {placeOf(index, hit.sectionId)}
            </span>
          )}
          <span>Edited {formatRelative(hit.updatedAt)}</span>
          {hit.tags.map((id) => {
            const tag = index.tag.get(id);
            return tag ? <TagChip key={id} tag={tag} /> : null;
          })}
        </span>
      </button>
    </li>
  );
}

function RenameTag({ tag, onDone }: { tag: Tag; onDone: () => void }) {
  const actions = useNotesActions();
  const [name, setName] = useState(tag.name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && name.trim() !== tag.name) void actions.updateTag(tag.id, { name });
    onDone();
  };
  return (
    <DialogContent
      size="sm"
      title="Rename tag"
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" type="submit" form="rename-tag">
            Rename
          </Button>
        </>
      }
    >
      <form id="rename-tag" onSubmit={submit}>
        <Field label="Name">
          {({ id }) => (
            <Input
              id={id}
              value={name}
              maxLength={40}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}

/** The tag browser: every tag with how many pages have it; pick one to list them. */
function TagBrowser({ index, onPick }: { index: NotesIndex; onPick: (id: string) => void }) {
  const actions = useNotesActions();
  const [renaming, setRenaming] = useState<Tag | null>(null);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const page of index.tree.pages) {
      for (const id of page.tags ?? []) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [index]);
  if (!index.tags.length) {
    return (
      <p className="text-sm text-fg-3">
        No tags yet. Add tags to a page under its title, then find its pages here.
      </p>
    );
  }
  return (
    <>
      <ul aria-label="Tags" className="flex flex-wrap gap-2">
        {index.tags.map((tag) => (
          <li
            key={tag.id}
            className="flex items-center gap-0.5 rounded-full border border-line py-0.5 pr-0.5 pl-1"
          >
            <button
              type="button"
              onClick={() => onPick(tag.id)}
              className="flex items-center gap-1.5 rounded-full"
            >
              <Chip color={tag.color ?? undefined}>{tag.name}</Chip>
              <span className="text-xs text-fg-3 tabular-nums">{counts.get(tag.id) ?? 0}</span>
            </button>
            <Menu>
              <MenuTrigger asChild>
                <IconButton label={`Tag “${tag.name}” options`} icon={<Ellipsis />} size="xs" />
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<Pencil />} onSelect={() => setRenaming(tag)}>
                  Rename…
                </MenuItem>
                <MenuSub>
                  <MenuSubTrigger icon={<Palette />}>Colour</MenuSubTrigger>
                  <MenuSubContent>
                    <MenuRadioGroup
                      value={tag.color ?? 'none'}
                      onValueChange={(v) =>
                        void actions.updateTag(tag.id, {
                          color: v === 'none' ? null : (v as ColorId),
                        })
                      }
                    >
                      <MenuRadioItem value="none">No colour</MenuRadioItem>
                      {COLOR_IDS.map((c) => (
                        <MenuRadioItem key={c} value={c}>
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="hue size-3 rounded-full bg-sec"
                              style={hueStyle(c)}
                            />
                            {sectionColor(c).name}
                          </span>
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuSubContent>
                </MenuSub>
                <MenuItem icon={<Trash2 />} danger onSelect={() => void actions.deleteTag(tag.id)}>
                  Delete tag
                </MenuItem>
              </MenuContent>
            </Menu>
          </li>
        ))}
      </ul>
      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        {renaming && <RenameTag tag={renaming} onDone={() => setRenaming(null)} />}
      </Dialog>
    </>
  );
}

/** Moves focus between results with the arrow keys. */
function moveFocus(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const hits = [...(root?.querySelectorAll<HTMLElement>('[data-hit]') ?? [])];
  if (!hits.length) return;
  e.preventDefault();
  const at = hits.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'ArrowDown' ? Math.min(at + 1, hits.length - 1) : at - 1;
  if (next < 0) root?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  else hits[next]!.focus();
}

export default function SearchView() {
  const index = useNotes();
  const go = useGo();
  const navigate = useNavigate();
  const recent = useRecent();
  const params = useSearch({ strict: false }) as SearchParams;
  const [text, setText] = useState(params.q ?? '');
  const q = useSettled(text, 150);
  const rootRef = useRef<HTMLDivElement>(null);
  const filters = {
    tag: params.tag,
    notebook: params.notebook,
    type: params.type,
    modified: params.modified,
    cards: params.cards,
  };
  const setFilters = (next: Partial<SearchParams>) =>
    void navigate({
      to: '/search',
      search: (prev: SearchParams) => ({ ...prev, ...next }),
      replace: true,
    });

  // The address follows the words typed, so back, forward and links work.
  useEffect(() => {
    if ((params.q ?? '') === q) return;
    void navigate({
      to: '/search',
      search: (prev: SearchParams) => ({ ...prev, q: q || undefined }),
      replace: true,
    });
  }, [q, params.q, navigate]);

  const query: SearchQuery = {
    q: q.trim(),
    tagId: filters.tag,
    notebookId: filters.notebook,
    type: filters.type,
    modified: filters.modified,
    cards: filters.cards === '0' ? undefined : '1',
  };
  const active = !!(query.q || query.tagId || query.notebookId || query.type || query.modified);
  const results = useQuery({ ...searchQuery(query), enabled: active });
  const offline = results.isError && isUnreachable(results.error);
  const words = q.trim();
  const local = useMemo(
    () =>
      offline && words ? fuzzyFilter(index.tree.pages, words, (p) => p.title).slice(0, 50) : [],
    [offline, words, index],
  );

  const tag = filters.tag ? index.tag.get(filters.tag) : undefined;
  const recentPages = recent
    .filter((r) => r.type === 'page')
    .map((r) => index.page.get(r.id))
    .filter((p) => !!p)
    .slice(0, 10);

  return (
    <section
      ref={rootRef}
      aria-labelledby="search-title"
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => moveFocus(e, rootRef.current)}
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-line px-4 pt-4 pb-3 @tablet:px-7 @tablet:pt-5.5">
        <h1 id="search-title" className="sr-only">
          Search
        </h1>
        <Input
          type="search"
          pill
          icon={<Search />}
          aria-label="Search"
          placeholder="Search your notes"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              rootRef.current?.querySelector<HTMLElement>('[data-hit]')?.click();
          }}
          trailing={
            text ? (
              <IconButton label="Clear" icon={<X />} size="xs" onClick={() => setText('')} />
            ) : undefined
          }
          wrapperClassName="h-10 text-base"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Notebook"
            value={filters.notebook ?? ANY}
            onValueChange={(v) => setFilters({ notebook: v === ANY ? undefined : v })}
            options={[
              { value: ANY, label: 'All notebooks' },
              ...index.notebooks.map((n) => ({ value: n.id, label: n.name })),
            ]}
          />
          <Select
            aria-label="Tag"
            value={filters.tag ?? ANY}
            onValueChange={(v) => setFilters({ tag: v === ANY ? undefined : v })}
            options={[
              { value: ANY, label: 'Any tag' },
              ...index.tags.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <Select
            aria-label="Type"
            value={filters.type ?? ANY}
            onValueChange={(v) => setFilters({ type: v === ANY ? undefined : (v as PageType) })}
            options={[
              { value: ANY, label: 'Any type' },
              { value: 'markdown', label: 'Markdown' },
              { value: 'rich', label: 'Rich text' },
            ]}
          />
          <Select
            aria-label="Edited"
            value={filters.modified ?? ANY}
            onValueChange={(v) =>
              setFilters({ modified: v === ANY ? undefined : (v as ModifiedWithin) })
            }
            options={[
              { value: ANY, label: 'Any time' },
              ...MODIFIED_WITHIN.map((m) => ({ value: m, label: MODIFIED_LABEL[m] })),
            ]}
          />
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <Checkbox
              checked={filters.cards !== '0'}
              onCheckedChange={(v) => setFilters({ cards: v === true ? undefined : '0' })}
            />
            Include cards
          </label>
          {tag && (
            <Chip
              color={tag.color ?? undefined}
              removeLabel={`Stop filtering by ${tag.name}`}
              onRemove={() => setFilters({ tag: undefined })}
            >
              <TagIcon aria-hidden className="mr-1 inline size-3" />
              {tag.name}
            </Chip>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 @tablet:px-4">
        {!active ? (
          <div className="flex flex-col gap-6 px-2">
            <section aria-labelledby="recent-title">
              <h2 id="recent-title" className={cn(sectionHeading, 'mb-2')}>
                Recent
              </h2>
              {recentPages.length ? (
                <ul className="flex flex-col gap-px">
                  {recentPages.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        data-hit
                        onClick={() => go.page(p.id)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                      >
                        <Clock aria-hidden className="size-4 shrink-0 text-fg-3" />
                        <span className="min-w-0 truncate font-medium">
                          {p.title || 'Untitled page'}
                        </span>
                        <span className="ml-auto shrink-0 truncate text-xs text-fg-3">
                          {placeOf(index, p.sectionId)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-3">Pages you open appear here.</p>
              )}
            </section>
            <section aria-labelledby="tags-title">
              <h2 id="tags-title" className={cn(sectionHeading, 'mb-2')}>
                Tags
              </h2>
              <TagBrowser index={index} onPick={(id) => setFilters({ tag: id })} />
            </section>
            <section aria-labelledby="syntax-title" className="text-sm text-fg-2">
              <h2 id="syntax-title" className={cn(sectionHeading, 'mb-2')}>
                Search tips
              </h2>
              <ul className="flex flex-col gap-1">
                <li>
                  <code>"exact phrase"</code> finds the words together
                </li>
                <li>
                  <code>-word</code> leaves out pages with a word
                </li>
                <li>
                  <code>tag:work</code> finds pages with a tag
                </li>
                <li>
                  <code>in:"Section name"</code> searches one section or notebook
                </li>
              </ul>
            </section>
          </div>
        ) : offline ? (
          <div className="flex flex-col gap-2">
            <p role="status" className="px-3 text-sm text-fg-2">
              No connection: searching page titles on this device.
            </p>
            <ul aria-label="Results" className="flex flex-col gap-px">
              {local.map((p) => (
                <Hit
                  key={p.id}
                  index={index}
                  onOpen={() => go.page(p.id)}
                  hit={{
                    id: p.id,
                    title: p.title,
                    snippet: p.snippet,
                    sectionId: p.sectionId,
                    type: p.type,
                    tags: p.tags ?? [],
                    updatedAt: p.updatedAt,
                  }}
                />
              ))}
            </ul>
          </div>
        ) : results.isError ? (
          <p className="px-3 text-sm text-danger">{errorMessage(results.error)}</p>
        ) : !results.data ? (
          <div className="flex flex-col gap-3 px-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !results.data.hits.length && !results.data.cards?.length ? (
          <EmptyState
            icon={<Search />}
            title="Nothing found"
            description="Try other words, fewer filters, or a word’s beginning."
          />
        ) : (
          <>
            <p role="status" className="px-3 pb-2 text-xs text-fg-3">
              {results.data.total >= 1000 ? 'Over 1,000' : results.data.total}{' '}
              {results.data.total === 1 ? 'page' : 'pages'}
              {results.data.cards?.length
                ? `, ${results.data.cards.length} ${results.data.cards.length === 1 ? 'card' : 'cards'}`
                : ''}
            </p>
            <ul aria-label="Results" className="flex flex-col gap-px">
              {results.data.hits.map((hit) => (
                <Hit key={hit.id} hit={hit} index={index} onOpen={() => go.page(hit.id)} />
              ))}
            </ul>
            {!!results.data.cards?.length && (
              <section aria-labelledby="cards-title" className="mt-5">
                <h2 id="cards-title" className={cn(sectionHeading, 'mb-2 px-3')}>
                  Cards
                </h2>
                <ul aria-label="Cards" className="flex flex-col gap-px">
                  {results.data.cards.map((card) => (
                    <li key={card.id}>
                      <button
                        type="button"
                        data-hit
                        onClick={() =>
                          void navigate({
                            to: '/b/$boardId',
                            params: { boardId: card.boardId },
                            search: { card: card.id },
                          })
                        }
                        className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-hover focus-visible:bg-hover"
                      >
                        <span className="text-sm font-semibold">
                          <span className="font-mono text-xs text-fg-3">{card.key}</span>{' '}
                          <Marked text={card.title} />
                        </span>
                        {card.snippet && (
                          <span className="line-clamp-2 text-xs text-fg-2">
                            <Marked text={card.snippet} />
                          </span>
                        )}
                        <span className="text-2xs text-fg-3">
                          {card.boardName} · {card.columnName}
                          {card.completedAt ? ' · done' : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}
