import { COLOR_IDS, NOTEBOOK_ICONS, type ColorId, type NotebookIcon } from '@memora/shared';
import { lazy, Suspense, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { HelpLink } from '../components/HelpLink';
import { Button, Dialog, DialogContent, Field, Input, Kbd, toast } from '../components/ui';
import { HELP } from '../lib/help';
import { checkGroupMove } from '../notes/model';
import { useNotes, useNotesActions } from '../notes/queries';
import { hueStyle, sectionColor } from '../theme/sections';
import { useCommands } from './commands';
import { DestinationPicker } from './DestinationPicker';
import { destinations } from './destinations';
import { useGo } from './location';
import { NOTEBOOK_ICON } from './icons';
import { EDITOR_KEYS, LIST_KEYS, SHORTCUTS, keysLabel } from './shortcuts';
import { useShell } from './store';

const close = () => useShell.getState().closeDialog();

// The history is opened now and then: loaded when it is.
const HistoryDialog = lazy(() => import('../history/HistoryDialog'));
const SaveVersionDialog = lazy(() =>
  import('../history/HistoryDialog').then((m) => ({ default: m.SaveVersionDialog })),
);
const templateDialogs = () => import('../templates/TemplateDialogs');
const SaveTemplateDialog = lazy(() =>
  templateDialogs().then((m) => ({ default: m.SaveTemplateDialog })),
);
const TemplatesDialog = lazy(() => templateDialogs().then((m) => ({ default: m.TemplatesDialog })));
const InsertTemplateDialog = lazy(() =>
  templateDialogs().then((m) => ({ default: m.InsertTemplateDialog })),
);
const SectionTemplateDialog = lazy(() =>
  templateDialogs().then((m) => ({ default: m.SectionTemplateDialog })),
);
const exportDialogs = () => import('../transfer/ExportDialog');
const ExportDialog = lazy(() => exportDialogs().then((m) => ({ default: m.ExportDialog })));
const PrintDialog = lazy(() => exportDialogs().then((m) => ({ default: m.PrintDialog })));
const kanbanDialogs = () => import('../kanban/dialogs');
const NewProjectDialog = lazy(() => kanbanDialogs().then((m) => ({ default: m.NewProjectDialog })));
const ProjectDialog = lazy(() => kanbanDialogs().then((m) => ({ default: m.ProjectDialog })));
const NewBoardDialog = lazy(() => kanbanDialogs().then((m) => ({ default: m.NewBoardDialog })));
const DeleteDialog = lazy(() => kanbanDialogs().then((m) => ({ default: m.DeleteDialog })));
const MoveCardDialog = lazy(() => kanbanDialogs().then((m) => ({ default: m.MoveCardDialog })));
const AddToBoardDialog = lazy(() => kanbanDialogs().then((m) => ({ default: m.AddToBoardDialog })));
const NameDialog = lazy(() => kanbanDialogs().then((m) => ({ default: m.NameDialog })));
const LinkNoteDialog = lazy(() =>
  import('../kanban/LinkNoteDialog').then((m) => ({ default: m.LinkNoteDialog })),
);

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

function MoveDialog({ type, ids }: { type: 'pages' | 'section' | 'group'; ids: string[] }) {
  const index = useNotes();
  const actions = useNotesActions();
  const commands = useCommands();
  const go = useGo();
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
      <DestinationPicker
        all={all}
        picked={picked}
        onPick={setPicked}
        onChoose={move}
        placeholder={type === 'pages' ? 'Search sections' : 'Search notebooks and groups'}
      />
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
      <p className="mt-4 text-sm text-fg-2">
        The editors’ own keys and more tips are in the{' '}
        <HelpLink href={HELP.shortcuts}>user guide</HelpLink>.
      </p>
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
      <Suspense fallback={null}>
        {dialog?.kind === 'history' && (
          <HistoryDialog key={dialog.pageId} pageId={dialog.pageId} versionId={dialog.versionId} />
        )}
        {dialog?.kind === 'save-version' && <SaveVersionDialog pageId={dialog.pageId} />}
        {dialog?.kind === 'save-template' && <SaveTemplateDialog pageId={dialog.pageId} />}
        {dialog?.kind === 'templates' && <TemplatesDialog />}
        {dialog?.kind === 'insert-template' && (
          <InsertTemplateDialog onPick={dialog.onPick} title={dialog.title} />
        )}
        {dialog?.kind === 'section-template' && (
          <SectionTemplateDialog sectionId={dialog.sectionId} />
        )}
        {dialog?.kind === 'export' && <ExportDialog scope={dialog.scope} id={dialog.id} />}
        {dialog?.kind === 'print' && <PrintDialog scope={dialog.scope} id={dialog.id} />}
        {dialog?.kind === 'new-project' && <NewProjectDialog />}
        {dialog?.kind === 'project' && <ProjectDialog projectId={dialog.projectId} />}
        {dialog?.kind === 'new-board' && <NewBoardDialog projectId={dialog.projectId} />}
        {dialog?.kind === 'delete-board' && <DeleteDialog kind="board" id={dialog.boardId} />}
        {dialog?.kind === 'delete-project' && <DeleteDialog kind="project" id={dialog.projectId} />}
        {dialog?.kind === 'move-card' && (
          <MoveCardDialog cardId={dialog.cardId} boardId={dialog.boardId} />
        )}
        {dialog?.kind === 'link-note' && (
          <LinkNoteDialog cardId={dialog.cardId} boardId={dialog.boardId} />
        )}
        {dialog?.kind === 'add-to-board' && <AddToBoardDialog pageId={dialog.pageId} />}
        {dialog?.kind === 'kanban-name' && (
          <NameDialog
            key={dialog.title}
            title={dialog.title}
            label={dialog.label}
            initial={dialog.initial}
            submit={dialog.submit}
          />
        )}
      </Suspense>
    </Dialog>
  );
}
