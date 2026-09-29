import { useMemo, type ReactNode } from 'react';
import { jumpTo } from '../editor/jumps';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { useSettled } from '../lib/useSettled';
import { OutlineList } from '../markdown/OutlineList';
import { headingsOf, statsOf } from '../markdown/outline';
import { formatDateTime } from '../lib/time';
import { useDocSnapshot, usePageDoc } from '../sync/hooks';
import { useCurrent } from './location';

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

/** Page details on wide screens: information and the outline; links and history as they arrive. */
export function Inspector() {
  const { page, path } = useCurrent();
  const doc = usePageDoc(page?.type === 'markdown' ? page.id : null);
  // As stored on this device: follows typing within a moment.
  // Counted once typing pauses: long pages take a moment.
  const text = useSettled(useDocSnapshot(doc)?.record?.content, 400);
  const stats = useMemo(() => (text === undefined ? null : statsOf(text)), [text]);
  const headings = useMemo(() => (text === undefined ? [] : headingsOf(text)), [text]);
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
            {stats && page.type === 'markdown' && (
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
        {page?.type === 'markdown' ? (
          <div className="-mx-2">
            <OutlineList headings={headings} onJump={(line) => jumpTo(page.id, line)} />
          </div>
        ) : (
          <Later>Headings of Markdown pages appear here.</Later>
        )}
      </Block>
      <Block title="Backlinks">
        <Later>Pages and cards that link here arrive in Phase 8.</Later>
      </Block>
      <Block title="Version history">
        <Later>Versions to compare and restore arrive in Phase 7.</Later>
      </Block>
    </aside>
  );
}
