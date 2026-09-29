import type { RestoreToRequest, TrashEntry, TrashItem, TrashType } from '@memora/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark,
  Ellipsis,
  FileText,
  Folder,
  FolderInput,
  Notebook,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  EmptyState,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SegmentedControl,
  Skeleton,
  toast,
} from '../components/ui';
import { errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { fuzzyFilter } from '../lib/fuzzy';
import { formatDateTime, formatRelative } from '../lib/time';
import { useNotes } from '../notes/queries';
import { DestinationPicker } from '../shell/DestinationPicker';
import { destinations, type Destination } from '../shell/destinations';
import { useGo } from '../shell/location';
import { deleteForever, emptyTrash, restoreItems, restoreTo, trashQuery } from './api';

/*
 * The recycle bin (§9.7): what was deleted and where it was, for a while. Items go back where
 * they were, or somewhere else when that place is gone too, or are deleted for good.
 */

const ICON: Record<TrashType, ReactNode> = {
  notebook: <Notebook />,
  group: <Folder />,
  section: <Bookmark />,
  page: <FileText />,
};

const KIND: Record<TrashType, string> = {
  notebook: 'Notebook',
  group: 'Section group',
  section: 'Section',
  page: 'Page',
};

type Filter = 'all' | TrashType;

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'page', label: 'Pages' },
  { value: 'section', label: 'Sections' },
  { value: 'group', label: 'Groups' },
  { value: 'notebook', label: 'Notebooks' },
] as const;

const keyOf = (item: TrashItem) => `${item.type}:${item.id}`;
const itemOf = ({ type, id }: TrashEntry): TrashItem => ({ type, id });
const nameOf = (entry: TrashEntry) => entry.name || (entry.type === 'page' ? 'Untitled page' : '');

function daysLeft(entry: TrashEntry, now = Date.now()) {
  const days = Math.max(0, Math.ceil((entry.purgeAt - now) / 86_400_000));
  return days === 0 ? 'Deleted for good today' : `Deleted for good in ${days} days`;
}

type Confirm = { kind: 'delete'; entries: TrashEntry[] } | { kind: 'empty' };

