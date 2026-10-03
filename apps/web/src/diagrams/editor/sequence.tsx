import {
  BRANCH_WORD,
  SEQUENCE_BLOCKS,
  type SequenceArrow,
  type SequenceBlockKind,
  type SequenceDiagram,
  type SequenceMessage,
  type SequenceStep,
} from '@memora/shared';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  GitBranchPlus,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  MessageSquarePlus,
  Monitor,
  MoreHorizontal,
  Plus,
  Repeat,
  Reply,
  StickyNote,
  Trash2,
  User,
} from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Button,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  Switch,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { keysLabel } from '../../shell/shortcuts';
import { TextField } from './fields';
import { withText } from './labels';
import {
  BLOCK_TEXT,
  addBranch,
  addParticipant,
  duplicateStep,
  indentStep,
  insertAt,
  moveParticipant,
  moveStep,
  moveStepTo,
  newMessage,
  noteFor,
  outdentStep,
  removeBranch,
  removeParticipant,
  removeStep,
  replyTo,
  samePath,
  stepAt,
  stepRows,
  updateStep,
  wrapInBlock,
  type Slot,
  type StepPath,
  type StepRow,
} from './ops';
import { Section, type PanelProps } from './panel';
import { focusField, rowKeys } from './rows';
import { isSelected, itemKey, selectionOf, type Item } from './selection';

/*
 * Editing a sequence diagram (§9.4): its participants, and its steps as rows (messages,
 * notes and blocks such as loops and alternatives, whose steps are indented under them).
 * Clicking anything in the drawing selects its row; its words are edited in place by a
 * double-click, F2 or typing. Rows move with the buttons, Alt+↑ and Alt+↓ or by dragging,
 * into and out of blocks as they go; a new step goes after the selected one, or inside the
 * selected block.
 */

