import { COLOR_IDS, NOTEBOOK_ICONS, type ColorId, type NotebookIcon } from '@memora/shared';
import { Folder, Inbox, Search } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Dialog, DialogContent, Field, Input, Kbd, toast } from '../components/ui';
import { cn } from '../lib/cn';
import { fuzzyFilter } from '../lib/fuzzy';
import { checkGroupMove, type NotesIndex } from '../notes/model';
import { useNotes, useNotesActions } from '../notes/queries';
import { hueStyle, sectionColor } from '../theme/sections';
import { useCommands } from './commands';
import { useGo } from './location';
import { NOTEBOOK_ICON } from './icons';
import { EDITOR_KEYS, LIST_KEYS, SHORTCUTS, keysLabel } from './shortcuts';
import { useShell } from './store';

const close = () => useShell.getState().closeDialog();

/** A group of radio buttons drawn as swatches or tiles. */
function Choices<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  render,
  label,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render: (option: T) => ReactNode;
  label: (option: T) => string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold text-fg">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <label key={option} title={label(option)} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="peer absolute inset-0 opacity-0"
            />
            <span className="sr-only">{label(option)}</span>
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-raised peer-checked:ring-2 peer-checked:ring-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-focus"
            >
              {render(option)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const ICON_LABEL = (icon: NotebookIcon) =>
  icon.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function NotebookDialog({ notebookId }: { notebookId?: string }) {
  const index = useNotes();
  const actions = useNotesActions();
  const go = useGo();
  const existing = notebookId ? index.notebook.get(notebookId) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState<ColorId>(
    existing?.color ?? COLOR_IDS[index.notebooks.length % COLOR_IDS.length]!,
  );
  const [icon, setIcon] = useState<NotebookIcon>(existing?.icon ?? 'notebook');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    if (existing) {
      void actions.updateNotebook(existing.id, { name, color, icon });
      close();
      return;
    }
    setBusy(true);
    const result = await actions.createNotebook({ name, color, icon });
    setBusy(false);
    const section = result?.sections?.[0];
    if (section) {
      close();
      go.section(section.id);
    }
  }

  return (
    <DialogContent
      title={existing ? 'Notebook settings' : 'New notebook'}
      size="sm"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="notebook-form" disabled={busy}>
            {existing ? 'Save' : 'Create notebook'}
          </Button>
        </>
      }
    >
      <form id="notebook-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name" error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              maxLength={100}
              autoFocus
              placeholder="For example: Work"
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
        <Choices
          legend="Colour"
          name="notebook-color"
          options={COLOR_IDS}
          value={color}
          onChange={setColor}
          label={(c) => sectionColor(c).name}
          render={(c) => <span className="hue size-6 rounded-full bg-sec" style={hueStyle(c)} />}
        />
        <Choices
          legend="Icon"
          name="notebook-icon"
          options={NOTEBOOK_ICONS}
          value={icon}
          onChange={setIcon}
          label={ICON_LABEL}
          render={(i) => {
            const Icon = NOTEBOOK_ICON[i];
            return (
              <span
                className="hue grid size-7 place-items-center rounded-[9px] bg-sec text-on-accent"
                style={hueStyle(color)}
              >
                <Icon className="size-4" />
              </span>
            );
          }}
        />
      </form>
    </DialogContent>
  );
}

interface Destination {
  id: string;
  kind: 'notebook' | 'group' | 'section';
  label: string;
  path: string;
  color: ColorId;
  notebookId: string | null;
  groupId: string | null;
}

function destinations(index: NotesIndex, type: 'pages' | 'section' | 'group'): Destination[] {
  const out: Destination[] = [];
  if (type === 'pages') {
    out.push({
      id: index.inbox.id,
      kind: 'section',
      label: 'Inbox',
      path: '',
      color: index.inbox.color,
      notebookId: null,
      groupId: null,
    });
  }
  for (const nb of index.notebooks) {
    if (type !== 'pages') {
      out.push({
        id: nb.id,
        kind: 'notebook',
        label: nb.name,
        path: '',
        color: nb.color,
        notebookId: nb.id,
        groupId: null,
      });
    }
    const walk = (groupId: string | null, trail: string[]) => {
      if (type === 'pages') {
        for (const s of index.sectionsIn(nb.id, groupId)) {
          out.push({
            id: s.id,
            kind: 'section',
            label: s.name,
            path: trail.join(' › '),
            color: s.color,
            notebookId: nb.id,
            groupId,
          });
        }
      }
      for (const g of index.groupsIn(nb.id, groupId)) {
        if (type !== 'pages') {
          out.push({
            id: g.id,
            kind: 'group',
            label: g.name,
            path: trail.join(' › '),
            color: nb.color,
            notebookId: nb.id,
            groupId: g.id,
          });
        }
        walk(g.id, [...trail, g.name]);
      }
    };
    walk(null, [nb.name]);
  }
  return out;
}

