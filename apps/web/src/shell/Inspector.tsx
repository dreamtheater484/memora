import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/time';
import { pageQuery } from '../notes/queries';
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

/** Page details on wide screens: information now; outline, links and history as they arrive. */
export function Inspector() {
  const { page, path } = useCurrent();
  const { data } = useQuery({ ...pageQuery(page?.id ?? ''), enabled: !!page });
  const words = data?.content.trim() ? data.content.trim().split(/\s+/).length : 0;
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
            {data && page.type === 'markdown' && (
              <>
                <dt className="text-fg-3">Words</dt>
                <dd className="tabular-nums">{words}</dd>
              </>
            )}
          </dl>
        </Block>
      ) : (
        <Later>Open a page to see its details.</Later>
      )}
      <Block title="Outline">
        <Later>The page’s headings appear here with the editors (Phase 5).</Later>
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