const ARROWS: { value: SequenceArrow; label: string }[] = [
  { value: '->>', label: 'Request' },
  { value: '-->>', label: 'Reply (dashed)' },
  { value: '-)', label: 'Async' },
  { value: '--)', label: 'Async, dashed' },
  { value: '->', label: 'Line' },
  { value: '-->', label: 'Dashed line' },
  { value: '-x', label: 'Lost' },
  { value: '--x', label: 'Lost, dashed' },
  { value: '<<->>', label: 'Both ways' },
  { value: '<<-->>', label: 'Both ways, dashed' },
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

/** A small picture of an arrow style. */
function ArrowGlyph({ arrow }: { arrow: SequenceArrow }) {
  const dashed = arrow.includes('--');
  const both = arrow.startsWith('<<');
  const end = arrow.endsWith('x')
    ? 'cross'
    : arrow.endsWith(')')
      ? 'open'
      : arrow.endsWith('>>')
        ? 'filled'
        : 'none';
  const head = (x: number, dir: 1 | -1) =>
    end === 'cross' ? (
      <path d={`M${x - 3} 7l6 6M${x - 3} 13l6-6`} />
    ) : end === 'open' ? (
      <path d={`M${x - 5 * dir} 6L${x} 10L${x - 5 * dir} 14`} fill="none" />
    ) : end === 'filled' ? (
      <path d={`M${x - 6 * dir} 6L${x} 10L${x - 6 * dir} 14Z`} fill="currentColor" />
    ) : null;
  return (
    <svg
      viewBox="0 0 28 20"
      width="28"
      height="20"
      aria-hidden
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <line x1="3" y1="10" x2="25" y2="10" strokeDasharray={dashed ? '3 2.5' : undefined} />
      {head(25, 1)}
      {both && head(3, -1)}
    </svg>
  );
}

/** The arrow's style and its activation, in one small menu between From and To. */
function ArrowMenu({
  step,
  people,
  onChange,
}: {
  step: SequenceMessage;
  people: (id: string) => string;
  onChange: (apply: (m: SequenceMessage) => void) => void;
}) {
  const name = ARROWS.find((a) => a.value === step.arrow)?.label ?? step.arrow;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="diagram-arrow-button"
          aria-label={`Arrow: ${name}${step.activation ? `, ${step.activation === '+' ? 'starts' : 'ends'} an activation` : ''}`}
          title={name}
        >
          <ArrowGlyph arrow={step.arrow} />
          {step.activation && <span className="diagram-activation">{step.activation}</span>}
        </button>
      </MenuTrigger>
      <MenuContent align="center">
        <MenuLabel>Arrow</MenuLabel>
        <MenuRadioGroup
          value={step.arrow}
          onValueChange={(v) => onChange((m) => (m.arrow = v as SequenceArrow))}
        >
          {ARROWS.map((a) => (
            <MenuRadioItem key={a.value} value={a.value}>
              <span className="inline-flex items-center gap-2">
                <ArrowGlyph arrow={a.value} /> {a.label}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Activation</MenuLabel>
        <MenuRadioGroup
          value={step.activation ?? 'none'}
          onValueChange={(v) =>
            onChange((m) => (m.activation = v === 'none' ? null : (v as '+' | '-')))
          }
        >
          <MenuRadioItem value="none">None</MenuRadioItem>
          <MenuRadioItem value="+">Start one on {people(step.to)}</MenuRadioItem>
          <MenuRadioItem value="-">End the one on {people(step.from)}</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/** Where a dragged row would land, from the row under the pointer. */
function slotAt(diagram: SequenceDiagram, row: StepRow, lower: boolean): Slot {
  const { path } = row;
  const container = path.slice(0, -1);
  const at = path.at(-1)!;
  if (row.kind === 'branch') return { container: [...path, row.branch], index: 0 };
  if (row.kind === 'end') {
    if (lower) return { container, index: at + 1 };
    const step = stepAt(diagram, path);
    const last = step?.kind === 'block' ? step.branches.length - 1 : 0;
    const steps = step?.kind === 'block' ? step.branches[last]!.steps.length : 0;
    return { container: [...path, last], index: steps };
  }
  if (!lower) return { container, index: at };
  if (row.step.kind === 'block') return { container: [...path, 0], index: 0 };
  return { container, index: at + 1 };
}

export function SequencePanel({
  model: diagram,
  change,
  selection,
  select,
  announce,
}: PanelProps<SequenceDiagram>) {
  const people = diagram.participants.map((p) => ({ value: p.id, label: p.label || p.id }));
  const nameOf = (id: string) => diagram.participants.find((p) => p.id === id)?.label || id;
  const rows = stepRows(diagram);
  const selectedPath = selection?.kind === 'step' ? selection.path : null;
  const stepItem = (path: StepPath): Item => ({ kind: 'step', path });
  const fieldOf = (item: Item) => `[data-item="${itemKey(item)}"] textarea`;

  /** A new step at a slot, selected, its words ready to type. */
  const insert = (step: SequenceStep, slot: Slot, message: string) => {
    const r = insertAt(diagram, step, slot);
    change(r.diagram, { select: stepItem(r.path), announce: message });
    focusField(fieldOf(stepItem(r.path)));
  };
  /** Where a new step goes: after the selected step, inside a selected block, or last. */
  const slot = (): Slot => {
    if (selection?.kind === 'step') {
      const step = stepAt(diagram, selection.path);
      if (step?.kind === 'block') {
        return { container: [...selection.path, 0], index: step.branches[0]!.steps.length };
      }
      return { container: selection.path.slice(0, -1), index: selection.path.at(-1)! + 1 };
    }
    if (selection?.kind === 'branch') {
      const step = stepAt(diagram, selection.path);
      const steps = step?.kind === 'block' ? step.branches[selection.branch]!.steps : [];
      return { container: [...selection.path, selection.branch], index: steps.length };
    }
    return { container: [], index: diagram.steps.length };
  };
  const selectedStep = selectedPath ? stepAt(diagram, selectedPath) : null;
  const edit = (path: StepPath, apply: (step: SequenceStep) => void) =>
    change(updateStep(diagram, path, apply));
  const words = (item: Item) => (text: string) =>
    change(withText(diagram, item, text), { merge: itemKey(item) });
  const moved = (r: { diagram: SequenceDiagram; path: StepPath }, message?: string) => {
    if (r.diagram === diagram) return;
    change(r.diagram, { select: stepItem(r.path), announce: message });
  };
  /** A step's field: Enter adds a message after it (inside a block: first in it), Alt+↑↓ move it. */
  const stepKeys = (path: StepPath, step: SequenceStep) =>
    rowKeys({
      add: () =>
        insert(
          newMessage(diagram, step),
          step.kind === 'block'
            ? { container: [...path, 0], index: 0 }
            : { container: path.slice(0, -1), index: path.at(-1)! + 1 },
          'Added a message',
        ),
      move: (delta) => {
        const r = moveStep(diagram, path, delta);
        moved(r);
        focusField(fieldOf(stepItem(r.path)));
      },
    });
  /** Working in a row selects what it edits (and marks it on the drawing). */
  const focusSelect = (item: Item) => () => {
    if (!isSelected(selection, item)) select(selectionOf(item));
  };

  // Dragging rows (by their grip) to move steps, into and out of blocks.
  const list = useRef<HTMLOListElement>(null);
  const [drop, setDrop] = useState<{ y: number; depth: number } | null>(null);
  const startDrag = (path: StepPath) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    let target: Slot | null = null;
    const where = (clientY: number) => {
      const elements = [...(list.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
      for (const element of elements) {
        const r = element.getBoundingClientRect();
        if (clientY < r.top || clientY > r.bottom) continue;
        const row = rows[Number(element.dataset.row)]!;
        const lower = clientY > r.top + r.height / 2;
        const outer = list.current!.getBoundingClientRect();
        return {
          slot: slotAt(diagram, row, lower),
          y: (lower ? r.bottom : r.top) - outer.top,
          depth: row.depth + (row.kind === 'step' && row.step.kind === 'block' && lower ? 1 : 0),
        };
      }
      return null;
    };
    const move = (ev: PointerEvent) => {
      const found = where(ev.clientY);
      target = found?.slot ?? null;
      setDrop(found ? { y: found.y, depth: found.depth } : null);
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setDrop(null);
      if (target) moved(moveStepTo(diagram, path, target), 'Moved the step');
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };

  const stepMenu = (path: StepPath, step: SequenceStep) => (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="More" icon={<MoreHorizontal />} size="xs" />
      </MenuTrigger>
      <MenuContent align="end">
        {step.kind === 'message' && (
          <MenuItem
            icon={<Reply />}
            shortcut={keysLabel('Tab')}
            onSelect={() =>
              insert(
                replyTo(step),
                { container: path.slice(0, -1), index: path.at(-1)! + 1 },
                'Added the reply',
              )
            }
          >
            Add the reply
          </MenuItem>
        )}
        <MenuItem
          icon={<StickyNote />}
          shortcut={keysLabel('Alt Enter')}
          onSelect={() =>
            insert(
              noteFor(step, diagram),
              { container: path.slice(0, -1), index: path.at(-1)! + 1 },
              'Added a note',
            )
          }
        >
          Add a note
        </MenuItem>
        <MenuItem
          icon={<Repeat />}
          shortcut={keysLabel('Mod Shift Enter')}
          onSelect={() => moved(wrapInBlock(diagram, path), 'Put it in a loop')}
        >
          Put it in a loop
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<IndentIncrease />}
          shortcut={keysLabel('Alt Shift →')}
          disabled={stepAt(diagram, [...path.slice(0, -1), path.at(-1)! - 1])?.kind !== 'block'}
          onSelect={() => moved(indentStep(diagram, path), 'Moved into the block')}
        >
          Into the block above
        </MenuItem>
        <MenuItem
          icon={<IndentDecrease />}
          shortcut={keysLabel('Alt Shift ←')}
          disabled={path.length < 3}
          onSelect={() => moved(outdentStep(diagram, path), 'Moved out of the block')}
        >
          Out of its block
        </MenuItem>
        <MenuItem
          icon={<Copy />}
          shortcut={keysLabel('Mod D')}
          onSelect={() => moved(duplicateStep(diagram, path), 'Duplicated')}
        >
          Duplicate
        </MenuItem>
      </MenuContent>
    </Menu>
  );

  return (
    <div className="diagram-panel">
      <Section title="Participants">
        <ul className="diagram-rows" aria-label="Participants">
          {diagram.participants.map((p, i) => {
            const item: Item = { kind: 'participant', id: p.id };
            return (
              <li
                key={p.id}
                data-item={itemKey(item)}
                className={cn(
                  'diagram-row is-participant',
                  selection?.kind === 'participant' && selection.id === p.id && 'is-on',
                )}
                onFocusCapture={focusSelect(item)}
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
                <TextField
                  multiline
                  aria-label="Participant’s name"
                  value={p.label}
                  onValueChange={words(item)}
                  onKeyDown={rowKeys({
                    add: () => {
                      const r = addParticipant(diagram, p.id);
                      const added: Item = { kind: 'participant', id: r.id };
                      change(r.diagram, { select: added, announce: 'Added a participant' });
                      focusField(fieldOf(added));
                    },
                    move: (delta) => {
                      change(moveParticipant(diagram, p.id, delta));
                      focusField(fieldOf(item));
                    },
                  })}
                />
                <IconButton
                  label="Move left"
                  shortcut={keysLabel('Alt ←')}
                  icon={<ArrowLeft />}
                  size="sm"
                  disabled={i === 0}
                  onClick={() => change(moveParticipant(diagram, p.id, -1))}
                />
                <IconButton
                  label="Move right"
                  shortcut={keysLabel('Alt →')}
                  icon={<ArrowRight />}
                  size="sm"
                  disabled={i === diagram.participants.length - 1}
                  onClick={() => change(moveParticipant(diagram, p.id, 1))}
                />
                <IconButton
                  label="Remove, with its messages"
                  icon={<Trash2 />}
                  size="sm"
                  onClick={() => {
                    change(removeParticipant(diagram, p.id), { select: null });
                    announce(`Removed ${p.label}`);
                  }}
                />
              </li>
            );
          })}
        </ul>
        <Button
          size="sm"
          onClick={() => {
            const after = selection?.kind === 'participant' ? selection.id : null;
            const r = addParticipant(diagram, after);
            const item: Item = { kind: 'participant', id: r.id };
            change(r.diagram, { select: item, announce: 'Added a participant' });
            focusField(fieldOf(item));
          }}
        >
          <Plus aria-hidden /> Add a participant
        </Button>
      </Section>

      <Section title="Steps">
        <ol className="diagram-rows" aria-label="Steps" ref={list}>
          {rows.map((row, r) => {
            const key = `${row.kind}:${row.path.join('.')}:${row.kind === 'branch' ? row.branch : ''}`;
            const indent = { paddingLeft: `${row.depth * 1}rem` };
            if (row.kind === 'end') {
              return (
                <li key={key} data-row={r} className="diagram-row is-end" style={indent}>
                  end
                </li>
              );
            }
            if (row.kind === 'branch') {
              const block = stepAt(diagram, row.path);
              if (block?.kind !== 'block') return null;
              const item: Item = { kind: 'branch', path: row.path, branch: row.branch };
              const on =
                selection?.kind === 'branch' &&
                samePath(selection.path, row.path) &&
                selection.branch === row.branch;
              return (
                <li
                  key={key}
                  data-row={r}
                  data-item={itemKey(item)}
                  className={cn('diagram-row is-branch', on && 'is-on')}
                  style={indent}
                  onFocusCapture={focusSelect(item)}
                  onClick={(e) => e.target === e.currentTarget && select(selectionOf(item))}
                >
                  <span className="diagram-word">{BRANCH_WORD[block.block]}</span>
                  <TextField
                    aria-label="Branch condition"
                    value={block.branches[row.branch]!.text}
                    placeholder="Condition"
                    onValueChange={words(item)}
                  />
                  <IconButton
                    label="Remove the branch (its steps stay)"
                    icon={<Trash2 />}
                    size="sm"
                    onClick={() =>
                      change(removeBranch(diagram, row.path, row.branch), {
                        select: stepItem(row.path),
                      })
                    }
                  />
                </li>
              );
            }
            const step = row.step;
            const item = stepItem(row.path);
            const on = samePath(selectedPath, row.path);
            return (
              <li
                key={key}
                data-row={r}
                data-item={itemKey(item)}
                className={cn('diagram-row', `is-${step.kind}`, on && 'is-on')}
                style={indent}
                onFocusCapture={focusSelect(item)}
              >
                <button
                  type="button"
                  className="diagram-grip"
                  aria-label="Drag to move"
                  tabIndex={-1}
                  onPointerDown={startDrag(row.path)}
                >
                  <GripVertical aria-hidden />
                </button>
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
                      <ArrowMenu
                        step={step}
                        people={nameOf}
                        onChange={(apply) =>
                          edit(row.path, (s) => s.kind === 'message' && apply(s))
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
                    <TextField
                      multiline
                      aria-label="Message"
                      value={step.text}
                      placeholder="Message"
                      onValueChange={words(item)}
                      onKeyDown={stepKeys(row.path, step)}
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
                    <TextField
                      multiline
                      aria-label="Note"
                      value={step.text}
                      placeholder="Note"
                      onValueChange={words(item)}
                      onKeyDown={stepKeys(row.path, step)}
                    />
                  </div>
                )}
                {step.kind === 'block' && (
                  <div className="diagram-message">
                    <div className="diagram-message-line">
                      <Select
                        aria-label="Kind of block"
                        value={step.block}
                        options={SEQUENCE_BLOCKS.map((b) => ({ value: b, label: BLOCK_NAMES[b] }))}
                        onValueChange={(v) =>
                          edit(row.path, (s) => {
                            if (s.kind !== 'block') return;
                            const was = s.block;
                            s.block = v as SequenceBlockKind;
                            // A highlight's words are its colour: a new kind gets words of its own.
                            if (was === 'rect' || s.block === 'rect')
                              s.branches[0]!.text = BLOCK_TEXT[s.block];
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
                      {BRANCH_WORD[step.block] && (
                        <IconButton
                          label={`Add an “${BRANCH_WORD[step.block]}” branch`}
                          icon={<GitBranchPlus />}
                          size="sm"
                          onClick={() => {
                            const next = addBranch(diagram, row.path);
                            const branch = step.branches.length;
                            const branchItem: Item = { kind: 'branch', path: row.path, branch };
                            change(next, { select: selectionOf(branchItem) });
                            focusField(fieldOf(branchItem));
                          }}
                        />
                      )}
                    </div>
                    <TextField
                      aria-label={step.block === 'rect' ? 'Colour' : 'Condition'}
                      value={step.branches[0]!.text}
                      placeholder={
                        step.block === 'rect' ? 'Colour, e.g. rgb(200, 220, 255)' : 'Condition'
                      }
                      onValueChange={words(item)}
                      onKeyDown={stepKeys(row.path, step)}
                    />
                  </div>
                )}
                {step.kind === 'raw' && <code className="diagram-raw">{step.text}</code>}
                <div className="diagram-row-controls">
                  <IconButton
                    label="Move up"
                    shortcut={keysLabel('Alt ↑')}
                    icon={<ArrowUp />}
                    size="xs"
                    onClick={() => moved(moveStep(diagram, row.path, -1))}
                  />
                  <IconButton
                    label="Move down"
                    shortcut={keysLabel('Alt ↓')}
                    icon={<ArrowDown />}
                    size="xs"
                    onClick={() => moved(moveStep(diagram, row.path, 1))}
                  />
                  {stepMenu(row.path, step)}
                  <IconButton
                    label={
                      step.kind === 'block'
                        ? 'Remove the block (its steps stay)'
                        : 'Remove the step'
                    }
                    icon={<Trash2 />}
                    size="xs"
                    onClick={() => change(removeStep(diagram, row.path), { select: null })}
                  />
                </div>
              </li>
            );
          })}
          {drop && (
            <li
              aria-hidden
              className="diagram-drop-line"
              style={{ top: drop.y - 1, left: `${0.4 + drop.depth}rem` }}
            />
          )}
        </ol>
        <div className="diagram-actions">
          <Button
            size="sm"
            onClick={() =>
              insert(
                newMessage(
                  diagram,
                  selectedStep,
                  selection?.kind === 'participant' ? selection.id : undefined,
                ),
                slot(),
                'Added a message',
              )
            }
          >
            <MessageSquarePlus aria-hidden /> Message
          </Button>
          <Button
            size="sm"
            onClick={() => insert(noteFor(selectedStep, diagram), slot(), 'Added a note')}
          >
            <StickyNote aria-hidden /> Note
          </Button>
          <Button
            size="sm"
            title={
              selectedPath ? 'Put the selected step in a loop' : 'Add a loop with a message in it'
            }
            onClick={() => {
              if (selectedPath && selectedStep) {
                moved(wrapInBlock(diagram, selectedPath), 'Put it in a loop');
                focusField(fieldOf(stepItem(selectedPath)));
                return;
              }
              const block: SequenceStep = {
                kind: 'block',
                block: 'loop',
                branches: [{ text: BLOCK_TEXT.loop, steps: [newMessage(diagram, null)] }],
              };
              insert(block, slot(), 'Added a loop');
            }}
          >
            <Repeat aria-hidden /> {selectedPath ? 'Put in a loop' : 'Loop'}
          </Button>
        </div>
        <Hint>
          New steps go after the selected one, or inside the selected block. Drag a row by its grip,
          or press Alt+↑ and Alt+↓, to move it, into and out of blocks.
        </Hint>
      </Section>

      <Section title="Options">
        <label className="diagram-field">
          <span>Title</span>
          <TextField
            value={diagram.title ?? ''}
            placeholder="No title"
            onValueChange={words({ kind: 'title' })}
            data-item={itemKey({ kind: 'title' })}
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

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="diagram-hint is-inline">{children}</p>
);
