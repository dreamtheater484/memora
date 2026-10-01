import {
  BRANCH_WORD,
  SEQUENCE_BLOCKS,
  type SequenceArrow,
  type SequenceBlockKind,
  type SequenceDiagram,
  type SequenceStep,
} from '@memora/shared';
import { ArrowDown, ArrowUp, Plus, Trash2, User, Monitor, GitBranchPlus } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Button, IconButton, Input, Select, Switch } from '../../components/ui';
import { cn } from '../../lib/cn';
import type { CanvasView } from './Canvas';
import { Section } from './flowchart';
import {
  addBranch,
  freshParticipant,
  insertStep,
  messagePaths,
  moveStep,
  notePaths,
  removeBranch,
  removeParticipant,
  removeStep,
  samePath,
  stepRows,
  updateStep,
  type StepPath,
} from './ops';

/*
 * Editing a sequence diagram (§9.4): its participants, and its steps as rows (messages,
 * notes and blocks such as loops and alternatives, whose steps are indented under them).
 * Clicking a participant, a message or a note in the drawing selects its row.
 */

export type SeqSelection =
  { kind: 'participant'; id: string } | { kind: 'step'; path: StepPath } | null;

export interface SeqEditorProps {
  diagram: SequenceDiagram;
  change: (next: SequenceDiagram, merge?: string) => void;
  selection: SeqSelection;
  select: (selection: SeqSelection) => void;
  announce: (message: string) => void;
}

const ARROWS: { value: SequenceArrow; label: string }[] = [
  { value: '->>', label: 'Request →' },
  { value: '-->>', label: 'Reply ⇢' },
  { value: '-)', label: 'Async →' },
  { value: '->', label: 'Line —' },
  { value: '-->', label: 'Dashed line ┄' },
  { value: '-x', label: 'Lost ✕' },
  { value: '--x', label: 'Dashed, lost ✕' },
  { value: '<<->>', label: 'Both ways ↔' },
];

const BLOCK_NAMES: Record<SequenceBlockKind, string> = {
  loop: 'Loop',
  alt: 'Alternatives',
  opt: 'Optional',
  par: 'In parallel',
  critical: 'Critical',
  break: 'Break',
  rect: 'Highlight',
};

export function SequenceOverlay({
  view,
  diagram,
  selection,
  select,
}: Pick<SeqEditorProps, 'diagram' | 'selection' | 'select'> & { view: CanvasView }) {
  const { svg, spotOf, place } = view;
  useEffect(() => {
    if (!svg) return;
    const click = (e: MouseEvent) => {
      const target = e.target as Element;
      const participant = target.closest('[data-et="participant"]');
      if (participant) {
        const id = participant.getAttribute('data-id');
        if (id) select({ kind: 'participant', id });
        return;
      }
      const messages = [...svg.querySelectorAll('[data-et="message"]')];
      const texts = [...svg.querySelectorAll('text.messageText')];
      const at = Math.max(
        messages.indexOf(target.closest('[data-et="message"]')!),
        texts.indexOf(target.closest('text.messageText')!),
      );
      if (at >= 0) {
        const path = messagePaths(diagram)[at];
        if (path) select({ kind: 'step', path });
        return;
      }
      const note = target.closest('[data-et="note"]');
      if (note) {
        const path =
          notePaths(diagram)[[...svg.querySelectorAll('[data-et="note"]')].indexOf(note)];
        if (path) select({ kind: 'step', path });
      }
    };
    svg.addEventListener('click', click);
    return () => svg.removeEventListener('click', click);
  }, [svg, diagram, select]);

  // Where the selected participant, message or note is, measured once per drawing.
  const spots = useMemo(() => {
    if (!svg || !selection) return [];
    if (selection.kind === 'participant') {
      return [
        ...svg.querySelectorAll(`[data-et="participant"][data-id="${CSS.escape(selection.id)}"]`),
      ].map(spotOf);
    }
    const m = messagePaths(diagram).findIndex((p) => samePath(p, selection.path));
    if (m >= 0) {
      const line = svg.querySelectorAll('[data-et="message"]')[m];
      const text = svg.querySelectorAll('text.messageText')[m];
      return [line, text].filter((e): e is Element => !!e).map(spotOf);
    }
    const n = notePaths(diagram).findIndex((p) => samePath(p, selection.path));
    const note = n >= 0 ? svg.querySelectorAll('[data-et="note"]')[n] : undefined;
    return note ? [spotOf(note)] : [];
  }, [svg, selection, diagram, spotOf]);

  if (!spots.length) return <div className="diagram-overlay" aria-hidden />;
  const rects = spots.map(place);
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return (
    <div className="diagram-overlay" aria-hidden>
      <div
        className="diagram-ring"
        style={{
          left: left - 5,
          top: top - 5,
          width: right - left + 10,
          height: bottom - top + 10,
        }}
      />
    </div>
  );
}

