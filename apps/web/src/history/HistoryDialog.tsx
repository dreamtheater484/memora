import { MAX_VERSION_NAME, type PageVersionMeta } from '@memora/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CopyPlus, History, PenLine, RotateCcw, Save } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import {
  Button,
  DialogContent,
  Field,
  Input,
  SegmentedControl,
  Skeleton,
  toast,
} from '../components/ui';
import { errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/time';
import { useNotes } from '../notes/queries';
import { useGo } from '../shell/location';
import { useShell } from '../shell/store';
import { useDocSnapshot, usePageDoc } from '../sync/hooks';
import {
  copyVersion,
  nameVersion,
  restoreVersion,
  saveVersion,
  versionQuery,
  versionsQuery,
} from './api';
import { comparableText, textDiff } from './diff';
import { REASON, formatTime } from './labels';
import { DiffView, VersionView } from './VersionView';

/*
 * A page's history (§9.7): the versions the server keeps, newest first and grouped by day.
 * Each can be read, compared with the one before it or with the page now, named, restored
 * (the page as it was is kept first, so a restore can be undone) or restored as a copy.
 */

const close = () => useShell.getState().closeDialog();

const day = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function dayLabel(ms: number, now = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return 'Today';
  if (ms >= start.getTime() - 86_400_000) return 'Yesterday';
  return day.format(ms);
}

function byDay(versions: PageVersionMeta[]) {
  const groups: { label: string; versions: PageVersionMeta[] }[] = [];
  for (const version of versions) {
    const label = dayLabel(version.createdAt);
    const last = groups.at(-1);
    if (last?.label === label) last.versions.push(version);
    else groups.push({ label, versions: [version] });
  }
  return groups;
}

type View = 'preview' | 'changes' | 'now';

const VIEWS = [
  { value: 'changes', label: 'Changes' },
  { value: 'preview', label: 'Version' },
  { value: 'now', label: 'Compare with now' },
] as const;

function NameForm({ version, onDone }: { version: PageVersionMeta; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(version.name ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await nameVersion(queryClient, version.pageId, version.id, name.trim() || null);
      onDone();
    } catch (error) {
      toast({
        title: 'Couldn’t name the version',
        description: errorMessage(error),
        tone: 'error',
      });
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Version name"
        placeholder="For example: Before the rewrite"
        value={name}
        maxLength={MAX_VERSION_NAME}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onDone())}
        wrapperClassName="min-w-48 flex-1"
      />
      <Button size="sm" variant="primary" type="submit">
        Save name
      </Button>
      <Button size="sm" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

function Detail({
  version,
  previous,
  onBack,
}: {
  version: PageVersionMeta;
  previous: PageVersionMeta | null;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const go = useGo();
  const doc = usePageDoc(version.pageId);
  const now = useDocSnapshot(doc)?.record;
  const [view, setView] = useState<View>('changes');
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const full = useQuery(versionQuery(version.pageId, version.id));
  const before = useQuery({
    ...versionQuery(version.pageId, previous?.id ?? ''),
    enabled: view === 'changes' && !!previous,
  });

  const diff = useMemo(() => {
    const content = full.data;
    if (!content) return null;
    const text = comparableText(content.type, content.content);
    if (view === 'changes') {
      if (previous && !before.data) return null;
      const older = before.data ? comparableText(before.data.type, before.data.content) : '';
      return textDiff(older, text);
    }
    if (view === 'now') {
      if (!now) return null;
      return textDiff(text, comparableText(now.type, now.content));
    }
    return null;
  }, [full.data, before.data, previous, view, now]);

  const restore = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      await restoreVersion(queryClient, doc, version.id);
      close();
      toast({
        title: 'Version restored',
        description: 'The page as it was is kept in its history.',
        tone: 'success',
      });
    } catch (error) {
      toast({
        title: 'Couldn’t restore the version',
        description: errorMessage(error),
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    setBusy(true);
    try {
      const id = await copyVersion(version.pageId, version.id);
      close();
      if (id) go.page(id);
      toast({ title: 'Restored as a new page', tone: 'success' });
    } catch (error) {
      toast({
        title: 'Couldn’t copy the version',
        description: errorMessage(error),
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 self-start text-sm text-fg-2 hover:text-fg tablet:hidden [&_svg]:size-4"
        >
          <ArrowLeft aria-hidden /> All versions
        </button>
        {naming ? (
          <NameForm version={version} onDone={() => setNaming(false)} />
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-display text-lg font-semibold">
              {version.name ?? REASON[version.reason]}
            </h3>
            <span className="text-sm text-fg-2">
              {formatDateTime(version.createdAt)}
              {version.deviceLabel && ` · on ${version.deviceLabel}`}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !doc}
            onClick={() => void restore()}
          >
            <RotateCcw /> Restore
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void copy()}>
            <CopyPlus /> Restore as copy
          </Button>
          {!naming && (
            <Button size="sm" onClick={() => setNaming(true)}>
              <PenLine /> {version.name ? 'Rename' : 'Name'}
            </Button>
          )}
        </div>
      </div>
      <SegmentedControl
        label="Show"
        value={view}
        onValueChange={setView}
        segments={VIEWS}
        className="self-start"
      />
      <div className="min-h-0 flex-1">
        {full.isError ? (
          <p className="text-sm text-danger">{errorMessage(full.error)}</p>
        ) : !full.data ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : view === 'preview' ? (
          <VersionView type={full.data.type} content={full.data.content} />
        ) : diff ? (
          <DiffView
            diff={diff}
            none={
              view === 'now'
                ? 'The page now is the same as this version.'
                : 'Nothing changed in the text.'
            }
          />
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </div>
      {view === 'changes' && !previous && full.data && (
        <p className="text-xs text-fg-3">The oldest version kept: all of it is shown as added.</p>
      )}
    </div>
  );
}

export default function HistoryDialog({
  pageId,
  versionId,
}: {
  pageId: string;
  versionId?: string;
}) {
  const index = useNotes();
  const page = index.page.get(pageId);
  const versions = useQuery(versionsQuery(pageId));
  const [picked, setPicked] = useState<string | null>(versionId ?? null);
  // Phones show the list or one version.
  const [reading, setReading] = useState(!!versionId);
  const list = useMemo(() => versions.data ?? [], [versions.data]);
  const at = Math.max(
    0,
    list.findIndex((v) => v.id === picked),
  );
  const selected = list[at] ?? null;
  const groups = useMemo(() => byDay(list), [list]);

  return (
    <DialogContent
      size="xl"
      title="Version history"
      description={page ? `“${page.title || 'Untitled page'}”` : undefined}
      className="h-[85dvh] tablet:h-[76dvh]"
      footer={
        <>
          <p className="mr-auto text-xs text-fg-3">
            Older versions are thinned out over time; named ones are always kept.
          </p>
          <Button onClick={() => useShell.getState().openDialog({ kind: 'save-version', pageId })}>
            <Save /> Save version…
          </Button>
        </>
      }
    >
      {versions.isError ? (
        <div className="flex flex-col items-start gap-3 text-sm">
          <p className="text-fg-2">
            The history couldn’t be loaded: {errorMessage(versions.error)} It needs a connection to
            the server.
          </p>
          <Button size="sm" onClick={() => void versions.refetch()}>
            Try again
          </Button>
        </div>
      ) : versions.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : !list.length ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-fg-2">
          <History aria-hidden className="size-8 text-fg-3" />
          <p>No versions yet.</p>
          <p className="max-w-sm text-fg-3">
            Versions are kept as you edit, each time you close an edited page, and whenever you save
            one by hand.
          </p>
        </div>
      ) : (
        <div className="grid h-full min-h-0 gap-5 tablet:grid-cols-[15rem_1fr]">
          <nav
            aria-label="Versions"
            className={cn(
              'min-h-0 overflow-y-auto tablet:-ml-2 tablet:border-r tablet:border-line tablet:pr-3',
              reading && 'hidden tablet:block',
            )}
          >
            {groups.map((group) => (
              <section key={group.label} className="mb-3">
                <h3 className="px-2 pb-1 text-2xs font-semibold tracking-wider text-fg-3 uppercase">
                  {group.label}
                </h3>
                <ul className="flex flex-col gap-px">
                  {group.versions.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        aria-current={v.id === selected?.id ? 'true' : undefined}
                        onClick={() => {
                          setPicked(v.id);
                          setReading(true);
                        }}
                        className={cn(
                          'flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm',
                          v.id === selected?.id
                            ? 'bg-active text-fg shadow-card'
                            : 'text-fg-2 hover:bg-hover',
                        )}
                      >
                        <span className="flex w-full items-baseline gap-2">
                          <span className="tabular-nums">{formatTime(v.createdAt)}</span>
                          <span className="min-w-0 truncate font-semibold text-fg">
                            {v.name ?? REASON[v.reason]}
                          </span>
                        </span>
                        <span className="text-xs text-fg-3">
                          {v.name ? REASON[v.reason] : null}
                          {v.name && v.deviceLabel ? ' · ' : null}
                          {v.deviceLabel ? `on ${v.deviceLabel}` : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
          <div
            className={cn('min-h-0 overflow-y-auto', !reading && 'hidden tablet:block')}
            aria-live="polite"
          >
            {selected && (
              <Detail
                key={selected.id}
                version={selected}
                previous={list[at + 1] ?? null}
                onBack={() => setReading(false)}
              />
            )}
          </div>
        </div>
      )}
    </DialogContent>
  );
}

/** "Save version…": keeps the page as it is now, with a name if given. */
export function SaveVersionDialog({ pageId }: { pageId: string }) {
  const queryClient = useQueryClient();
  const doc = usePageDoc(pageId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!doc) return;
    setBusy(true);
    setError(null);
    try {
      const { version } = await saveVersion(queryClient, doc, name);
      close();
      toast({
        title: version ? 'Version saved' : 'Already kept',
        description: version
          ? 'Find it in the page’s history.'
          : 'The page hasn’t changed since the last version.',
        tone: 'success',
      });
    } catch (e) {
      setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent
      title="Save version"
      description="Keeps the page as it is now in its history. A named version is never thinned out."
      size="sm"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="save-version-form" disabled={busy || !doc}>
            {busy ? 'Saving…' : 'Save version'}
          </Button>
        </>
      }
    >
      <form id="save-version-form" onSubmit={(e) => void submit(e)}>
        <Field label="Name (optional)" error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              maxLength={MAX_VERSION_NAME}
              autoFocus
              placeholder="For example: Sent to the team"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}