function MoveDialog({ type, ids }: { type: 'pages' | 'section' | 'group'; ids: string[] }) {
  const index = useNotes();
  const actions = useNotesActions();
  const commands = useCommands();
  const go = useGo();
  const [query, setQuery] = useState('');
  const all = useMemo(() => {
    const list = destinations(index, type);
    if (type !== 'group') return list;
    return list.filter(
      (d) =>
        !checkGroupMove(index, ids[0]!, {
          notebookId: d.notebookId!,
          parentGroupId: d.kind === 'group' ? d.id : null,
          beforeId: null,
        }),
    );
  }, [index, type, ids]);
  const shown = useMemo(
    () => (query.trim() ? fuzzyFilter(all, query, (d) => `${d.label} ${d.path}`) : all),
    [all, query],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const target = all.find((d) => d.id === picked) ?? null;

  const what =
    type === 'pages'
      ? ids.length === 1
        ? `“${index.page.get(ids[0]!)?.title || 'Untitled page'}”`
        : `${ids.length} pages`
      : type === 'section'
        ? `“${index.section.get(ids[0]!)?.name ?? 'Section'}”`
        : `“${index.group.get(ids[0]!)?.name ?? 'Section group'}”`;

  function move() {
    if (!target) return;
    close();
    if (type === 'pages') {
      commands.movePagesTo(ids, { sectionId: target.id, parentPageId: null, beforeId: null });
    } else if (type === 'section') {
      void actions.moveSection(ids[0]!, {
        notebookId: target.notebookId!,
        groupId: target.groupId,
        beforeId: null,
      });
    } else {
      void actions.moveGroup(ids[0]!, {
        notebookId: target.notebookId!,
        parentGroupId: target.kind === 'group' ? target.id : null,
        beforeId: null,
      });
    }
  }

  async function copy() {
    if (!target) return;
    close();
    const result = await actions.copyPages(ids, {
      sectionId: target.id,
      parentPageId: null,
      beforeId: null,
    });
    const first = result?.pages?.[0];
    if (first) {
      toast({
        title: `Copied ${what} to ${target.label}`,
        tone: 'success',
        action: { label: 'Open', onClick: () => go.page(first.id) },
      });
    }
  }

  return (
    <DialogContent
      title={type === 'pages' ? `Move or copy ${what}` : `Move ${what}`}
      description={
        type === 'pages'
          ? 'Pages go to the end of the section you pick, with their subpages.'
          : type === 'section'
            ? 'Pick a notebook or section group.'
            : 'Pick a notebook, or a section group to put it in.'
      }
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          {type === 'pages' && (
            <Button onClick={() => void copy()} disabled={!target}>
              Copy
            </Button>
          )}
          <Button variant="primary" onClick={move} disabled={!target}>
            Move
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          pill
          icon={<Search />}
          aria-label="Search destinations"
          placeholder={type === 'pages' ? 'Search sections' : 'Search notebooks and groups'}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <div
          role="radiogroup"
          aria-label="Destination"
          className="flex max-h-[45vh] flex-col gap-px overflow-y-auto"
        >
          {shown.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-fg-3">Nothing matches.</p>
          )}
          {shown.map((d) => (
            <label
              key={d.id}
              className={cn(
                'hue flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-base',
                picked === d.id
                  ? 'bg-active font-semibold text-fg shadow-card'
                  : 'text-fg-2 hover:bg-hover',
              )}
              style={hueStyle(d.color)}
            >
              <input
                type="radio"
                name="destination"
                value={d.id}
                checked={picked === d.id}
                onChange={() => setPicked(d.id)}
                onDoubleClick={move}
                className="sr-only"
              />
              {d.kind === 'section' && d.label === 'Inbox' && !d.notebookId ? (
                <Inbox className="size-4 shrink-0 text-fg-3" />
              ) : d.kind === 'group' ? (
                <Folder className="size-4 shrink-0 text-fg-3" />
              ) : d.kind === 'notebook' ? (
                <span aria-hidden className="size-3 shrink-0 rounded-[4px] bg-sec" />
              ) : (
                <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-sec" />
              )}
              <span className="min-w-0 truncate">{d.label}</span>
              {d.path && (
                <span className="ml-auto min-w-0 truncate text-xs font-normal text-fg-3">
                  {d.path}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>
    </DialogContent>
  );
}

function QuickNoteDialog() {
  const index = useNotes();
  const actions = useNotesActions();
  const go = useGo();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!title.trim() && !text.trim()) {
      close();
      return;
    }
    setBusy(true);
    const result = await actions.createPage({ sectionId: index.inbox.id, title, content: text });
    setBusy(false);
    const page = result?.pages?.[0];
    if (!page) return;
    close();
    toast({
      title: 'Saved to your Inbox',
      tone: 'success',
      action: { label: 'Open', onClick: () => go.page(page.id) },
    });
  }

  return (
    <DialogContent
      title="Quick note"
      description="Goes straight to your Inbox; sort it into a notebook later."
      footer={
        <>
          <span className="mr-auto hidden text-xs text-fg-3 tablet:inline">
            <Kbd>{keysLabel('Mod Enter')}</Kbd> to save
          </span>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="quick-note-form" disabled={busy}>
            Save to Inbox
          </Button>
        </>
      }
    >
      <form
        id="quick-note-form"
        onSubmit={(e) => void save(e)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void save(e);
        }}
        className="flex flex-col gap-3"
      >
        <Input
          aria-label="Title"
          placeholder="Title (optional)"
          value={title}
          maxLength={200}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // Enter goes on to the note; Mod+Enter saves.
            if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            noteRef.current?.focus();
          }}
        />
        <textarea
          ref={noteRef}
          aria-label="Note"
          placeholder="Write something…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          className="min-h-32 w-full resize-y rounded-sm border border-line bg-surface px-2.5 py-2 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-3 focus:ring-accent/20"
        />
      </form>
    </DialogContent>
  );
}

