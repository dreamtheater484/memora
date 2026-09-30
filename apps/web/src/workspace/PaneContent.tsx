import { markedParts } from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, FileText, Search } from 'lucide-react';
import { Suspense, lazy, useEffect, useState } from 'react';
import { EmptyState, IconButton, Input } from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { versionsQuery } from '../history/api';
import { REASON } from '../history/labels';
import { cn } from '../lib/cn';
import { formatDateTime, formatRelative } from '../lib/time';
import { searchQuery } from '../search/api';
import { Backlinks } from '../shell/Inspector';
import { useCurrent, useGo } from '../shell/location';
import { PageBody, PageSaveIndicator } from '../shell/PageEditor';
import { useShell } from '../shell/store';
import { usePageDoc } from '../sync/hooks';
import { hueStyle } from '../theme/sections';
import type { PaneTab } from './model';

/*
 * What a pane's tab shows (§9.12): a page, a board, search results, the backlinks or the
 * history of a page (by default the one in the main pane).
 */

const BoardView = lazy(() => import('../kanban/BoardView'));

const DEBOUNCE_MS = 150;

export function PaneContent({
  tab,
  onTarget,
}: {
  tab: PaneTab;
  /** Changes what the tab shows (the search typed). */
  onTarget: (target: string | null) => void;
}) {
  const { page } = useCurrent();
  switch (tab.kind) {
    case 'page':
      return tab.target ? <PagePane pageId={tab.target} /> : null;
    case 'board':
      return tab.target ? (
        <Suspense fallback={null}>
          <BoardView key={tab.target} boardId={tab.target} embedded />
        </Suspense>
      ) : null;
    case 'search':
      return <SearchPane query={tab.target ?? ''} onQuery={(q) => onTarget(q || null)} />;
    case 'backlinks':
    case 'history': {
      const pageId = tab.target ?? page?.id ?? null;
      return (
        <div className="flex h-full min-h-0 flex-col overflow-auto px-4 pt-3 pb-7">
          {!pageId ? (
            <p className="text-sm text-fg-3">
              Open a page in the main pane to see its{' '}
              {tab.kind === 'history' ? 'history' : 'backlinks'} here.
            </p>
          ) : tab.kind === 'history' ? (
            <HistoryList pageId={pageId} />
          ) : (
            <Backlinks pageId={pageId} />
          )}
        </div>
      );
    }
  }
}

/** A page in a pane: its place, save state and editor. */
function PagePane({ pageId }: { pageId: string }) {
  const { index } = useCurrent();
  const go = useGo();
  const page = index.page.get(pageId);
  const section = page ? index.section.get(page.sectionId) : undefined;
  const doc = usePageDoc(page?.id ?? null);
  if (!page) {
    return (
      <EmptyState
        icon={<FileText />}
        title="This page isn’t here any more"
        description="It may have been deleted. Close the tab, or open another page."
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-2 px-5 pt-4 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[1.6rem] leading-tight font-semibold tracking-tight">
            {page.title || 'Untitled page'}
          </h2>
          <p className="flex items-center gap-2 text-sm text-fg-3">
            {section && (
              <span
                className="hue inline-flex items-center gap-1.5"
                style={hueStyle(section.color)}
              >
                <span aria-hidden className="size-2 rounded-full bg-sec" />
                {section.name}
              </span>
            )}
            <span>· edited {formatRelative(page.updatedAt)}</span>
          </p>
        </div>
        <PageSaveIndicator page={page} doc={doc} compact />
        <IconButton
          label="Open in the main pane"
          icon={<ArrowLeftRight />}
          onClick={() => go.page(page.id)}
        />
      </div>
      <div className="min-h-0 flex-1">
        <PageBody key={page.id} page={page} doc={doc} compact />
      </div>
    </div>
  );
}

/** Search in a pane: pages and cards, opened in the main pane. */
function SearchPane({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const go = useGo();
  const { index } = useCurrent();
  const [text, setText] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text.trim() !== query) onQuery(text.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, query, onQuery]);
  const results = useQuery({
    ...searchQuery({ q: query, limit: 30, cards: '1' }),
    enabled: !!query,
  });
  const marked = (text: string) =>
    markedParts(text).map((p, i) =>
      p.match ? (
        <mark key={i} className="rounded-sm bg-accent-soft text-fg">
          {p.text}
        </mark>
      ) : (
        p.text
      ),
    );
  const hits = query ? (results.data?.hits ?? []) : [];
  const cards = query ? (results.data?.cards ?? []) : [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-3 pb-2">
        <Input
          pill
          icon={<Search />}
          aria-label="Search in this pane"
          placeholder="Search notes and cards"
          value={text}
          autoFocus={!query}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-6">
        {query && results.isError && (
          <p className="px-2 text-sm text-fg-3">Search needs a connection to the server.</p>
        )}
        {query && results.data && !hits.length && !cards.length && (
          <p className="px-2 text-sm text-fg-3">Nothing matches “{query}”.</p>
        )}
        {hits.length > 0 && (
          <ul aria-label="Pages found" className="flex flex-col gap-px">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => go.page(hit.id)}
                  className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <span className="w-full truncate text-sm font-medium">{marked(hit.title)}</span>
                  <span className="w-full truncate text-xs text-fg-3">
                    {index.section.get(hit.sectionId)?.name}
                    {hit.snippet ? ' · ' : ''}
                    {marked(hit.snippet)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {cards.length > 0 && (
          <>
            <h3 className={cn(sectionHeading, 'mt-3 mb-1 px-2')}>Cards</h3>
            <ul aria-label="Cards found" className="flex flex-col gap-px">
              {cards.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    onClick={() => go.board(card.boardId)}
                    className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                  >
                    <span className="font-mono text-2xs text-fg-3">{card.key}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{marked(card.title)}</span>
                    <span className="shrink-0 text-xs text-fg-3">{card.columnName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/** Every version of a page; one opens in the history dialog. */
function HistoryList({ pageId }: { pageId: string }) {
  const versions = useQuery({ ...versionsQuery(pageId), retry: false });
  const open = (versionId?: string) =>
    useShell.getState().openDialog({ kind: 'history', pageId, versionId });
  if (versions.isError) {
    return <p className="text-sm text-fg-3">The history needs a connection to the server.</p>;
  }
  if (!versions.data) return <p className="text-sm text-fg-3">Loading…</p>;
  if (!versions.data.length) {
    return <p className="text-sm text-fg-3">No versions yet: they’re kept as you edit.</p>;
  }
  return (
    <ul aria-label="Versions" className="-mx-2 flex flex-col gap-px">
      {versions.data.map((v) => (
        <li key={v.id}>
          <button
            type="button"
            onClick={() => open(v.id)}
            title={formatDateTime(v.createdAt)}
            className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg-2 hover:bg-hover"
          >
            <span className="min-w-0 flex-1 truncate font-medium text-fg">
              {v.name ?? REASON[v.reason]}
            </span>
            <span className="shrink-0 text-xs">{formatRelative(v.createdAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
