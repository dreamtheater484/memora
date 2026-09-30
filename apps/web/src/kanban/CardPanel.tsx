import {
  COLOR_IDS,
  PRIORITIES,
  uuidv7,
  type ActivityType,
  type AssetMeta,
  type BoardData,
  type CardActivity,
  type CardDetail,
  type Checklist,
  type Priority,
} from '@memora/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  CheckSquare,
  Copy,
  Ellipsis,
  FileText,
  FolderInput,
  Link2,
  Paperclip,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Button,
  Checkbox,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Skeleton,
  toast,
} from '../components/ui';
import { api, errorMessage, uploadFile } from '../lib/api';
import { formatBytes } from '../lib/bytes';
import { cn } from '../lib/cn';
import { formatDateTime, formatRelative } from '../lib/time';
import { Preview } from '../markdown/Preview';
import { useNotes } from '../notes/queries';
import { useShell } from '../shell/store';
import { hueStyle, sectionColor } from '../theme/sections';
import { cardActions, cardQuery, deleteCard, duplicateCard, moveCard, updateCard } from './api';
import { PRIORITY_NAMES } from './model';

/*
 * A card's details (§9.11): title and Markdown description, column, labels, priority and
 * dates, checklists, linked notes, files, comments and the activity log. Changes save as they
 * are made. `N` links a note (the picker has the latest notes first, so linking one is two or
 * three keystrokes).
 */

const section = 'flex flex-col gap-2 border-t border-line px-5 py-4';
const heading =
  'flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-2 uppercase [&_svg]:size-3.5';

