import {
  BOARD_TEMPLATES,
  BOARD_TEMPLATE_COLUMNS,
  COLOR_IDS,
  PROJECT_ICONS,
  suggestKey,
  type BoardTemplate,
  type ColorId,
  type Label,
  type ProjectIcon,
} from '@memora/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, DialogContent, Field, IconButton, Input, Select, toast } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useNotes } from '../notes/queries';
import { useShell } from '../shell/store';
import { hueStyle, sectionColor } from '../theme/sections';
import {
  boardQuery,
  createBoard,
  createCard,
  createProject,
  deleteBoard,
  deleteLabel,
  deleteProject,
  moveCard,
  projectsQuery,
  saveLabel,
  updateProject,
} from './api';
import { PROJECT_ICON } from './icons';

/* Kanban's dialogs (§9.11): projects, boards, labels, moving cards and adding notes to boards. */

const close = () => useShell.getState().closeDialog();

const TEMPLATE_NAMES: Record<BoardTemplate, string> = {
  basic: 'Basic',
  extended: 'Extended',
  empty: 'Empty',
};

const templateOptions = BOARD_TEMPLATES.map((t) => ({
  value: t,
  label: BOARD_TEMPLATE_COLUMNS[t].length
    ? `${TEMPLATE_NAMES[t]}: ${BOARD_TEMPLATE_COLUMNS[t].join(' · ')}`
    : `${TEMPLATE_NAMES[t]}: no columns`,
}));

function Swatches({ value, onChange }: { value: ColorId; onChange: (c: ColorId) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
      {COLOR_IDS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={sectionColor(c).name}
          onClick={() => onChange(c)}
          style={hueStyle(c)}
          className="hue size-6 rounded-full bg-sec ring-offset-2 ring-offset-surface aria-checked:ring-2 aria-checked:ring-fg"
        />
      ))}
    </div>
  );
}

function Icons({ value, onChange }: { value: ProjectIcon; onChange: (i: ProjectIcon) => void }) {
  return (
    <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1">
      {PROJECT_ICONS.map((icon) => (
        <button
          key={icon}
          type="button"
          role="radio"
          aria-checked={value === icon}
          aria-label={icon.replace(/-/g, ' ')}
          onClick={() => onChange(icon)}
          className="grid size-8 place-items-center rounded-md text-fg-2 hover:bg-hover aria-checked:bg-accent-soft aria-checked:text-fg [&_svg]:size-4"
        >
          {PROJECT_ICON[icon]}
        </button>
      ))}
    </div>
  );
}

export function NewProjectDialog() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [color, setColor] = useState<ColorId>('blue');
  const [icon, setIcon] = useState<ProjectIcon>('square-kanban');
  const [template, setTemplate] = useState<BoardTemplate>('basic');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const made = await createProject(queryClient, {
        name,
        key: key || suggestKey(name),
        color,
        icon,
        template,
      });
      close();
      void navigate({ to: '/b/$boardId', params: { boardId: made.board.id } });
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields ?? {};
      setErrors(Object.keys(fields).length ? fields : { key: errorMessage(err) });
      setBusy(false);
    }
  };
  return (
    <DialogContent
      title="New project"
      description="A project holds boards; its key starts every card's number, like WEB-42."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="new-project"
            disabled={busy || !name.trim()}
          >
            Create project
          </Button>
        </>
      }
    >
      <form id="new-project" className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field label="Name" error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              autoFocus
              maxLength={100}
              onChange={(e) => {
                setName(e.target.value);
                if (!keyEdited) setKey(e.target.value.trim() ? suggestKey(e.target.value) : '');
              }}
            />
          )}
        </Field>
        <Field label="Key" hint="2 to 10 letters or digits." error={errors.key}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={key}
              maxLength={10}
              onChange={(e) => {
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                setKeyEdited(true);
              }}
              wrapperClassName="w-40"
            />
          )}
        </Field>
        <Field label="First board">
          {({ id }) => (
            <Select
              id={id}
              value={template}
              onValueChange={(v) => setTemplate(v as BoardTemplate)}
              options={templateOptions}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Colour</span>
          <Swatches value={color} onChange={setColor} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Icon</span>
          <Icons value={icon} onChange={setIcon} />
        </div>
      </form>
    </DialogContent>
  );
}