function ConfirmDialog({
  confirm,
  count,
  onDone,
}: {
  confirm: Confirm;
  count: number;
  onDone: (removed: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const what =
    confirm.kind === 'empty'
      ? `all ${count} ${count === 1 ? 'item' : 'items'}`
      : confirm.entries.length === 1
        ? `“${nameOf(confirm.entries[0]!)}”`
        : `${confirm.entries.length} items`;
  const run = async () => {
    setBusy(true);
    try {
      if (confirm.kind === 'empty') await emptyTrash(queryClient);
      else await deleteForever(queryClient, confirm.entries.map(itemOf));
      toast({ title: 'Deleted for good', tone: 'success' });
      onDone(true);
    } catch (error) {
      toast({ title: 'Couldn’t delete', description: errorMessage(error), tone: 'error' });
      setBusy(false);
    }
  };
  return (
    <DialogContent
      size="sm"
      title={confirm.kind === 'empty' ? 'Empty the recycle bin?' : 'Delete for good?'}
      description={`This deletes ${what} for good, with the pages, versions and files that went with ${confirm.kind === 'delete' && confirm.entries.length === 1 ? 'it' : 'them'}. It can’t be undone.`}
      footer={
        <>
          <Button onClick={() => onDone(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void run()} disabled={busy}>
            {confirm.kind === 'empty' ? 'Empty the recycle bin' : 'Delete for good'}
          </Button>
        </>
      }
    >
      {null}
    </DialogContent>
  );
}

function RestoreToDialog({ entry, onDone }: { entry: TrashEntry; onDone: () => void }) {
  const index = useNotes();
  const queryClient = useQueryClient();
  const go = useGo();
  const all = useMemo(
    () =>
      entry.type === 'notebook'
        ? []
        : destinations(index, entry.type === 'page' ? 'pages' : entry.type),
    [index, entry.type],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = all.find((d) => d.id === picked) ?? null;

  const restore = async (d: Destination | null = target) => {
    if (!d) return;
    const to: RestoreToRequest['to'] =
      entry.type === 'page'
        ? { sectionId: d.id }
        : { notebookId: d.notebookId!, groupId: d.kind === 'group' ? d.id : null };
    setBusy(true);
    try {
      await restoreTo(queryClient, { item: itemOf(entry), to });
      onDone();
      toast({
        title: `Restored “${nameOf(entry)}” to ${d.label}`,
        tone: 'success',
        action: { label: 'Open', onClick: () => open(go, entry) },
      });
    } catch (error) {
      toast({ title: 'Couldn’t restore', description: errorMessage(error), tone: 'error' });
      setBusy(false);
    }
  };

  return (
    <DialogContent
      title={`Restore “${nameOf(entry)}” to…`}
      description={
        entry.type === 'page'
          ? 'Its section is gone. Pick a section for it (and its subpages).'
          : 'Where it was is gone. Pick a notebook or section group.'
      }
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" onClick={() => void restore()} disabled={!target || busy}>
            Restore here
          </Button>
        </>
      }
    >
      <DestinationPicker
        all={all}
        picked={picked}
        onPick={setPicked}
        onChoose={() => void restore()}
        placeholder={entry.type === 'page' ? 'Search sections' : 'Search notebooks and groups'}
      />
    </DialogContent>
  );
}

function open(go: ReturnType<typeof useGo>, entry: TrashEntry) {
  if (entry.type === 'page') go.page(entry.id);
  else if (entry.type === 'section') go.section(entry.id);
  else if (entry.type === 'group') go.group(entry.id);
  else go.notebook(entry.id);
}

export default function TrashView() {
  const queryClient = useQueryClient();
  const go = useGo();
  const trash = useQuery(trashQuery);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [moving, setMoving] = useState<TrashEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const entries = useMemo(() => trash.data?.entries ?? [], [trash.data]);
  const shown = useMemo(() => {
    const kind = filter === 'all' ? entries : entries.filter((e) => e.type === filter);
    return query.trim()
      ? fuzzyFilter(kind, query, (e) => `${nameOf(e)} ${e.location.join(' ')}`)
      : kind;
  }, [entries, filter, query]);
  const picked = shown.filter((e) => selected.has(keyOf(e)));
  const toggle = (entry: TrashEntry, on: boolean) =>
    setSelected((all) => {
      const next = new Set(all);
      if (on) next.add(keyOf(entry));
      else next.delete(keyOf(entry));
      return next;
    });

  const restore = async (list: TrashEntry[]) => {
    const ready = list.filter((e) => e.restorable);
    if (!ready.length) return;
    setBusy(true);
    try {
      await restoreItems(queryClient, ready.map(itemOf));
      setSelected(new Set());
      const first = ready[0]!;
      toast({
        title:
          ready.length === 1 ? `Restored “${nameOf(first)}”` : `Restored ${ready.length} items`,
        description:
          ready.length < list.length
            ? 'Items whose place is gone stay here: restore them to somewhere else.'
            : undefined,
        tone: 'success',
        ...(ready.length === 1
          ? { action: { label: 'Open', onClick: () => open(go, first) } }
          : {}),
      });
    } catch (error) {
      toast({ title: 'Couldn’t restore', description: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const days = trash.data?.days ?? 30;

  return (
    <section aria-labelledby="trash-title" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b border-line px-4 pt-4 pb-3 @tablet:px-7 @tablet:pt-5.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1
              id="trash-title"
              className="font-display text-[1.4375rem] leading-tight font-semibold tracking-[-0.03em] @tablet:text-[2.125rem]"
            >
              Recycle bin
            </h1>
            <p className="mt-1 text-sm text-fg-2">
              Deleted items stay here for {days} days, then they’re deleted for good.
            </p>
          </div>
          <Button
            variant="danger"
            disabled={!entries.length}
            onClick={() => setConfirm({ kind: 'empty' })}
          >
            <Trash2 /> Empty recycle bin
          </Button>
        </div>
        {entries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              pill
              icon={<Search />}
              aria-label="Search the recycle bin"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              wrapperClassName="w-full @tablet:w-64"
            />
            <SegmentedControl
              label="Show"
              value={filter}
              onValueChange={setFilter}
              segments={FILTERS}
            />
          </div>
        )}
        {picked.length > 0 && (
          <div
            role="toolbar"
            aria-label="Selected items"
            className="flex flex-wrap items-center gap-2 rounded-md bg-hover px-3 py-2 text-sm"
          >
            <span className="mr-auto font-semibold">{picked.length} selected</span>
            <Button
              size="sm"
              disabled={busy || !picked.some((e) => e.restorable)}
              onClick={() => void restore(picked)}
            >
              <RotateCcw /> Restore
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirm({ kind: 'delete', entries: picked })}
            >
              <Trash2 /> Delete for good
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 @tablet:px-4">
        {trash.isError ? (
          <div className="flex flex-col items-start gap-3 p-4 text-sm">
            <p className="text-fg-2">
              The recycle bin couldn’t be loaded: {errorMessage(trash.error)} It needs a connection
              to the server.
            </p>
            <Button size="sm" onClick={() => void trash.refetch()}>
              Try again
            </Button>
          </div>
        ) : trash.isPending ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !entries.length ? (
          <EmptyState
            icon={<Trash2 />}
            title="The recycle bin is empty"
            description={`Deleted pages, sections and notebooks stay here for ${days} days, so you can bring them back.`}
          />
        ) : !shown.length ? (
          <p className="px-2 py-10 text-center text-sm text-fg-3">Nothing matches.</p>
        ) : (
          <ul aria-label="Deleted items" className="flex flex-col gap-px">
            {shown.map((entry) => {
              const key = keyOf(entry);
              const on = selected.has(key);
              return (
                <li
                  key={key}
                  className={cn(
                    'group flex items-center gap-3 rounded-md px-2.5 py-2',
                    on ? 'bg-active' : 'hover:bg-hover',
                  )}
                >
                  <Checkbox
                    aria-label={`Select “${nameOf(entry)}”`}
                    checked={on}
                    onCheckedChange={(v) => toggle(entry, v === true)}
                  />
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-sm bg-hover text-fg-2 [&_svg]:size-4"
                  >
                    {ICON[entry.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">
                      <span className="sr-only">{KIND[entry.type]}: </span>
                      {nameOf(entry)}
                      {entry.location.length > 0 && (
                        <span className="font-normal text-fg-3">
                          {' '}
                          in {entry.location.join(' › ')}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-fg-3">
                      <span title={formatDateTime(entry.deletedAt)}>
                        Deleted {formatRelative(entry.deletedAt)}
                      </span>
                      {entry.type !== 'page' &&
                        ` · ${entry.pages} ${entry.pages === 1 ? 'page' : 'pages'}`}
                      {' · '}
                      <span title={formatDateTime(entry.purgeAt)}>{daysLeft(entry)}</span>
                    </p>
                  </div>
                  {entry.restorable ? (
                    <Button size="sm" disabled={busy} onClick={() => void restore([entry])}>
                      <RotateCcw /> <span className="hidden @tablet:inline">Restore</span>
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setMoving(entry)}>
                      <FolderInput /> <span className="hidden @tablet:inline">Restore to…</span>
                    </Button>
                  )}
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton
                        label={`More for “${nameOf(entry)}”`}
                        icon={<Ellipsis />}
                        size="sm"
                      />
                    </MenuTrigger>
                    <MenuContent align="end">
                      {entry.type !== 'notebook' && (
                        <MenuItem icon={<FolderInput />} onSelect={() => setMoving(entry)}>
                          Restore to…
                        </MenuItem>
                      )}
                      <MenuItem
                        icon={<Trash2 />}
                        danger
                        onSelect={() => setConfirm({ kind: 'delete', entries: [entry] })}
                      >
                        Delete for good
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        {confirm && (
          <ConfirmDialog
            confirm={confirm}
            count={entries.length}
            onDone={(removed) => {
              setConfirm(null);
              if (removed) setSelected(new Set());
            }}
          />
        )}
      </Dialog>
      <Dialog open={!!moving} onOpenChange={(v) => !v && setMoving(null)}>
        {moving && <RestoreToDialog entry={moving} onDone={() => setMoving(null)} />}
      </Dialog>
    </section>
  );
}