export default function CardPanel({
  cardId,
  board,
  focus,
  onClose,
}: {
  cardId: string;
  board: BoardData;
  /** What to focus first: `title`, `labels` or `due`. */
  focus?: string;
  onClose: () => void;
}) {
  const { data: detail, error } = useQuery(cardQuery(cardId));
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest(
        'input, textarea, [contenteditable="true"], [role="menu"], [role="dialog"] [role="dialog"]',
      )
    )
      return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      useShell.getState().openDialog({ kind: 'link-note', cardId, boardId: board.board.id });
    }
  };

  if (error) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm text-fg-2">{errorMessage(error)}</p>
        <Button onClick={onClose}>Close</Button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex flex-col gap-3 p-5" aria-busy="true">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  return (
    <div
      ref={ref}
      role="region"
      aria-label={`${detail.key}: ${detail.card.title}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
    >
      <Header detail={detail} board={board} onClose={onClose} focusTitle={focus === 'title'} />
      <Properties detail={detail} board={board} focus={focus} />
      <Description detail={detail} />
      <Checklists detail={detail} />
      <LinkedNotes detail={detail} boardId={board.board.id} />
      <Files detail={detail} />
      <Comments detail={detail} />
      <Activity activity={detail.activity} />
    </div>
  );
}

function Header({
  detail,
  board,
  onClose,
  focusTitle,
}: {
  detail: CardDetail;
  board: BoardData;
  onClose: () => void;
  focusTitle: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const card = detail.card;
  // A draft while typing; otherwise the card's title as it is (another device may change it).
  const [draft, setDraft] = useState<string | null>(null);
  const title = draft ?? card.title;
  const setTitle = (value: string) => setDraft(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusTitle) ref.current?.focus();
    else ref.current?.closest<HTMLElement>('[role="region"]')?.focus();
  }, [focusTitle]);
  const saveTitle = () => {
    const text = title.trim();
    setDraft(null);
    if (text && text !== card.title)
      void updateCard(queryClient, card, { title: text }).catch(() => undefined);
  };
  const copyLink = () => {
    const url = `${location.origin}/b/${card.boardId}?card=${card.id}`;
    void navigator.clipboard.writeText(url).then(
      () => toast({ title: 'Link copied', tone: 'success' }),
      () => toast({ title: 'Couldn’t copy the link', description: url, tone: 'error' }),
    );
  };
  return (
    <div className="flex items-start gap-2 px-5 pt-4 pb-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-mono text-xs text-fg-3">{detail.key}</span>
        <textarea
          ref={ref}
          aria-label="Card title"
          value={title}
          rows={Math.min(4, Math.max(1, Math.ceil(title.length / 34)))}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(card.title);
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="-mx-1 resize-none rounded-md bg-transparent px-1 font-display text-xl leading-snug font-semibold outline-none focus:bg-hover"
        />
      </div>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label="Card options" icon={<Ellipsis />} size="sm" />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem
            icon={<Copy />}
            onSelect={() =>
              void duplicateCard(queryClient, card).then(
                (copy) =>
                  void navigate({
                    to: '/b/$boardId',
                    params: { boardId: copy.boardId },
                    search: { card: copy.id },
                  }),
                (err: unknown) => toast({ title: errorMessage(err), tone: 'error' }),
              )
            }
          >
            Duplicate
          </MenuItem>
          <MenuItem
            icon={<FolderInput />}
            onSelect={() =>
              useShell
                .getState()
                .openDialog({ kind: 'move-card', cardId: card.id, boardId: board.board.id })
            }
          >
            Move to…
          </MenuItem>
          <MenuItem icon={<Link2 />} onSelect={copyLink}>
            Copy link
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={card.archivedAt ? <ArchiveRestore /> : <Archive />}
            onSelect={() => {
              void updateCard(queryClient, card, { archived: !card.archivedAt }).catch(
                () => undefined,
              );
              if (!card.archivedAt) {
                onClose();
                toast({
                  title: `Archived ${detail.key}`,
                  action: {
                    label: 'Undo',
                    onClick: () =>
                      void updateCard(queryClient, { ...card, archivedAt: 1 }, { archived: false }),
                  },
                });
              }
            }}
          >
            {card.archivedAt ? 'Restore' : 'Archive'}
          </MenuItem>
          <MenuItem
            icon={<Trash2 />}
            danger
            onSelect={() => {
              onClose();
              void deleteCard(queryClient, card).then(
                () => toast({ title: `Deleted ${detail.key}` }),
                () => undefined,
              );
            }}
          >
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>
      <IconButton label="Close card" icon={<X />} size="sm" onClick={onClose} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-sm">
      <span className="text-fg-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Properties({
  detail,
  board,
  focus,
}: {
  detail: CardDetail;
  board: BoardData;
  focus?: string;
}) {
  const queryClient = useQueryClient();
  const card = detail.card;
  const due = useRef<HTMLInputElement>(null);
  const [labelsOpen, setLabelsOpen] = useState(focus === 'labels');
  useEffect(() => {
    if (focus === 'due') due.current?.focus();
  }, [focus]);
  const update = (body: Parameters<typeof updateCard>[2]) =>
    void updateCard(queryClient, card, body).catch(() => undefined);
  const columns = board.columns.filter((c) => !c.archivedAt || c.id === card.columnId);
  const cardLabels = board.labels.filter((l) => card.labelIds.includes(l.id));
  return (
    <div className="flex flex-col gap-2.5 px-5 pb-4">
      <Row label="Column">
        <Select
          aria-label="Column"
          value={card.columnId}
          onValueChange={(columnId) =>
            void moveCard(queryClient, card, {
              columnId,
              swimlaneId: card.swimlaneId,
              beforeId: null,
            }).catch(() => undefined)
          }
          options={columns.map((c) => ({ value: c.id, label: c.name }))}
          className="w-full"
        />
      </Row>
      <Row label="Labels">
        <Popover open={labelsOpen} onOpenChange={setLabelsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Labels: ${cardLabels.map((l) => l.name).join(', ') || 'none'}`}
              className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-hover"
            >
              {cardLabels.length ? (
                cardLabels.map((l) => (
                  <span
                    key={l.id}
                    className="hue rounded-full bg-sec-soft px-2 py-px text-xs font-semibold text-sec-ink"
                    style={hueStyle(l.color)}
                  >
                    {l.name}
                  </span>
                ))
              ) : (
                <span className="text-fg-3">Add labels</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 p-1.5">
            <ul aria-label="Labels" className="flex flex-col">
              {board.labels.map((l) => {
                const on = card.labelIds.includes(l.id);
                return (
                  <li key={l.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover">
                      <Checkbox
                        checked={on}
                        onCheckedChange={() =>
                          update({
                            labelIds: on
                              ? card.labelIds.filter((id) => id !== l.id)
                              : [...card.labelIds, l.id],
                          })
                        }
                      />
                      <span
                        className="hue size-2.5 rounded-full bg-sec"
                        style={hueStyle(l.color)}
                      />
                      {l.name}
                    </label>
                  </li>
                );
              })}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 w-full justify-start"
              onClick={() => {
                setLabelsOpen(false);
                useShell.getState().openDialog({ kind: 'project', projectId: board.project.id });
              }}
            >
              {board.labels.length ? 'Manage labels…' : 'Create labels…'}
            </Button>
          </PopoverContent>
        </Popover>
      </Row>
      <Row label="Priority">
        <Select
          aria-label="Priority"
          value={card.priority}
          onValueChange={(v) => update({ priority: v as Priority })}
          options={[...PRIORITIES].reverse().map((p) => ({ value: p, label: PRIORITY_NAMES[p] }))}
          className="w-full"
        />
      </Row>
      <Row label="Dates">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-fg-3">
            Start
            <input
              type="date"
              aria-label="Start date"
              value={card.startDate ?? ''}
              onChange={(e) => update({ startDate: e.target.value || null })}
              className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-fg"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-fg-3">
            Due
            <input
              ref={due}
              type="date"
              aria-label="Due date"
              value={card.dueDate ?? ''}
              onChange={(e) => update({ dueDate: e.target.value || null })}
              className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-fg"
            />
          </label>
        </div>
      </Row>
      <Row label="Cover">
        <Select
          aria-label="Cover colour"
          value={card.coverColor ?? 'none'}
          onValueChange={(v) => update({ coverColor: v === 'none' ? null : (v as never) })}
          options={[
            { value: 'none', label: 'No cover' },
            ...COLOR_IDS.map((c) => ({
              value: c,
              label: sectionColor(c).name,
              icon: <span className="hue size-3 rounded-full bg-sec" style={hueStyle(c)} />,
            })),
          ]}
          className="w-full"
        />
      </Row>
      <Row label="Completed">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={!!card.completedAt}
            onCheckedChange={(v) => update({ completed: v === true })}
            aria-label="Completed"
          />
          <span className="text-xs text-fg-3">
            {card.completedAt
              ? formatDateTime(card.completedAt)
              : 'Moving it into a Done column completes it too.'}
          </span>
        </label>
      </Row>
    </div>
  );
}

/** Pasted and dropped images become the card's files, shown in its Markdown. */
async function uploadImage(file: File): Promise<AssetMeta> {
  const id = uuidv7();
  return uploadFile<AssetMeta>(
    `/assets/${id}?name=${encodeURIComponent(file.name || 'image.png')}`,
    file,
  );
}

function Description({ detail }: { detail: CardDetail }) {
  const queryClient = useQueryClient();
  const card = detail.card;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(detail.description);
  const edit = () => {
    setText(detail.description);
    setEditing(true);
  };
  const save = () => {
    setEditing(false);
    if (text !== detail.description) {
      void updateCard(queryClient, card, { description: text }).then(
        () => void queryClient.invalidateQueries({ queryKey: cardQuery(card.id).queryKey }),
        () => undefined,
      );
    }
  };
  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const area = e.currentTarget;
    const at = area.selectionStart;
    try {
      const metas = await Promise.all(files.map(uploadImage));
      const inserted = metas.map((m) => `![](asset:${m.id})`).join('\n');
      setText((t) => `${t.slice(0, at)}${inserted}${t.slice(at)}`);
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'error' });
    }
  };
  return (
    <section aria-label="Description" className={section}>
      <h3 className={heading}>Description</h3>
      {editing ? (
        <>
          <textarea
            aria-label="Description"
            value={text}
            autoFocus
            rows={8}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => void onPaste(e)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                save();
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
            }}
            className="w-full resize-y rounded-md border border-line bg-surface p-2.5 font-mono text-sm outline-none focus:border-focus"
          />
          <div className="flex items-center gap-2">
            <span className="mr-auto text-2xs text-fg-3">Markdown. Paste images straight in.</span>
            <Button size="sm" variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </>
      ) : detail.description.trim() ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Edit the description"
          onClick={(e) => !(e.target as HTMLElement).closest('a') && edit()}
          onKeyDown={(e) => e.key === 'Enter' && edit()}
          className="cursor-text rounded-md p-1 hover:bg-hover"
        >
          <Preview text={detail.description} className="text-sm" />
        </div>
      ) : (
        <button
          type="button"
          onClick={edit}
          className="rounded-md p-2 text-left text-sm text-fg-3 hover:bg-hover"
        >
          Add a description…
        </button>
      )}
    </section>
  );
}