function ShortcutsDialog() {
  const groups = ['General', 'Pages', 'Moving around'] as const;
  const row = (keys: string, label: string) => (
    <div
      key={`${keys}-${label}`}
      className="flex items-center justify-between gap-4 py-1.5 text-sm"
    >
      <span className="text-fg-2">{label}</span>
      <span className="flex shrink-0 gap-1">
        {keysLabel(keys)
          .split(' ')
          .map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
      </span>
    </div>
  );
  return (
    <DialogContent title="Keyboard shortcuts" size="lg">
      <div className="grid gap-x-8 gap-y-4 tablet:grid-cols-2">
        {groups.map((group) => (
          <section key={group}>
            <h3 className="mb-1 text-2xs font-semibold tracking-wider text-fg-3 uppercase">
              {group}
            </h3>
            <div className="divide-y divide-line">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => row(s.keys, s.label))}
            </div>
          </section>
        ))}
        <section>
          <h3 className="mb-1 text-2xs font-semibold tracking-wider text-fg-3 uppercase">
            Lists and trees
          </h3>
          <div className="divide-y divide-line">
            {LIST_KEYS.map((k) => row(k.keys, k.label))}
            {row('Esc', 'Leave the page list')}
          </div>
        </section>
        <section>
          <h3 className="mb-1 text-2xs font-semibold tracking-wider text-fg-3 uppercase">
            Markdown editor
          </h3>
          <div className="divide-y divide-line">{EDITOR_KEYS.map((k) => row(k.keys, k.label))}</div>
        </section>
      </div>
    </DialogContent>
  );
}

/** Whichever dialog the shell has open. */
export function ShellDialogs() {
  const dialog = useShell((s) => s.dialog);
  return (
    <Dialog open={!!dialog} onOpenChange={(open) => !open && close()}>
      {dialog?.kind === 'notebook' && (
        <NotebookDialog key={dialog.notebookId ?? 'new'} notebookId={dialog.notebookId} />
      )}
      {dialog?.kind === 'move' && <MoveDialog type={dialog.type} ids={dialog.ids} />}
      {dialog?.kind === 'quick-note' && <QuickNoteDialog />}
      {dialog?.kind === 'shortcuts' && <ShortcutsDialog />}
    </Dialog>
  );
}
