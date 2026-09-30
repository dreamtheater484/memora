import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { pageCardsQuery } from '../kanban/api';
import { useMemo, type ReactNode } from 'react';
import { versionsQuery } from '../history/api';
import { backlinksQuery } from '../search/api';
import { REASON } from '../history/labels';
import { jumpTo } from '../editor/jumps';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { useSettled } from '../lib/useSettled';
import { OutlineList } from '../markdown/OutlineList';
import { headingsOf, statsOf } from '../markdown/outline';
import { richOutline } from '../rich/outline';
import { formatDateTime, formatRelative } from '../lib/time';
import { useDocSnapshot, usePageDoc } from '../sync/hooks';
import { useCurrent, useGo } from './location';
import { useShell } from './store';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line pb-3.5 last:border-b-0">
      <h2 className={cn(sectionHeading, 'mb-2')}>{title}</h2>
      {children}
    </section>
  );
}

const Later = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-fg-3">{children}</p>
);

/** Pages that link here (§9.9). */
function Backlinks({ pageId }: { pageId: string }) {
  const { index } = useCurrent();
  const go = useGo();
  const links = useQuery(backlinksQuery(pageId));
  if (links.isError) return <Later>Backlinks need a connection to the server.</Later>;
  if (!links.data) return <Later>Loading…</Later>;
  const pages = links.data.pages.map((id) => index.page.get(id)).filter((p) => !!p);
  if (!pages.length) return <Later>No pages link here yet. Link one with [[…]].</Later>;
  return (
    <ul aria-label="Linked from" className="-mx-2 flex flex-col gap-px">
      {pages.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => go.page(p.id)}
            className="flex w-full flex-col items-start rounded-sm px-2 py-1 text-left text-xs hover:bg-hover"
          >
            <span className="w-full truncate font-medium text-fg">
              {p.title || 'Untitled page'}
            </span>
            {p.snippet && <span className="w-full truncate text-fg-3">{p.snippet}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Kanban cards this note is linked to, with where they are (§9.11). */
function LinkedCards({ pageId }: { pageId: string }) {
  const navigate = useNavigate();
  const cards = useQuery({ ...pageCardsQuery(pageId), retry: false });
  const add = () => useShell.getState().openDialog({ kind: 'add-to-board', pageId });
  return (
    <div className="flex flex-col gap-1">
      {cards.isError ? (
        <Later>Linked cards need a connection to the server.</Later>
      ) : !cards.data ? (
        <Later>Loading…</Later>
      ) : cards.data.length === 0 ? (
        <Later>No cards yet.</Later>
      ) : (
        <ul aria-label="Linked cards" className="-mx-2 flex flex-col gap-px">
          {cards.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    to: '/b/$boardId',
                    params: { boardId: c.boardId },
                    search: { card: c.id },
                  })
                }
                className="flex w-full flex-col items-start rounded-sm px-2 py-1 text-left text-xs hover:bg-hover"
              >
                <span className="w-full truncate font-medium text-fg">
                  <span className="font-mono text-fg-3">{c.key}</span> {c.title}
                </span>
                <span className="w-full truncate text-fg-3">
                  {c.boardName} ·{' '}
                  {c.archivedAt
                    ? 'Archived'
                    : c.completedAt
                      ? `${c.columnName} (done)`
                      : c.columnName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={add}
        className="self-start rounded-sm text-xs font-medium text-accent hover:underline"
      >
        Add to board…
      </button>
    </div>
  );
}

/** The latest few versions; the history dialog has them all. */
function RecentVersions({ pageId }: { pageId: string }) {
  const versions = useQuery({ ...versionsQuery(pageId), retry: false });
  const open = (versionId?: string) =>
    useShell.getState().openDialog({ kind: 'history', pageId, versionId });
  if (versions.isError) return <Later>The history needs a connection to the server.</Later>;
  if (!versions.data) return <Later>Loading…</Later>;
  if (!versions.data.length) return <Later>No versions yet: they’re kept as you edit.</Later>;
  return (
    <div className="flex flex-col gap-1">
      <ul className="-mx-2 flex flex-col gap-px">
        {versions.data.slice(0, 4).map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => open(v.id)}
              title={formatDateTime(v.createdAt)}
              className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left text-xs text-fg-2 hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-fg">
                {v.name ?? REASON[v.reason]}
              </span>
              <span className="shrink-0">{formatRelative(v.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => open()}
        className="self-start rounded-sm text-xs font-medium text-accent hover:underline"
      >
        {versions.data.length > 4 ? `All ${versions.data.length} versions` : 'Open the history'}
      </button>
    </div>
  );
}

/** Page details on wide screens: information, the outline, backlinks and the history. */
export function Inspector() {
  const { page, path } = useCurrent();
  const doc = usePageDoc(page?.id ?? null);
  // As stored on this device: follows typing within a moment.
  // Counted once typing pauses: long pages take a moment.
  const record = useDocSnapshot(doc)?.record;
  const text = useSettled(record?.content, 400);
  const rich = record?.type === 'rich';
  const outline = useMemo(() => {
    if (text === undefined) return null;
    return rich ? richOutline(text) : { headings: headingsOf(text), stats: statsOf(text) };
  }, [text, rich]);
  const stats = outline?.stats ?? null;
  const headings = outline?.headings ?? [];
  return (
    <aside
      aria-label="Page details"
      className="flex h-full min-h-0 flex-col gap-3.5 overflow-auto px-4 pt-4 pb-7"
    >
      {page ? (
        <Block title="Info">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-xs">
            <dt className="text-fg-3">Location</dt>
            <dd className="min-w-0 break-words">
              {[
                path?.notebook?.name,
                ...(path?.groups.map((g) => g.name) ?? []),
                path?.section.name,
              ]
                .filter(Boolean)
                .join(' › ')}
            </dd>
            <dt className="text-fg-3">Created</dt>
            <dd>{formatDateTime(page.createdAt)}</dd>
            <dt className="text-fg-3">Edited</dt>
            <dd>{formatDateTime(page.updatedAt)}</dd>
            <dt className="text-fg-3">Type</dt>
            <dd>{page.type === 'markdown' ? 'Markdown' : 'Rich text'}</dd>
            {stats && (
              <>
                <dt className="text-fg-3">Words</dt>
                <dd className="tabular-nums">
                  {stats.words.toLocaleString()} · {stats.minutes} min read
                </dd>
              </>
            )}
          </dl>
        </Block>
      ) : (
        <Later>Open a page to see its details.</Later>
      )}
      <Block title="Outline">
        {page ? (
          <div className="-mx-2">
            <OutlineList headings={headings} onJump={(line) => jumpTo(page.id, line)} />
          </div>
        ) : (
          <Later>The page’s headings appear here.</Later>
        )}
      </Block>
      <Block title="Backlinks">
        {page ? <Backlinks pageId={page.id} /> : <Later>Pages that link here appear here.</Later>}
      </Block>
      <Block title="Linked cards">
        {page ? (
          <LinkedCards pageId={page.id} />
        ) : (
          <Later>Kanban cards linked to the page appear here.</Later>
        )}
      </Block>
      <Block title="Version history">
        {page ? (
          <RecentVersions pageId={page.id} />
        ) : (
          <Later>Versions to compare and restore appear here.</Later>
        )}
      </Block>
    </aside>
  );
}