function Checklists({ detail }: { detail: CardDetail }) {
  const queryClient = useQueryClient();
  const actions = cardActions(queryClient, detail.card);
  const [adding, setAdding] = useState(false);
  return (
    <section aria-label="Checklists" className={section}>
      <div className="flex items-center justify-between">
        <h3 className={heading}>
          <CheckSquare aria-hidden />
          Checklists
        </h3>
        <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Checklist
        </Button>
      </div>
      {adding && (
        <InlineInput
          label="Checklist name"
          initial="Checklist"
          onDone={(title) => {
            setAdding(false);
            if (title) void actions.addChecklist(title).catch(() => undefined);
          }}
        />
      )}
      {detail.checklists.map((list) => (
        <ChecklistView key={list.id} list={list} detail={detail} />
      ))}
    </section>
  );
}

function ChecklistView({ list, detail }: { list: Checklist; detail: CardDetail }) {
  const queryClient = useQueryClient();
  const actions = cardActions(queryClient, detail.card);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const done = list.items.filter((i) => i.done).length;
  const add = () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    void actions.addItem(list.id, value).catch(() => undefined);
  };
  const moveItem = (id: string, beforeId: string | null) =>
    void actions.updateItem(id, { checklistId: list.id, beforeId }).catch(() => undefined);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{list.title}</span>
        <span className="text-xs text-fg-3 tabular-nums">
          {done}/{list.items.length}
        </span>
        <span className="flex-1" />
        <IconButton
          label={`Delete checklist ${list.title}`}
          icon={<Trash2 />}
          size="xs"
          onClick={() => void actions.deleteChecklist(list.id)}
        />
      </div>
      <div
        role="progressbar"
        aria-label={`${list.title} progress`}
        aria-valuemin={0}
        aria-valuemax={list.items.length}
        aria-valuenow={done}
        className="h-1 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full bg-accent"
          style={{ width: `${list.items.length ? (done / list.items.length) * 100 : 0}%` }}
        />
      </div>
      <ul aria-label={list.title} className="flex flex-col">
        {list.items.map((item, i) => (
          <li
            key={item.id}
            draggable
            onDragStart={(e) => {
              setDragging(item.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', item.text);
            }}
            onDragOver={(e) => dragging && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && dragging !== item.id) moveItem(dragging, item.id);
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            className={cn(
              'group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-hover',
              dragging === item.id && 'opacity-50',
            )}
          >
            <Checkbox
              checked={item.done}
              aria-label={item.text}
              onCheckedChange={(v) =>
                void actions.updateItem(item.id, { done: v === true }).catch(() => undefined)
              }
            />
            <span
              className={cn('flex-1 text-sm', item.done && 'text-fg-3 line-through')}
              tabIndex={0}
              onKeyDown={(e) => {
                // Alt+↑/↓ reorders, like dragging.
                if (e.altKey && e.key === 'ArrowUp' && i > 0)
                  moveItem(item.id, list.items[i - 1]!.id);
                if (e.altKey && e.key === 'ArrowDown' && i < list.items.length - 1)
                  moveItem(item.id, list.items[i + 2]?.id ?? null);
              }}
            >
              {item.text}
            </span>
            <IconButton
              label={`Delete ${item.text}`}
              icon={<X />}
              size="xs"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => void actions.deleteItem(item.id)}
            />
          </li>
        ))}
      </ul>
      <input
        aria-label={`Add an item to ${list.title}`}
        placeholder="Add an item"
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        className="h-8 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none hover:border-line focus:border-focus"
      />
    </div>
  );
}

