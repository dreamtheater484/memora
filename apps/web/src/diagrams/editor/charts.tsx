import type { Gantt, GanttTag, GanttTask, Pie, Timeline } from '@memora/shared';
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import {
  Button,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Select,
  Switch,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { keysLabel } from '../../shell/shortcuts';
import { NumberField, TextField } from './fields';
import { withText } from './labels';
import {
  addEvent,
  addGanttSection,
  addPeriod,
  addSlice,
  addTask,
  addTimelineSection,
  duplicatePeriod,
  duplicateSlice,
  duplicateTask,
  moveEvent,
  movePeriod,
  moveSection,
  moveSlice,
  moveTask,
  removeEvent,
  removePeriod,
  removeSectionKeep,
  removeSectionWhole,
  removeSlice,
  removeTask,
  taskId,
} from './ops';
import { Section, type PanelProps } from './panel';
import { focusField, rowKeys } from './rows';
import { isSelected, itemKey, selectionOf, type Item } from './selection';

/*
 * Timelines, Gantt charts and pie charts (§9.4), edited as small tables beside the drawing.
 * A click on the drawing selects the row; its words can be edited there in place too. In a
 * row's field, Enter adds a row after it, Alt+↑ and Alt+↓ move it, ↑ and ↓ go to the next
 * field.
 */

const clone = <T,>(value: T): T => structuredClone(value);
const fieldOf = (item: Item) => `[data-item="${itemKey(item)}"] textarea`;

/** What every chart panel does with the editor's props. */
function usePanel<M extends Timeline | Gantt | Pie>({
  model,
  change,
  selection,
  select,
}: PanelProps<M>) {
  return {
    edit: (apply: (next: M) => void, merge?: string) => {
      const next = clone(model);
      apply(next);
      change(next, merge ? { merge } : undefined);
    },
    words: (item: Item) => (text: string) =>
      change(withText(model, item, text), { merge: itemKey(item) }),
    /** A change that selects an item and puts the caret in its field. */
    go: (next: M, item: Item, announce?: string) => {
      change(next, { select: selectionOf(item), announce });
      focusField(fieldOf(item));
    },
    on: (item: Item) => isSelected(selection, item),
    /** Working in a row selects what it is about (and marks it on the drawing). */
    focus: (item: Item) => () => {
      if (!isSelected(selection, item)) select(selectionOf(item));
    },
  };
}

/** A section's name, moves and removal (keeping or with what it holds). */
function SectionRow({
  item,
  label,
  holds,
  on,
  onFocus,
  onWords,
  onMove,
  onRemove,
}: {
  item: Item;
  label: string;
  holds: string;
  on: boolean;
  onFocus: () => void;
  onWords: (text: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: (whole: boolean) => void;
}) {
  return (
    <div
      className={cn('diagram-row is-section', on && 'is-on')}
      data-item={itemKey(item)}
      onFocusCapture={onFocus}
    >
      <TextField
        aria-label="Section name"
        value={label}
        onValueChange={onWords}
        onKeyDown={rowKeys({ move: onMove })}
      />
      <div className="diagram-row-controls">
        <IconButton
          label="Move up"
          shortcut={keysLabel('Alt ↑')}
          icon={<ArrowUp />}
          size="xs"
          onClick={() => onMove(-1)}
        />
        <IconButton
          label="Move down"
          shortcut={keysLabel('Alt ↓')}
          icon={<ArrowDown />}
          size="xs"
          onClick={() => onMove(1)}
        />
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Remove the section" icon={<Trash2 />} size="xs" />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem shortcut={keysLabel('Delete')} onSelect={() => onRemove(false)}>
              Remove the section, keep its {holds}
            </MenuItem>
            <MenuItem
              danger
              shortcut={keysLabel('Mod Shift Delete')}
              onSelect={() => onRemove(true)}
            >
              Remove the section and its {holds}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

function TitleField({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (text: string) => void;
}) {
  return (
    <label className="diagram-field" data-item="title">
      <span>Title</span>
      <TextField value={value} placeholder="No title" onValueChange={onValueChange} />
    </label>
  );
}

// Timelines

export function TimelinePanel(props: PanelProps<Timeline>) {
  const { model, change, selection } = props;
  const { words, go, on, focus } = usePanel(props);
  const periodItem = (section: number, period: number): Item => ({
    kind: 'period',
    section,
    period,
  });
  const eventItem = (section: number, period: number, event: number): Item => ({
    kind: 'event',
    section,
    period,
    event,
  });
  /** A new period: after the selected one, at the end of the selected section, or last. */
  const newPeriod = () => {
    const sel = selection;
    const r =
      sel?.kind === 'period' || sel?.kind === 'event'
        ? addPeriod(model, sel.section, sel.period, 'after')
        : sel?.kind === 'section'
          ? addPeriod(model, sel.section, 0, 'end')
          : addPeriod(model, model.sections.length - 1, 0, 'end');
    go(r.model, periodItem(r.section, r.period), 'Added a period');
  };
  const removeSection = (s: number, whole: boolean) =>
    change(whole ? removeSectionWhole(model, s) : removeSectionKeep(model, s), {
      select: null,
      announce: whole
        ? 'Removed the section and its periods'
        : 'Removed the section; its periods stay',
    });

  return (
    <div className="diagram-panel">
      <Section title="Timeline">
        <TitleField value={model.title} onValueChange={words({ kind: 'title' })} />
      </Section>
      {model.sections.map((section, s) => (
        <Section key={s} title={section.label === null ? 'Before any section' : `Section ${s + 1}`}>
          {section.label !== null && (
            <SectionRow
              item={{ kind: 'section', section: s }}
              label={section.label}
              holds="periods"
              on={on({ kind: 'section', section: s })}
              onFocus={focus({ kind: 'section', section: s })}
              onWords={words({ kind: 'section', section: s })}
              onMove={(delta) => {
                const r = moveSection(model, s, delta);
                if (r) go(r.model, { kind: 'section', section: r.section });
              }}
              onRemove={(whole) => removeSection(s, whole)}
            />
          )}
          <ul className="diagram-rows" aria-label="Periods">
            {section.periods.map((period, p) => {
              const item = periodItem(s, p);
              const move = (delta: -1 | 1) => {
                const r = movePeriod(model, s, p, delta);
                if (r) go(r.model, periodItem(r.section, r.period));
              };
              return (
                <li
                  key={p}
                  className={cn('diagram-row is-period', on(item) && 'is-on')}
                  data-item={itemKey(item)}
                  onFocusCapture={focus(item)}
                >
                  <div className="diagram-message">
                    <TextField
                      multiline
                      aria-label="Period"
                      value={period.label}
                      placeholder="When"
                      onValueChange={words(item)}
                      onKeyDown={rowKeys({
                        add: () => {
                          const r = addPeriod(model, s, p, 'after');
                          go(r.model, periodItem(r.section, r.period), 'Added a period');
                        },
                        move,
                      })}
                    />
                    <ul className="diagram-events" aria-label="Events">
                      {period.events.map((event, e) => {
                        const it = eventItem(s, p, e);
                        return (
                          <li
                            key={e}
                            className={cn('diagram-message-line is-event', on(it) && 'is-on')}
                            data-item={itemKey(it)}
                            onFocusCapture={(ev) => {
                              ev.stopPropagation();
                              focus(it)();
                            }}
                          >
                            <TextField
                              multiline
                              aria-label="Event"
                              value={event}
                              onValueChange={words(it)}
                              onKeyDown={rowKeys({
                                add: () => {
                                  const r = addEvent(model, s, p, e, 'after');
                                  go(r.model, eventItem(s, p, r.event), 'Added an event');
                                },
                                move: (delta) => {
                                  const r = moveEvent(model, s, p, e, delta);
                                  if (r) go(r.model, eventItem(s, p, r.event));
                                },
                                remove: () =>
                                  go(
                                    removeEvent(model, s, p, e),
                                    e > 0 ? eventItem(s, p, e - 1) : item,
                                  ),
                              })}
                            />
                            <IconButton
                              label="Remove the event"
                              icon={<X />}
                              size="xs"
                              onClick={() =>
                                change(removeEvent(model, s, p, e), { select: selectionOf(item) })
                              }
                            />
                          </li>
                        );
                      })}
                    </ul>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const r = addEvent(model, s, p, 0, 'end');
                        go(r.model, eventItem(s, p, r.event), 'Added an event');
                      }}
                    >
                      <Plus aria-hidden /> Event
                    </Button>
                  </div>
                  <div className="diagram-row-controls">
                    <IconButton
                      label="Move up"
                      shortcut={keysLabel('Alt ↑')}
                      icon={<ArrowUp />}
                      size="xs"
                      onClick={() => move(-1)}
                    />
                    <IconButton
                      label="Move down"
                      shortcut={keysLabel('Alt ↓')}
                      icon={<ArrowDown />}
                      size="xs"
                      onClick={() => move(1)}
                    />
                    <IconButton
                      label="Duplicate"
                      shortcut={keysLabel('Mod D')}
                      icon={<Copy />}
                      size="xs"
                      onClick={() => {
                        const r = duplicatePeriod(model, s, p);
                        if (r) go(r.model, periodItem(r.section, r.period), 'Duplicated');
                      }}
                    />
                    <IconButton
                      label="Remove the period"
                      shortcut={keysLabel('Delete')}
                      icon={<Trash2 />}
                      size="xs"
                      onClick={() => change(removePeriod(model, s, p), { select: null })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
      <div className="diagram-actions px-4">
        <Button size="sm" onClick={newPeriod}>
          <Plus aria-hidden /> Period
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const after = selection && 'section' in selection ? selection.section : null;
            const r = addTimelineSection(model, after);
            go(r.model, { kind: 'section', section: r.section }, 'Added a section');
          }}
        >
          <Plus aria-hidden /> Section
        </Button>
      </div>
      <p className="diagram-hint">
        On the drawing: Enter adds a period or event after the selected one, Tab an event to a
        period, F2 or typing edits it. Press ? for every key.
      </p>
    </div>
  );
}

// Gantt charts

type Progress = 'todo' | 'active' | 'done';
const PROGRESS: { value: Progress; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
];
const progressOf = (task: GanttTask): Progress =>
  task.tags.includes('done') ? 'done' : task.tags.includes('active') ? 'active' : 'todo';

/** Tags in the order Mermaid expects them. */
const TAG_ORDER: GanttTag[] = ['done', 'active', 'crit', 'milestone'];
function withTags(task: GanttTask, progress: Progress, crit: boolean, milestone: boolean) {
  const tags = new Set<GanttTag>();
  if (progress !== 'todo') tags.add(progress);
  if (crit) tags.add('crit');
  if (milestone) tags.add('milestone');
  task.tags = TAG_ORDER.filter((t) => tags.has(t));
  if (milestone) task.end = { kind: 'duration', value: '0d' };
  else if (task.end.kind === 'duration' && Number.parseFloat(task.end.value) === 0) {
    task.end = { kind: 'duration', value: '1d' };
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const unitOf = (value: string) => value.replace(/^[\d.]+/, '') || 'd';

export function GanttPanel(props: PanelProps<Gantt>) {
  const { model, change, selection } = props;
  const { edit, words, go, on, focus } = usePanel(props);
  const isoDates = /^YYYY-MM-DD$/.test(model.dateFormat);
  const allTasks = model.sections.flatMap((x, si) => x.tasks.map((t, ti) => ({ t, si, ti })));
  const taskItem = (section: number, task: number): Item => ({ kind: 'task', section, task });
  const removeSection = (s: number, whole: boolean) =>
    change(whole ? removeSectionWhole(model, s) : removeSectionKeep(model, s), {
      select: null,
      announce: whole ? 'Removed the section and its tasks' : 'Removed the section; its tasks stay',
    });
  /**
   * A date field: a date picker for dates written as 2026-10-03, else as written (typing in
   * it is one step of the history).
   */
  const dateField = (
    label: string,
    value: string,
    set: (value: string, merge?: string) => void,
    merge: string,
  ) =>
    isoDates ? (
      <input
        type="date"
        aria-label={label}
        className="diagram-date"
        value={value}
        onChange={(e) => e.target.value && set(e.target.value)}
      />
    ) : (
      <Input aria-label={label} value={value} onChange={(e) => set(e.target.value, merge)} />
    );

  return (
    <div className="diagram-panel">
      <Section title="Gantt chart">
        <TitleField value={model.title} onValueChange={words({ kind: 'title' })} />
        <label className="diagram-switch">
          <Switch
            checked={model.excludesWeekends}
            onCheckedChange={(on) => edit((g) => (g.excludesWeekends = on))}
          />
          Leave out weekends
        </label>
      </Section>
      {model.sections.map((section, s) => (
        <Section key={s} title={section.label === null ? 'Tasks' : `Section ${s + 1}`}>
          {section.label !== null && (
            <SectionRow
              item={{ kind: 'section', section: s }}
              label={section.label}
              holds="tasks"
              on={on({ kind: 'section', section: s })}
              onFocus={focus({ kind: 'section', section: s })}
              onWords={words({ kind: 'section', section: s })}
              onMove={(delta) => {
                const r = moveSection(model, s, delta);
                if (r) go(r.model, { kind: 'section', section: r.section });
              }}
              onRemove={(whole) => removeSection(s, whole)}
            />
          )}
          <ul className="diagram-rows" aria-label="Tasks">
            {section.tasks.map((task, t) => {
              const item = taskItem(s, t);
              const first = allTasks.findIndex((x) => x.si === s && x.ti === t) === 0;
              const others = allTasks.filter((x) => !(x.si === s && x.ti === t));
              const progress = progressOf(task);
              const crit = task.tags.includes('crit');
              const milestone = task.tags.includes('milestone');
              const set = (apply: (target: GanttTask, g: Gantt) => void, merge?: string) =>
                edit((g) => apply(g.sections[s]!.tasks[t]!, g), merge);
              /** The id of another task, given one first when it has none. */
              const idOf = (g: Gantt, value: string) => {
                if (!value.startsWith('#')) return value;
                const [si, ti] = value.slice(1).split('.').map(Number);
                return taskId(g, g.sections[si!]!.tasks[ti!]!);
              };
              const otherOptions = others.map((x) => ({
                value: x.t.id ?? `#${x.si}.${x.ti}`,
                label: x.t.name || 'Untitled task',
              }));
              const move = (delta: -1 | 1) => {
                const r = moveTask(model, s, t, delta);
                if (r) go(r.model, taskItem(r.section, r.task));
              };
              return (
                <li
                  key={t}
                  className={cn('diagram-row is-task', on(item) && 'is-on')}
                  data-item={itemKey(item)}
                  onFocusCapture={focus(item)}
                >
                  <div className="diagram-message">
                    <TextField
                      aria-label="Task"
                      value={task.name}
                      onValueChange={words(item)}
                      onKeyDown={rowKeys({
                        add: () => {
                          const r = addTask(model, s, t, 'after');
                          go(r.model, taskItem(r.section, r.task), 'Added a task');
                        },
                        move,
                      })}
                    />
                    <div className="diagram-message-line">
                      <Select
                        aria-label="Progress"
                        value={progress}
                        options={PROGRESS}
                        onValueChange={(v) =>
                          set((x) => withTags(x, v as Progress, crit, milestone))
                        }
                      />
                      <button
                        type="button"
                        className="diagram-toggle"
                        aria-pressed={crit}
                        onClick={() => set((x) => withTags(x, progress, !crit, milestone))}
                      >
                        Critical
                      </button>
                      <button
                        type="button"
                        className="diagram-toggle"
                        aria-pressed={milestone}
                        onClick={() => set((x) => withTags(x, progress, crit, !milestone))}
                      >
                        Milestone
                      </button>
                    </div>
                    <div className="diagram-message-line">
                      <span className="diagram-word">Starts</span>
                      <Select
                        aria-label="Starts"
                        value={task.start.kind}
                        options={[
                          ...(!first ? [{ value: 'previous', label: 'after the task above' }] : []),
                          { value: 'date', label: 'on a date' },
                          ...(others.length ? [{ value: 'after', label: 'after a task' }] : []),
                        ]}
                        onValueChange={(v) =>
                          set((x, g) => {
                            if (v === 'date') x.start = { kind: 'date', value: today() };
                            else if (v === 'previous') x.start = { kind: 'previous' };
                            else
                              x.start = { kind: 'after', ids: [idOf(g, otherOptions[0]!.value)] };
                          })
                        }
                      />
                      {task.start.kind === 'date' &&
                        dateField(
                          'Start date',
                          task.start.value,
                          (value, merge) => set((x) => (x.start = { kind: 'date', value }), merge),
                          `start:${s}.${t}`,
                        )}
                      {task.start.kind === 'after' && (
                        <Select
                          aria-label="After task"
                          value={task.start.ids[0]!}
                          options={otherOptions}
                          onValueChange={(v) =>
                            set((x, g) => (x.start = { kind: 'after', ids: [idOf(g, v)] }))
                          }
                        />
                      )}
                    </div>
                    {!milestone && (
                      <div className="diagram-message-line">
                        <span className="diagram-word">Ends</span>
                        <Select
                          aria-label="Ends"
                          value={task.end.kind}
                          options={[
                            { value: 'duration', label: 'after' },
                            { value: 'date', label: 'on a date' },
                            ...(others.length
                              ? [{ value: 'until', label: 'when a task starts' }]
                              : []),
                          ]}
                          onValueChange={(v) =>
                            set((x, g) => {
                              if (v === 'duration') x.end = { kind: 'duration', value: '3d' };
                              else if (v === 'date') x.end = { kind: 'date', value: today() };
                              else
                                x.end = { kind: 'until', ids: [idOf(g, otherOptions[0]!.value)] };
                            })
                          }
                        />
                        {task.end.kind === 'duration' && (
                          <>
                            <NumberField
                              aria-label="Length"
                              className="diagram-length"
                              value={Number.parseFloat(task.end.value) || 0}
                              onValueChange={(n) =>
                                set(
                                  (x) =>
                                    (x.end = {
                                      kind: 'duration',
                                      value: `${n}${x.end.kind === 'duration' ? unitOf(x.end.value) : 'd'}`,
                                    }),
                                  `length:${s}.${t}`,
                                )
                              }
                            />
                            <Select
                              aria-label="Unit"
                              value={unitOf(task.end.value)}
                              options={[
                                { value: 'h', label: 'hours' },
                                { value: 'd', label: 'days' },
                                { value: 'w', label: 'weeks' },
                              ]}
                              onValueChange={(unit) =>
                                set((x) => {
                                  const n =
                                    x.end.kind === 'duration'
                                      ? Number.parseFloat(x.end.value) || 1
                                      : 1;
                                  x.end = { kind: 'duration', value: `${n}${unit}` };
                                })
                              }
                            />
                          </>
                        )}
                        {task.end.kind === 'date' &&
                          dateField(
                            'End date',
                            task.end.value,
                            (value, merge) => set((x) => (x.end = { kind: 'date', value }), merge),
                            `end:${s}.${t}`,
                          )}
                        {task.end.kind === 'until' && (
                          <Select
                            aria-label="Until task"
                            value={task.end.ids[0]!}
                            options={otherOptions}
                            onValueChange={(v) =>
                              set((x, g) => (x.end = { kind: 'until', ids: [idOf(g, v)] }))
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="diagram-row-controls">
                    <IconButton
                      label="Move up"
                      shortcut={keysLabel('Alt ↑')}
                      icon={<ArrowUp />}
                      size="xs"
                      onClick={() => move(-1)}
                    />
                    <IconButton
                      label="Move down"
                      shortcut={keysLabel('Alt ↓')}
                      icon={<ArrowDown />}
                      size="xs"
                      onClick={() => move(1)}
                    />
                    <IconButton
                      label="Duplicate"
                      shortcut={keysLabel('Mod D')}
                      icon={<Copy />}
                      size="xs"
                      onClick={() => {
                        const r = duplicateTask(model, s, t);
                        if (r) go(r.model, taskItem(r.section, r.task), 'Duplicated');
                      }}
                    />
                    <IconButton
                      label="Remove the task"
                      shortcut={keysLabel('Delete')}
                      icon={<Trash2 />}
                      size="xs"
                      onClick={() => change(removeTask(model, s, t), { select: null })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
      <div className="diagram-actions px-4">
        <Button
          size="sm"
          onClick={() => {
            const sel = selection;
            const r =
              sel?.kind === 'task'
                ? addTask(model, sel.section, sel.task, 'after')
                : sel?.kind === 'section'
                  ? addTask(model, sel.section, 0, 'end')
                  : addTask(model, model.sections.length - 1, 0, 'end');
            go(r.model, taskItem(r.section, r.task), 'Added a task');
          }}
        >
          <Plus aria-hidden /> Task
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const after = selection && 'section' in selection ? selection.section : null;
            const r = addGanttSection(model, after);
            go(r.model, { kind: 'section', section: r.section }, 'Added a section');
          }}
        >
          <Plus aria-hidden /> Section
        </Button>
      </div>
      <p className="diagram-hint">
        On the drawing: Enter adds a task after the selected one, Alt+↑ and Alt+↓ move it, F2 or
        typing renames it. Press ? for every key.
      </p>
    </div>
  );
}

// Pie charts

export function PiePanel(props: PanelProps<Pie>) {
  const { model, change, selection } = props;
  const { edit, words, go, on, focus } = usePanel(props);
  const total = model.slices.reduce((sum, x) => sum + Math.max(0, x.value), 0);
  const sliceItem = (index: number): Item => ({ kind: 'slice', index });
  return (
    <div className="diagram-panel">
      <Section title="Pie chart">
        <TitleField value={model.title} onValueChange={words({ kind: 'title' })} />
        <label className="diagram-switch">
          <Switch checked={model.showData} onCheckedChange={(v) => edit((p) => (p.showData = v))} />
          Show the values
        </label>
      </Section>
      <Section title="Slices">
        <ul className="diagram-rows" aria-label="Slices">
          {model.slices.map((slice, i) => {
            const item = sliceItem(i);
            const move = (delta: -1 | 1) => {
              const r = moveSlice(model, i, delta);
              if (r) go(r.model, sliceItem(r.index));
            };
            return (
              <li
                key={i}
                className={cn(
                  'diagram-row is-slice',
                  (on(item) || on({ kind: 'value', index: i })) && 'is-on',
                )}
                data-item={itemKey(item)}
                onFocusCapture={focus(item)}
              >
                <TextField
                  aria-label="Slice"
                  value={slice.label}
                  onValueChange={words(item)}
                  onKeyDown={rowKeys({
                    add: () => {
                      const r = addSlice(model, i, 'after');
                      go(r.model, sliceItem(r.index), 'Added a slice');
                    },
                    move,
                  })}
                />
                <NumberField
                  aria-label="Value"
                  className="diagram-slice-value"
                  value={slice.value}
                  onValueChange={(n) => edit((p) => (p.slices[i]!.value = n), `value:${i}`)}
                />
                <span className="diagram-word diagram-slice-share">
                  {total ? `${Math.round((Math.max(0, slice.value) / total) * 100)}%` : ''}
                </span>
                <div className="diagram-row-controls">
                  <IconButton
                    label="Move up"
                    shortcut={keysLabel('Alt ↑')}
                    icon={<ArrowUp />}
                    size="xs"
                    onClick={() => move(-1)}
                  />
                  <IconButton
                    label="Move down"
                    shortcut={keysLabel('Alt ↓')}
                    icon={<ArrowDown />}
                    size="xs"
                    onClick={() => move(1)}
                  />
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton label="More" icon={<MoreHorizontal />} size="xs" />
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem
                        icon={<Copy />}
                        shortcut={keysLabel('Mod D')}
                        onSelect={() => {
                          const r = duplicateSlice(model, i);
                          if (r) go(r.model, sliceItem(r.index), 'Duplicated');
                        }}
                      >
                        Duplicate
                      </MenuItem>
                      <MenuItem
                        icon={<Trash2 />}
                        danger
                        shortcut={keysLabel('Delete')}
                        onSelect={() => change(removeSlice(model, i), { select: null })}
                      >
                        Remove the slice
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </div>
              </li>
            );
          })}
        </ul>
        <Button
          size="sm"
          onClick={() => {
            const at =
              selection?.kind === 'slice' || selection?.kind === 'value' ? selection.index : null;
            const r = addSlice(model, at, 'after');
            go(r.model, sliceItem(r.index), 'Added a slice');
          }}
        >
          <Plus aria-hidden /> Slice
        </Button>
      </Section>
    </div>
  );
}
