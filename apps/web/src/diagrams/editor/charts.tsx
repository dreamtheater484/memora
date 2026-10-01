import type { Gantt, GanttTag, GanttTask, Pie, Timeline } from '@memora/shared';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { Button, IconButton, Input, Select, Switch } from '../../components/ui';
import { Section } from './flowchart';

/*
 * Timelines, Gantt charts and pie charts (§9.4), edited as small tables beside the drawing.
 */

const clone = <T,>(value: T): T => structuredClone(value);

function move<T>(list: T[], at: number, delta: -1 | 1) {
  const to = at + delta;
  if (to < 0 || to >= list.length) return;
  [list[at], list[to]] = [list[to]!, list[at]!];
}

interface Props<M> {
  model: M;
  change: (next: M, merge?: string) => void;
}

// Timelines

export function TimelinePanel({ model, change }: Props<Timeline>) {
  const edit = (apply: (t: Timeline) => void, merge?: string) => {
    const next = clone(model);
    apply(next);
    change(next, merge);
  };
  return (
    <div className="diagram-panel">
      <Section title="Timeline">
        <label className="diagram-field">
          <span>Title</span>
          <Input
            value={model.title}
            placeholder="No title"
            onChange={(e) => edit((t) => (t.title = e.target.value), 'title')}
          />
        </label>
      </Section>
      {model.sections.map((section, s) => (
        <Section key={s} title={section.label === null ? 'Before any section' : `Section ${s + 1}`}>
          {section.label !== null && (
            <div className="diagram-row">
              <Input
                aria-label="Section name"
                value={section.label}
                onChange={(e) =>
                  edit((t) => (t.sections[s]!.label = e.target.value), `section:${s}`)
                }
              />
              <IconButton
                label="Remove the section"
                icon={<Trash2 />}
                size="sm"
                onClick={() => edit((t) => t.sections.splice(s, 1))}
              />
            </div>
          )}
          <ul className="diagram-rows" aria-label="Periods">
            {section.periods.map((period, p) => (
              <li key={p} className="diagram-row is-period">
                <div className="diagram-message">
                  <div className="diagram-message-line">
                    <Input
                      aria-label="Period"
                      value={period.label}
                      placeholder="When"
                      onChange={(e) =>
                        edit(
                          (t) => (t.sections[s]!.periods[p]!.label = e.target.value),
                          `period:${s}.${p}`,
                        )
                      }
                    />
                    <IconButton
                      label="Move up"
                      icon={<ArrowUp />}
                      size="sm"
                      onClick={() => edit((t) => move(t.sections[s]!.periods, p, -1))}
                    />
                    <IconButton
                      label="Remove the period"
                      icon={<Trash2 />}
                      size="sm"
                      onClick={() => edit((t) => t.sections[s]!.periods.splice(p, 1))}
                    />
                  </div>
                  {period.events.map((event, e) => (
                    <div key={e} className="diagram-message-line is-event">
                      <Input
                        aria-label="Event"
                        value={event}
                        onChange={(ev) =>
                          edit(
                            (t) => (t.sections[s]!.periods[p]!.events[e] = ev.target.value),
                            `event:${s}.${p}.${e}`,
                          )
                        }
                      />
                      <IconButton
                        label="Remove the event"
                        icon={<X />}
                        size="sm"
                        onClick={() => edit((t) => t.sections[s]!.periods[p]!.events.splice(e, 1))}
                      />
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => edit((t) => t.sections[s]!.periods[p]!.events.push('Event'))}
                  >
                    <Plus aria-hidden /> Event
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            onClick={() =>
              edit((t) => t.sections[s]!.periods.push({ label: 'When', events: ['What happens'] }))
            }
          >
            <Plus aria-hidden /> Period
          </Button>
        </Section>
      ))}
      <div className="diagram-actions px-4">
        <Button
          size="sm"
          onClick={() =>
            edit((t) =>
              t.sections.push({
                label: `Section ${t.sections.filter((x) => x.label !== null).length + 1}`,
                periods: [{ label: 'When', events: ['What happens'] }],
              }),
            )
          }
        >
          <Plus aria-hidden /> Section
        </Button>
      </div>
    </div>
  );
}

// Gantt charts

type Status = 'todo' | GanttTag;
const STATUSES: { value: Status; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
  { value: 'crit', label: 'Critical' },
  { value: 'milestone', label: 'Milestone' },
];
const statusOf = (task: GanttTask): Status =>
  (['milestone', 'crit', 'done', 'active'] as const).find((t) => task.tags.includes(t)) ?? 'todo';

const today = () => new Date().toISOString().slice(0, 10);

/** An id for a task others can start after. */
function idFor(gantt: Gantt, task: GanttTask): string {
  if (task.id) return task.id;
  const used = new Set(gantt.sections.flatMap((s) => s.tasks.map((t) => t.id)).filter(Boolean));
  let i = 1;
  while (used.has(`t${i}`)) i += 1;
  task.id = `t${i}`;
  return task.id;
}

export function GanttPanel({ model, change }: Props<Gantt>) {
  const edit = (apply: (g: Gantt) => void, merge?: string) => {
    const next = clone(model);
    apply(next);
    change(next, merge);
  };
  const isoDates = /^YYYY-MM-DD$/.test(model.dateFormat);
  const allTasks = model.sections.flatMap((s, si) => s.tasks.map((t, ti) => ({ t, si, ti })));
  return (
    <div className="diagram-panel">
      <Section title="Gantt chart">
        <label className="diagram-field">
          <span>Title</span>
          <Input
            value={model.title}
            placeholder="No title"
            onChange={(e) => edit((g) => (g.title = e.target.value), 'title')}
          />
        </label>
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
            <div className="diagram-row">
              <Input
                aria-label="Section name"
                value={section.label}
                onChange={(e) =>
                  edit((g) => (g.sections[s]!.label = e.target.value), `section:${s}`)
                }
              />
              <IconButton
                label="Remove the section and its tasks"
                icon={<Trash2 />}
                size="sm"
                onClick={() => edit((g) => g.sections.splice(s, 1))}
              />
            </div>
          )}
          <ul className="diagram-rows" aria-label="Tasks">
            {section.tasks.map((task, t) => {
              const before = allTasks.findIndex((x) => x.si === s && x.ti === t);
              const startKind =
                task.start.kind === 'after'
                  ? 'after'
                  : task.start.kind === 'date'
                    ? 'date'
                    : 'previous';
              const others = allTasks.filter((x) => !(x.si === s && x.ti === t));
              return (
                <li key={t} className="diagram-row is-task">
                  <div className="diagram-message">
                    <div className="diagram-message-line">
                      <Input
                        aria-label="Task"
                        value={task.name}
                        onChange={(e) =>
                          edit(
                            (g) => (g.sections[s]!.tasks[t]!.name = e.target.value),
                            `task:${s}.${t}`,
                          )
                        }
                      />
                      <Select
                        aria-label="Status"
                        value={statusOf(task)}
                        options={STATUSES}
                        onValueChange={(v) =>
                          edit((g) => {
                            const target = g.sections[s]!.tasks[t]!;
                            target.tags = v === 'todo' ? [] : [v as GanttTag];
                            if (v === 'milestone') target.end = { kind: 'duration', value: '0d' };
                          })
                        }
                      />
                    </div>
                    <div className="diagram-message-line">
                      <Select
                        aria-label="Starts"
                        value={startKind}
                        options={[
                          ...(before > 0
                            ? [{ value: 'previous', label: 'After the task above' }]
                            : []),
                          { value: 'date', label: 'On a date' },
                          ...(others.length ? [{ value: 'after', label: 'After a task' }] : []),
                        ]}
                        onValueChange={(v) =>
                          edit((g) => {
                            const target = g.sections[s]!.tasks[t]!;
                            if (v === 'date') target.start = { kind: 'date', value: today() };
                            else if (v === 'previous') target.start = { kind: 'previous' };
                            else {
                              const other = others[0]!;
                              const id = idFor(g, g.sections[other.si]!.tasks[other.ti]!);
                              target.start = { kind: 'after', ids: [id] };
                            }
                          })
                        }
                      />
                      {task.start.kind === 'date' &&
                        (isoDates ? (
                          <input
                            type="date"
                            aria-label="Start date"
                            className="diagram-date"
                            value={task.start.value}
                            onChange={(e) =>
                              edit(
                                (g) =>
                                  (g.sections[s]!.tasks[t]!.start = {
                                    kind: 'date',
                                    value: e.target.value,
                                  }),
                              )
                            }
                          />
                        ) : (
                          <Input
                            aria-label="Start date"
                            value={task.start.value}
                            onChange={(e) =>
                              edit(
                                (g) =>
                                  (g.sections[s]!.tasks[t]!.start = {
                                    kind: 'date',
                                    value: e.target.value,
                                  }),
                                `start:${s}.${t}`,
                              )
                            }
                          />
                        ))}
                      {task.start.kind === 'after' && (
                        <Select
                          aria-label="After task"
                          value={`${task.start.ids[0]}`}
                          options={others.map((x) => ({
                            value: x.t.id ?? `#${x.si}.${x.ti}`,
                            label: x.t.name || 'Untitled task',
                          }))}
                          onValueChange={(v) =>
                            edit((g) => {
                              let id = v;
                              if (v.startsWith('#')) {
                                const [si, ti] = v.slice(1).split('.').map(Number);
                                id = idFor(g, g.sections[si!]!.tasks[ti!]!);
                              }
                              g.sections[s]!.tasks[t]!.start = { kind: 'after', ids: [id] };
                            })
                          }
                        />
                      )}
                    </div>
                    {statusOf(task) !== 'milestone' && (
                      <div className="diagram-message-line">
                        <span className="diagram-word">Takes</span>
                        <Input
                          aria-label="Length"
                          type="number"
                          min={0}
                          value={
                            task.end.kind === 'duration'
                              ? Number.parseFloat(task.end.value) || 0
                              : ''
                          }
                          placeholder={task.end.kind === 'date' ? task.end.value : ''}
                          onChange={(e) => {
                            const unit =
                              task.end.kind === 'duration'
                                ? task.end.value.replace(/^[\d.]+/, '') || 'd'
                                : 'd';
                            edit(
                              (g) =>
                                (g.sections[s]!.tasks[t]!.end = {
                                  kind: 'duration',
                                  value: `${e.target.value || 0}${unit}`,
                                }),
                              `length:${s}.${t}`,
                            );
                          }}
                        />
                        <Select
                          aria-label="Unit"
                          value={
                            task.end.kind === 'duration'
                              ? task.end.value.replace(/^[\d.]+/, '') || 'd'
                              : 'd'
                          }
                          options={[
                            { value: 'h', label: 'hours' },
                            { value: 'd', label: 'days' },
                            { value: 'w', label: 'weeks' },
                          ]}
                          onValueChange={(unit) =>
                            edit((g) => {
                              const target = g.sections[s]!.tasks[t]!;
                              const n =
                                target.end.kind === 'duration'
                                  ? Number.parseFloat(target.end.value) || 1
                                  : 1;
                              target.end = { kind: 'duration', value: `${n}${unit}` };
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                  <div className="diagram-row-controls">
                    <IconButton
                      label="Move up"
                      icon={<ArrowUp />}
                      size="sm"
                      onClick={() => edit((g) => move(g.sections[s]!.tasks, t, -1))}
                    />
                    <IconButton
                      label="Move down"
                      icon={<ArrowDown />}
                      size="sm"
                      onClick={() => edit((g) => move(g.sections[s]!.tasks, t, 1))}
                    />
                    <IconButton
                      label="Remove the task"
                      icon={<Trash2 />}
                      size="sm"
                      onClick={() => edit((g) => g.sections[s]!.tasks.splice(t, 1))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <Button
            size="sm"
            onClick={() =>
              edit((g) => {
                const list = g.sections[s]!.tasks;
                list.push({
                  name: 'New task',
                  tags: [],
                  id: null,
                  start:
                    list.length || allTasks.length
                      ? { kind: 'previous' }
                      : { kind: 'date', value: today() },
                  end: { kind: 'duration', value: '3d' },
                });
              })
            }
          >
            <Plus aria-hidden /> Task
          </Button>
        </Section>
      ))}
      <div className="diagram-actions px-4">
        <Button
          size="sm"
          onClick={() =>
            edit((g) =>
              g.sections.push({
                label: `Section ${g.sections.filter((x) => x.label !== null).length + 1}`,
                tasks: [
                  {
                    name: 'New task',
                    tags: [],
                    id: null,
                    start: allTasks.length
                      ? { kind: 'previous' }
                      : { kind: 'date', value: today() },
                    end: { kind: 'duration', value: '3d' },
                  },
                ],
              }),
            )
          }
        >
          <Plus aria-hidden /> Section
        </Button>
      </div>
    </div>
  );
}

// Pie charts

export function PiePanel({ model, change }: Props<Pie>) {
  const edit = (apply: (p: Pie) => void, merge?: string) => {
    const next = clone(model);
    apply(next);
    change(next, merge);
  };
  const total = model.slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  return (
    <div className="diagram-panel">
      <Section title="Pie chart">
        <label className="diagram-field">
          <span>Title</span>
          <Input
            value={model.title}
            placeholder="No title"
            onChange={(e) => edit((p) => (p.title = e.target.value), 'title')}
          />
        </label>
        <label className="diagram-switch">
          <Switch
            checked={model.showData}
            onCheckedChange={(on) => edit((p) => (p.showData = on))}
          />
          Show the values
        </label>
      </Section>
      <Section title="Slices">
        <ul className="diagram-rows" aria-label="Slices">
          {model.slices.map((slice, i) => (
            <li key={i} className="diagram-row is-slice">
              <Input
                aria-label="Slice"
                value={slice.label}
                onChange={(e) => edit((p) => (p.slices[i]!.label = e.target.value), `slice:${i}`)}
              />
              <Input
                aria-label="Value"
                type="number"
                min={0}
                className="diagram-slice-value"
                value={slice.value}
                onChange={(e) =>
                  edit((p) => (p.slices[i]!.value = Number(e.target.value) || 0), `value:${i}`)
                }
              />
              <span className="diagram-word diagram-slice-share">
                {total ? `${Math.round((Math.max(0, slice.value) / total) * 100)}%` : ''}
              </span>
              <IconButton
                label="Remove the slice"
                icon={<Trash2 />}
                size="sm"
                onClick={() => edit((p) => p.slices.splice(i, 1))}
              />
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          onClick={() =>
            edit((p) => p.slices.push({ label: `Slice ${p.slices.length + 1}`, value: 10 }))
          }
        >
          <Plus aria-hidden /> Slice
        </Button>
      </Section>
    </div>
  );
}