function InlineInput({
  label,
  initial,
  onDone,
}: {
  label: string;
  initial: string;
  onDone: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      aria-label={label}
      value={value}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value.trim());
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone('');
        }
      }}
      className="h-8 rounded-md border border-focus bg-surface px-2 text-sm outline-none"
    />
  );
}

function LinkedNotes({ detail, boardId }: { detail: CardDetail; boardId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const index = useNotes();
  const actions = cardActions(queryClient, detail.card);
  const pathOf = (sectionId: string) => {
    const path = index.pathOf(sectionId);
    if (!path) return '';
    return [
      path.notebook?.name ?? 'Inbox',
      ...path.groups.map((g) => g.name),
      path.section.isInbox ? null : path.section.name,
    ]
      .filter(Boolean)
      .join(' › ');
  };
  const restore = async (pageId: string) => {
    try {
      await api('POST', '/trash/restore', { items: [{ type: 'page', id: pageId }] });
      await queryClient.invalidateQueries({ queryKey: ['notes'] });
      await queryClient.invalidateQueries({ queryKey: cardQuery(detail.card.id).queryKey });
      toast({ title: 'Restored', tone: 'success' });
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'error' });
    }
  };
  return (
    <section aria-label="Linked notes" className={section}>
      <div className="flex items-center justify-between">
        <h3 className={heading}>
          <FileText aria-hidden />
          Linked notes
        </h3>
        <Button
          size="sm"
          variant="ghost"
          aria-keyshortcuts="N"
          onClick={() =>
            useShell.getState().openDialog({ kind: 'link-note', cardId: detail.card.id, boardId })
          }
        >
          <Plus aria-hidden />
          Link note
        </Button>
      </div>
      {detail.pages.length === 0 && (
        <p className="text-sm text-fg-3">No notes yet. Press N to link one.</p>
      )}
      <ul className="flex flex-col gap-1.5">
        {detail.pages.map((p) => (
          <li
            key={p.pageId}
            className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5"
          >
            <FileText aria-hidden className="size-4 shrink-0 text-fg-3" />
            <div className="min-w-0 flex-1">
              {p.deleted ? (
                <span className="block truncate text-sm text-fg-3">
                  {p.title || 'Untitled page'}
                </span>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                      onClick={(e) => {
                        if (e.shiftKey) {
                          e.preventDefault();
                          void navigate({
                            to: '/b/$boardId',
                            params: { boardId },
                            search: (s: Record<string, unknown>) => ({ ...s, beside: p.pageId }),
                          });
                        }
                      }}
                    >
                      {p.title || 'Untitled page'}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 p-3">
                    <NotePreview pageId={p.pageId} />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          void navigate({
                            to: '/b/$boardId',
                            params: { boardId },
                            search: (s: Record<string, unknown>) => ({ ...s, beside: p.pageId }),
                          })
                        }
                      >
                        Open beside
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void navigate({ to: '/p/$pageId', params: { pageId: p.pageId } })
                        }
                      >
                        Open
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <span className="block truncate text-xs text-fg-3">
                {p.deleted ? 'In recycle bin' : pathOf(p.sectionId)}
              </span>
            </div>
            {p.deleted && (
              <Button size="sm" variant="ghost" onClick={() => void restore(p.pageId)}>
                Restore
              </Button>
            )}
            <IconButton
              label={`Unlink ${p.title || 'Untitled page'}`}
              icon={<X />}
              size="xs"
              onClick={() => void actions.unlinkPage(p.pageId)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotePreview({ pageId }: { pageId: string }) {
  const index = useNotes();
  const page = index.page.get(pageId);
  if (!page) return <p className="text-sm text-fg-3">Not found</p>;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{page.title || 'Untitled page'}</span>
      <span className="line-clamp-4 text-xs text-fg-2">{page.snippet || 'Empty page'}</span>
      <span className="text-2xs text-fg-3">Edited {formatRelative(page.updatedAt)}</span>
    </div>
  );
}

function Files({ detail }: { detail: CardDetail }) {
  const queryClient = useQueryClient();
  const actions = cardActions(queryClient, detail.card);
  const input = useRef<HTMLInputElement>(null);
  const attach = async (files: File[]) => {
    for (const file of files) {
      try {
        const meta = await uploadImage(file);
        await actions.attach(meta.id);
      } catch (err) {
        toast({ title: errorMessage(err), tone: 'error' });
      }
    }
  };
  return (
    <section
      aria-label="Files"
      className={section}
      onPaste={(e) => {
        if ((e.target as HTMLElement).closest('textarea, input')) return;
        const files = [...e.clipboardData.files];
        if (files.length) {
          e.preventDefault();
          void attach(files);
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className={heading}>
          <Paperclip aria-hidden />
          Files
        </h3>
        <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
          <Plus aria-hidden />
          Add file
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          aria-label="Files to attach"
          onChange={(e) => {
            void attach([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      {detail.attachments.length === 0 && (
        <p className="text-sm text-fg-3">Add files, or paste images here.</p>
      )}
      <ul className="grid grid-cols-2 gap-2">
        {detail.attachments.map((a) => (
          <li
            key={a.assetId}
            className="group relative overflow-hidden rounded-lg border border-line"
          >
            <a
              href={`/api/v1/assets/${a.assetId}`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {a.mime.startsWith('image/') && a.mime !== 'image/svg+xml' ? (
                <img
                  src={`/api/v1/assets/${a.assetId}`}
                  alt={a.name}
                  className="h-24 w-full object-cover"
                />
              ) : (
                <span className="grid h-24 place-items-center bg-hover text-fg-3">
                  <Paperclip aria-hidden className="size-5" />
                </span>
              )}
              <span className="block truncate px-2 py-1 text-xs">
                {a.name} <span className="text-fg-3">· {formatBytes(a.size)}</span>
              </span>
            </a>
            <IconButton
              label={`Remove ${a.name}`}
              icon={<X />}
              size="xs"
              className="absolute top-1 right-1 bg-surface"
              onClick={() => void actions.detach(a.assetId)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comments({ detail }: { detail: CardDetail }) {
  const queryClient = useQueryClient();
  const actions = cardActions(queryClient, detail.card);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    void actions.addComment(body).catch(() => setText(body));
  };
  return (
    <section aria-label="Comments" className={section}>
      <h3 className={heading}>Comments</h3>
      <ul className="flex flex-col gap-3">
        {detail.comments.map((c) => (
          <li key={c.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold">{c.author}</span>
              <span className="text-fg-3" title={formatDateTime(c.createdAt)}>
                {formatRelative(c.createdAt)}
                {c.editedAt ? ' · edited' : ''}
              </span>
              <span className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(c.id);
                  setDraft(c.body);
                }}
              >
                Edit
              </Button>
              <IconButton
                label="Delete comment"
                icon={<Trash2 />}
                size="xs"
                onClick={() => void actions.deleteComment(c.id)}
              />
            </div>
            {editing === c.id ? (
              <textarea
                aria-label="Edit comment"
                value={draft}
                autoFocus
                rows={3}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    setEditing(null);
                    if (draft.trim()) void actions.editComment(c.id, draft.trim());
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setEditing(null);
                  }
                }}
                className="w-full rounded-md border border-focus bg-surface p-2 text-sm outline-none"
              />
            ) : (
              <Preview text={c.body} className="text-sm" />
            )}
          </li>
        ))}
      </ul>
      <textarea
        aria-label="Write a comment"
        placeholder="Write a comment (Ctrl+Enter sends)"
        value={text}
        rows={2}
        maxLength={20_000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
          }
        }}
        className="w-full resize-y rounded-md border border-line bg-surface p-2 text-sm outline-none focus:border-focus"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={!text.trim()} onClick={send}>
          Comment
        </Button>
      </div>
    </section>
  );
}

const ACTIVITY: Record<ActivityType, (p: Record<string, unknown>) => string> = {
  created: (p) => `created the card in ${String(p.column ?? 'a column')}`,
  moved: (p) => `moved it from ${String(p.from)} to ${String(p.to)}`,
  renamed: (p) => `renamed it from “${String(p.from)}”`,
  described: () => 'changed the description',
  priority_changed: (p) =>
    `set the priority to ${PRIORITY_NAMES[(p.to as Priority) ?? 'none'].toLowerCase()}`,
  dates_changed: (p) => (p.due ? `set the due date to ${String(p.due)}` : 'changed the dates'),
  labels_changed: () => 'changed the labels',
  completed: () => 'completed it',
  reopened: () => 'reopened it',
  archived: () => 'archived it',
  restored: () => 'restored it',
  note_linked: (p) => `linked “${String(p.title || 'Untitled page')}”`,
  note_unlinked: (p) => `unlinked “${String(p.title || 'Untitled page')}”`,
  commented: () => 'commented',
  attached: (p) => `attached ${String(p.name)}`,
  duplicated: () => 'made it as a copy',
};

function Activity({ activity }: { activity: CardActivity[] }) {
  return (
    <section aria-label="Activity" className={cn(section, 'pb-8')}>
      <h3 className={heading}>Activity</h3>
      <ol className="flex flex-col gap-1.5">
        {activity.map((a) => (
          <li key={a.id} className="text-xs text-fg-2">
            <span className="font-semibold text-fg">{a.author}</span>{' '}
            {ACTIVITY[a.type]?.(a.payload) ?? a.type}{' '}
            <span className="text-fg-3" title={formatDateTime(a.createdAt)}>
              {formatRelative(a.createdAt)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