export function SequencePanel({ diagram, change, selection, select, announce }: SeqEditorProps) {
  const people = diagram.participants.map((p) => ({ value: p.id, label: p.label || p.id }));
  const rows = stepRows(diagram);
  const selectedPath = selection?.kind === 'step' ? selection.path : null;
  const first = diagram.participants[0]?.id ?? 'A';
  const second = diagram.participants[1]?.id ?? first;

  const add = (step: SequenceStep, message: string) => {
    const result = insertStep(diagram, step, selectedPath);
    change(result.diagram);
    select({ kind: 'step', path: result.path });
    announce(message);
  };
  const edit = (path: StepPath, apply: (step: SequenceStep) => void, merge?: string) =>
    change(updateStep(diagram, path, apply), merge);

  return (
    <div className="diagram-panel">
      <Section title="Participants">
        <ul className="diagram-rows" aria-label="Participants">
          {diagram.participants.map((p, i) => (
            <li
              key={p.id}
              className={cn(
                'diagram-row',
                selection?.kind === 'participant' && selection.id === p.id && 'is-on',
              )}
              onFocusCapture={() => select({ kind: 'participant', id: p.id })}
            >
              <IconButton
                label={
                  p.kind === 'actor' ? 'A person: make it a system' : 'A system: make it a person'
                }
                icon={p.kind === 'actor' ? <User /> : <Monitor />}
                size="sm"
                onClick={() => {
                  const next = structuredClone(diagram);
                  next.participants[i]!.kind = p.kind === 'actor' ? 'participant' : 'actor';
                  change(next);
                }}
              />
              <Input
                aria-label="Participant’s name"
                value={p.label}
                onChange={(e) => {
                  const next = structuredClone(diagram);
                  next.participants[i]!.label = e.target.value;
                  change(next, `participant:${p.id}`);
                }}
              />
              <IconButton
                label="Move left"
                icon={<ArrowUp />}
                size="sm"
                disabled={i === 0}
                onClick={() => {
                  const next = structuredClone(diagram);
                  const list = next.participants;
                  [list[i - 1], list[i]] = [list[i]!, list[i - 1]!];
                  change(next);
                }}
              />
              <IconButton
                label="Remove, with its messages"
                icon={<Trash2 />}
                size="sm"
                onClick={() => {
                  change(removeParticipant(diagram, p.id));
                  select(null);
                  announce(`Removed ${p.label}`);
                }}
              />
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          onClick={() => {
            const next = structuredClone(diagram);
            const id = freshParticipant(next);
            next.participants.push({
              id,
              label: `Participant ${next.participants.length + 1}`,
              kind: 'participant',
            });
            change(next);
            select({ kind: 'participant', id });
            announce('Added a participant');
          }}
        >
          <Plus aria-hidden /> Add a participant
        </Button>
      </Section>

      <Section title="Steps">
        <ol className="diagram-rows" aria-label="Steps">
          {rows.map((row) => {
            const key = `${row.kind}:${row.path.join('.')}:${row.kind === 'branch' ? row.branch : ''}`;
            const indent = { paddingLeft: `${row.depth * 1}rem` };
            if (row.kind === 'end') {
              return (
                <li key={key} className="diagram-row is-end" style={indent}>
                  end
                </li>
              );
            }
            if (row.kind === 'branch') {
              const block = rows.find((r) => r.kind === 'step' && samePath(r.path, row.path));
              const step =
                block?.kind === 'step' && block.step.kind === 'block' ? block.step : null;
              if (!step) return null;
              return (
                <li key={key} className="diagram-row is-branch" style={indent}>
                  <span className="diagram-word">{BRANCH_WORD[step.block]}</span>
                  <Input
                    aria-label="Branch condition"
                    value={step.branches[row.branch]!.text}
                    placeholder="Condition"
                    onChange={(e) =>
                      edit(
                        row.path,
                        (s) => {
                          if (s.kind === 'block') s.branches[row.branch]!.text = e.target.value;
                        },
                        `branch:${key}`,
                      )
                    }
                  />
                  <IconButton
                    label="Remove the branch"
                    icon={<Trash2 />}
                    size="sm"
                    onClick={() => change(removeBranch(diagram, row.path, row.branch))}
                  />
                </li>
              );
            }
            const step = row.step;
            const on = samePath(selectedPath, row.path);
            const controls = (
              <>
                <IconButton
                  label="Move up"
                  icon={<ArrowUp />}
                  size="sm"
                  onClick={() => {
                    const moved = moveStep(diagram, row.path, -1);
                    change(moved.diagram);
                    select({ kind: 'step', path: moved.path });
                  }}
                />
                <IconButton
                  label="Move down"
                  icon={<ArrowDown />}
                  size="sm"
                  onClick={() => {
                    const moved = moveStep(diagram, row.path, 1);
                    change(moved.diagram);
                    select({ kind: 'step', path: moved.path });
                  }}
                />
                <IconButton
                  label={
                    step.kind === 'block' ? 'Remove the block (its steps stay)' : 'Remove the step'
                  }
                  icon={<Trash2 />}
                  size="sm"
                  onClick={() => {
                    change(removeStep(diagram, row.path));
                    select(null);
                  }}
                />
              </>
            );
            return (
              <li
                key={key}
                className={cn('diagram-row', `is-${step.kind}`, on && 'is-on')}
                style={indent}
                onFocusCapture={() => select({ kind: 'step', path: row.path })}
              >
                {step.kind === 'message' && (
                  <div className="diagram-message">
                    <div className="diagram-message-line">
                      <Select
                        aria-label="From"
                        value={step.from}
                        options={people}
                        onValueChange={(v) =>
                          edit(row.path, (s) => s.kind === 'message' && (s.from = v))
                        }
                      />
                      <Select
                        aria-label="Arrow"
                        value={step.arrow}
                        options={ARROWS}
                        className="diagram-arrow"
                        onValueChange={(v) =>
                          edit(
                            row.path,
                            (s) => s.kind === 'message' && (s.arrow = v as SequenceArrow),
                          )
                        }
                      />
                      <Select
                        aria-label="To"
                        value={step.to}
                        options={people}
                        onValueChange={(v) =>
                          edit(row.path, (s) => s.kind === 'message' && (s.to = v))
                        }
                      />
                    </div>
                    <Input
                      aria-label="Message"
                      value={step.text}
                      placeholder="Message"
                      onChange={(e) =>
                        edit(
                          row.path,
                          (s) => s.kind === 'message' && (s.text = e.target.value),
                          `step:${key}`,
                        )
                      }
                    />
                  </div>
                )}
                {step.kind === 'note' && (
                  <div className="diagram-message">
                    <div className="diagram-message-line">
                      <Select
                        aria-label="Note placement"
                        value={step.side}
                        options={[
                          { value: 'left of', label: 'Left of' },
                          { value: 'right of', label: 'Right of' },
                          { value: 'over', label: 'Over' },
                        ]}
                        onValueChange={(v) =>
                          edit(row.path, (s) => {
                            if (s.kind !== 'note') return;
                            s.side = v as typeof s.side;
                            if (v !== 'over') s.of = s.of.slice(0, 1);
                          })
                        }
                      />
                      <Select
                        aria-label="Participant"
                        value={step.of[0]!}
                        options={people}
                        onValueChange={(v) =>
                          edit(row.path, (s) => s.kind === 'note' && (s.of[0] = v))
                        }
                      />
                      {step.side === 'over' && (
                        <Select
                          aria-label="And participant"
                          value={step.of[1] ?? '-'}
                          options={[{ value: '-', label: '(only one)' }, ...people]}
                          onValueChange={(v) =>
                            edit(row.path, (s) => {
                              if (s.kind === 'note')
                                s.of = v === '-' ? s.of.slice(0, 1) : [s.of[0]!, v];
                            })
                          }
                        />
                      )}
                    </div>
                    <Input
                      aria-label="Note"
                      value={step.text}
                      placeholder="Note"
                      onChange={(e) =>
                        edit(
                          row.path,
                          (s) => s.kind === 'note' && (s.text = e.target.value),
                          `step:${key}`,
                        )
                      }
                    />
                  </div>
                )}
                {step.kind === 'block' && (
                  <div className="diagram-message-line">
                    <Select
                      aria-label="Kind of block"
                      value={step.block}
                      options={SEQUENCE_BLOCKS.map((b) => ({ value: b, label: BLOCK_NAMES[b] }))}
                      onValueChange={(v) =>
                        edit(row.path, (s) => {
                          if (s.kind !== 'block') return;
                          s.block = v as SequenceBlockKind;
                          // Only some blocks have further branches.
                          if (!BRANCH_WORD[s.block] && s.branches.length > 1) {
                            s.branches = [
                              {
                                text: s.branches[0]!.text,
                                steps: s.branches.flatMap((b) => b.steps),
                              },
                            ];
                          }
                        })
                      }
                    />
                    <Input
                      aria-label="Block label"
                      value={step.branches[0]!.text}
                      placeholder={
                        step.block === 'rect' ? 'Colour, e.g. rgb(200, 220, 255)' : 'Condition'
                      }
                      onChange={(e) =>
                        edit(
                          row.path,
                          (s) => s.kind === 'block' && (s.branches[0]!.text = e.target.value),
                          `step:${key}`,
                        )
                      }
                    />
                    {BRANCH_WORD[step.block] && (
                      <IconButton
                        label={`Add an “${BRANCH_WORD[step.block]}” branch`}
                        icon={<GitBranchPlus />}
                        size="sm"
                        onClick={() => change(addBranch(diagram, row.path))}
                      />
                    )}
                  </div>
                )}
                {step.kind === 'raw' && <code className="diagram-raw">{step.text}</code>}
                <div className="diagram-row-controls">{controls}</div>
              </li>
            );
          })}
        </ol>
        <div className="diagram-actions">
          <Button
            size="sm"
            onClick={() =>
              add(
                {
                  kind: 'message',
                  from: first,
                  to: second,
                  arrow: '->>',
                  text: 'Message',
                  activation: null,
                },
                'Added a message',
              )
            }
          >
            <Plus aria-hidden /> Message
          </Button>
          <Button
            size="sm"
            onClick={() =>
              add({ kind: 'note', side: 'over', of: [first], text: 'Note' }, 'Added a note')
            }
          >
            <Plus aria-hidden /> Note
          </Button>
          <Button
            size="sm"
            onClick={() =>
              add(
                { kind: 'block', block: 'loop', branches: [{ text: 'Every time', steps: [] }] },
                'Added a block',
              )
            }
          >
            <Plus aria-hidden /> Block
          </Button>
        </div>
        <p className="diagram-hint">New steps go after the selected one, in its block.</p>
      </Section>

      <Section title="Options">
        <label className="diagram-field">
          <span>Title</span>
          <Input
            value={diagram.title ?? ''}
            placeholder="No title"
            onChange={(e) => change({ ...diagram, title: e.target.value || null }, 'title')}
          />
        </label>
        <label className="diagram-switch">
          <Switch
            checked={diagram.autonumber}
            onCheckedChange={(autonumber) => change({ ...diagram, autonumber })}
          />
          Number the messages
        </label>
      </Section>
    </div>
  );
}