/** A project's name, key, colour, icon and labels. */
export function ProjectDialog({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const data = useQuery(projectsQuery).data;
  const project = data?.projects.find((p) => p.id === projectId);
  const [name, setName] = useState(project?.name ?? '');
  const [key, setKey] = useState(project?.key ?? '');
  const [color, setColor] = useState<ColorId>(project?.color ?? 'blue');
  const [icon, setIcon] = useState<ProjectIcon>(project?.icon ?? 'square-kanban');
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  if (!project) return null;
  const labels = data!.labels.filter((l) => l.projectId === projectId);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateProject(queryClient, projectId, { name, key, color, icon });
      close();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const addLabel = async () => {
    const text = newLabel.trim();
    if (!text) return;
    setNewLabel('');
    await saveLabel(queryClient, projectId, {
      name: text,
      color: COLOR_IDS[labels.length % COLOR_IDS.length]!,
    }).catch((err: unknown) => toast({ title: errorMessage(err), tone: 'error' }));
  };
  return (
    <DialogContent
      title="Project settings"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="project-settings">
            Save
          </Button>
        </>
      }
    >
      <form id="project-settings" className="flex flex-col gap-4" onSubmit={(e) => void save(e)}>
        <div className="grid gap-4 tablet:grid-cols-[1fr_9rem]">
          <Field label="Name">
            {({ id }) => (
              <Input
                id={id}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Key" hint="Cards are renumbered only when moved.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={key}
                maxLength={10}
                onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            )}
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Colour</span>
          <Swatches value={color} onChange={setColor} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Icon</span>
          <Icons value={icon} onChange={setIcon} />
        </div>
      </form>
      <section aria-label="Labels" className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-sm font-semibold">Labels</h3>
        <p className="text-xs text-fg-3">Shared by every board of the project.</p>
        <ul className="flex flex-col gap-1.5">
          {labels.map((l) => (
            <LabelRow key={l.id} label={l} />
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            aria-label="New label"
            placeholder="New label"
            value={newLabel}
            maxLength={40}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addLabel();
              }
            }}
            wrapperClassName="h-8 flex-1"
          />
          <Button size="sm" onClick={() => void addLabel()}>
            <Plus aria-hidden />
            Add label
          </Button>
        </div>
      </section>
    </DialogContent>
  );
}

function LabelRow({ label }: { label: Label }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(label.name);
  const save = (patch: Partial<Label>) =>
    void saveLabel(queryClient, label.projectId, {
      id: label.id,
      name,
      color: label.color,
      ...patch,
    }).catch((err: unknown) => toast({ title: errorMessage(err), tone: 'error' }));
  return (
    <li className="flex items-center gap-2">
      <Select
        aria-label={`Colour of ${label.name}`}
        value={label.color}
        onValueChange={(c) => save({ color: c as ColorId })}
        options={COLOR_IDS.map((c) => ({
          value: c,
          label: sectionColor(c).name,
          icon: <span className="hue size-3 rounded-full bg-sec" style={hueStyle(c)} />,
        }))}
        className="min-w-32"
      />
      <Input
        aria-label="Label name"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== label.name && save({ name })}
        wrapperClassName="h-8 flex-1"
      />
      <IconButton
        label={`Delete label ${label.name}`}
        icon={<Trash2 />}
        size="sm"
        onClick={() => void deleteLabel(queryClient, label.id)}
      />
    </li>
  );
}

export function NewBoardDialog({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<BoardTemplate>('basic');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const board = await createBoard(queryClient, { projectId, name, template });
      close();
      void navigate({ to: '/b/$boardId', params: { boardId: board.id } });
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <DialogContent
      size="sm"
      title="New board"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-board" disabled={!name.trim()}>
            Create board
          </Button>
        </>
      }
    >
      <form id="new-board" className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field label="Name" error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              autoFocus
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Columns">
          {({ id }) => (
            <Select
              id={id}
              value={template}
              onValueChange={(v) => setTemplate(v as BoardTemplate)}
              options={templateOptions}
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}

export function DeleteDialog({ kind, id }: { kind: 'board' | 'project'; id: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const data = useQuery(projectsQuery).data;
  const name =
    kind === 'board'
      ? data?.boards.find((b) => b.id === id)?.name
      : data?.projects.find((p) => p.id === id)?.name;
  const remove = async () => {
    close();
    try {
      if (kind === 'board') await deleteBoard(queryClient, id);
      else await deleteProject(queryClient, id);
      toast({ title: `Deleted “${name ?? ''}”`, tone: 'success' });
      void navigate({ to: '/' });
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'error' });
    }
  };
  return (
    <DialogContent
      size="sm"
      title={`Delete “${name ?? ''}”?`}
      description={
        kind === 'board'
          ? 'Its columns and cards are deleted for good. Archive the board to keep them.'
          : 'Its boards, columns, cards and labels are deleted for good. Archive the project to keep them.'
      }
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="danger" onClick={() => void remove()}>
            Delete {kind}
          </Button>
        </>
      }
    >
      {null}
    </DialogContent>
  );
}

