import type { PageMeta } from '@memora/shared';
import { MonitorSmartphone, TriangleAlert } from 'lucide-react';
import { Suspense, lazy, useMemo, useState, type CSSProperties } from 'react';
import { Button, Dialog, SaveIndicator, Skeleton } from '../components/ui';
import { cn } from '../lib/cn';
import { useEditorSettings, useUiState } from '../notes/queries';
import type { PageDoc } from '../sync/doc';
import { useDocSnapshot, usePageSaveState } from '../sync/hooks';
import { useSync } from '../sync/status';

/*
 * The page itself (§9.6): the editor, and what the sync engine has to say about the page:
 * its save state, a conflict to settle, and other devices that have it open.
 */

const MarkdownPage = lazy(() => import('../editor/MarkdownPage'));
// Only when a conflict is compared, with the diff library it needs.
const CompareDialog = lazy(() => import('./CompareDialog'));
const RichPage = lazy(() => import('../rich/RichPage'));

const loading = (
  <div className="flex max-w-[47.5rem] flex-col gap-2.5 px-4 pt-4 @tablet:px-7" aria-busy="true">
    <Skeleton className="h-4 w-11/12" />
    <Skeleton className="h-4 w-9/12" />
    <Skeleton className="h-4 w-10/12" />
  </div>
);

/** The page's content: the Markdown editor and preview, or the rich text editor. */
export function PageBody({
  page,
  doc,
  compact,
}: {
  page: PageMeta;
  doc: PageDoc | null;
  compact?: boolean;
}) {
  const snapshot = useDocSnapshot(doc);
  const { lineLength } = useEditorSettings();
  const fullWidth = !!useUiState().fullWidth?.includes(page.id);
  const pad = 'px-4 pt-3 @tablet:px-7 @wide:px-9';
  if (!doc || !snapshot || snapshot.state === 'loading') return loading;
  if (snapshot.state !== 'ready') {
    const message = {
      unavailable:
        'This page isn’t on this device yet, so it can’t open without a connection. It opens once you’re back online.',
      missing:
        'This page isn’t on the server any more. It may have been deleted on another device.',
      error: 'This page couldn’t be loaded. Try again in a moment.',
    }[snapshot.state];
    return <p className={cn(pad, 'text-sm text-fg-2')}>{message}</p>;
  }
  // Text stops at a readable width (§9.12), in characters of the font it is set in.
  const measure = { '--measure': fullWidth ? 'none' : `${lineLength}ch` } as CSSProperties;
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={measure}
      data-full-width={fullWidth || undefined}
    >
      {snapshot.record?.conflict && (
        <div className={cn(pad, 'pb-0')}>
          <ConflictBanner doc={doc} />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Suspense fallback={loading}>
          {/* The record's type changes with its content (a conversion), before the tree's. */}
          {(snapshot.record?.type ?? page.type) === 'rich' ? (
            <RichPage key="rich" page={page} doc={doc} compact={compact} />
          ) : (
            <MarkdownPage key="markdown" page={page} doc={doc} compact={compact} />
          )}
        </Suspense>
      </div>
    </div>
  );
}

/** Whether the page is saved, for its header or pane. */
export function PageSaveIndicator({
  page,
  doc,
  compact = 'auto',
}: {
  page: PageMeta;
  doc: PageDoc | null;
  compact?: boolean | 'auto';
}) {
  const state = usePageSaveState(page.id, doc);
  const savedAt = useSync((s) => s.savedAt[page.id]) ?? page.updatedAt;
  const refused = useSync((s) => s.refused[page.id]);
  if (!state) return null;
  return (
    <SaveIndicator
      state={state}
      savedAt={savedAt}
      compact={compact}
      quiet
      detail={
        refused
          ? 'The server didn’t accept this page as it is. Edit it to try again.'
          : 'This browser can’t store changes, so they only reach the server while this tab stays open.'
      }
    />
  );
}

/** "Also open on: Phone": other devices of the user that have the page open. */
export function PresenceHint({ pageId }: { pageId: string }) {
  const devices = useSync((s) => s.devices);
  const labels = useMemo(
    () => [...new Set(devices.filter((d) => d.pages.includes(pageId)).map((d) => d.label))],
    [devices, pageId],
  );
  if (!labels.length) return null;
  return (
    <span className="inline-flex items-center gap-1 text-fg-2 [&_svg]:size-3.5">
      <MonitorSmartphone aria-hidden />
      Also open on: {labels.join(', ')}
    </span>
  );
}

function ConflictBanner({ doc }: { doc: PageDoc }) {
  const [comparing, setComparing] = useState(false);
  const record = useDocSnapshot(doc)?.record;
  // Converted on another device meanwhile: only the server's version fits the page now.
  const converted = !!record?.conflict?.type;
  if (converted) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-md border border-warn/45 bg-warn/10 px-3.5 py-3 text-sm"
      >
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn" />
        <p className="min-w-[14rem] flex-1 text-fg">
          <b className="font-semibold">Converted on another device.</b> Your latest changes were
          made to the old version; they are kept in the page’s history.
        </p>
        <Button size="sm" variant="primary" onClick={() => void doc.keepTheirs()}>
          Show the converted page
        </Button>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-md border border-warn/45 bg-warn/10 px-3.5 py-3 text-sm"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn" />
      <p className="min-w-[14rem] flex-1 text-fg">
        <b className="font-semibold">Changed on another device as well.</b> The changes overlap
        yours, so they couldn’t be combined. Both versions are kept.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void doc.keepMine()}>
          Keep mine
        </Button>
        <Button size="sm" onClick={() => void doc.keepTheirs()}>
          Keep theirs
        </Button>
        <Button size="sm" variant="primary" onClick={() => setComparing(true)}>
          Compare
        </Button>
      </div>
      <Dialog open={comparing} onOpenChange={setComparing}>
        {comparing && (
          <Suspense fallback={null}>
            <CompareDialog doc={doc} onDone={() => setComparing(false)} />
          </Suspense>
        )}
      </Dialog>
    </div>
  );
}