/** Asks for a name (new columns and lanes). */
export function NameDialog({
  title,
  label,
  initial,
  submit,
}: {
  title: string;
  label: string;
  initial: string;
  submit: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const done = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter a name.');
    try {
      await submit(name.trim());
      close();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <DialogContent
      size="sm"
      title={title}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="kanban-name">
            Save
          </Button>
        </>
      }
    >
      <form id="kanban-name" onSubmit={(e) => void done(e)}>
        <Field label={label} error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              autoFocus
              maxLength={100}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}

/** Picks a board and a column: for moving a card, or adding a note to a board. */
function useBoardChoice(initialBoard?: string) {
  const data = useQuery(projectsQuery).data;
  const boards = (data?.boards ?? []).filter((b) => !b.archivedAt);
  const [boardId, setBoardId] = useState(initialBoard ?? boards[0]?.id ?? '');
  const board = useQuery({ ...boardQuery(boardId), enabled: !!boardId }).data;
  const columns = (board?.columns ?? []).filter((c) => !c.archivedAt);
  const [columnId, setColumnId] = useState<string | null>(null);
  const column = columns.find((c) => c.id === columnId) ?? columns[0];
  const projectName = (id: string) => data?.projects.find((p) => p.id === id)?.name ?? '';
  const pickers = (
    <div className="grid gap-4 tablet:grid-cols-2">
      <Field label="Board">
        {({ id }) => (
          <Select
            id={id}
            value={boardId}
            onValueChange={(v) => {
              setBoardId(v);
              setColumnId(null);
            }}
            options={boards.map((b) => ({
              value: b.id,
              label: `${projectName(b.projectId)} › ${b.name}`,
            }))}
            placeholder="Choose a board"
          />
        )}
      </Field>
      <Field label="Column">
        {({ id }) => (
          <Select
            id={id}
            value={column?.id ?? ''}
            onValueChange={setColumnId}
            options={columns.map((c) => ({ value: c.id, label: c.name }))}
            placeholder={boardId ? 'No columns' : 'Choose a board first'}
          />
        )}
      </Field>
    </div>
  );
  return { board, column, pickers, noBoards: boards.length === 0 };
}

export function MoveCardDialog({ cardId, boardId }: { cardId: string; boardId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const current = useQuery(boardQuery(boardId)).data;
  const card = current?.cards.find((c) => c.id === cardId);
  const { column, pickers, board } = useBoardChoice(boardId);
  const move = async () => {
    if (!card || !column || !board) return;
    close();
    await moveCard(queryClient, card, {
      columnId: column.id,
      swimlaneId: null,
      beforeId: null,
    }).catch(() => undefined);
    if (board.board.id !== boardId) {
      toast({
        title: `Moved to ${board.board.name}`,
        action: {
          label: 'Open',
          onClick: () => void navigate({ to: '/b/$boardId', params: { boardId: board.board.id } }),
        },
      });
    }
  };
  return (
    <DialogContent
      title="Move card"
      description={card ? `“${card.title}” goes to the end of the column.` : undefined}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!column} onClick={() => void move()}>
            Move
          </Button>
        </>
      }
    >
      {pickers}
    </DialogContent>
  );
}

/** "Add to board…" from a note: a new card for it, linked (§9.11). */
export function AddToBoardDialog({ pageId }: { pageId: string }) {
  const queryClient = useQueryClient();
  const index = useNotes();
  const page = index.page.get(pageId);
  const { column, pickers, board, noBoards } = useBoardChoice();
  const [title, setTitle] = useState(page?.title || 'Untitled page');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!column || !board) return;
    try {
      await createCard(queryClient, board.board.id, { columnId: column.id, title, pageId });
      void queryClient.invalidateQueries({ queryKey: ['kanban', 'page-cards', pageId] });
      close();
      toast({ title: `Added to ${board.board.name}`, tone: 'success' });
    } catch {
      // Told by createCard.
    }
  };
  return (
    <DialogContent
      title="Add to board"
      description="A new card, linked to this note."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="add-to-board"
            disabled={!column || !title.trim()}
          >
            Add card
          </Button>
        </>
      }
    >
      {noBoards ? (
        <p className="text-sm text-fg-2">
          Create a project first: its first board is ready at once.
        </p>
      ) : (
        <form id="add-to-board" className="flex flex-col gap-4" onSubmit={(e) => void add(e)}>
          <Field label="Card title">
            {({ id }) => (
              <Input
                id={id}
                value={title}
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          {pickers}
        </form>
      )}
    </DialogContent>
  );
}
