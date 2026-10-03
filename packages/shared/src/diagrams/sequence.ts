import {
  INDENT,
  keepEnds,
  readText,
  refuse,
  splitSource,
  writeBreaks,
  type FromOrigin,
  type FromSource,
  type ParseResult,
} from './common';
import { indentOf, modelOf, remembered, type Reading } from './source';

/*
 * Sequence diagrams (§9.4): participants, and the steps between them (messages, notes and
 * blocks such as loops and alternatives). Statements the model doesn't edit (activations,
 * boxes, creating and destroying participants, comments) stay where they were, as written.
 */

export type ParticipantKind = 'participant' | 'actor';

export interface Participant extends FromOrigin {
  id: string;
  label: string;
  kind: ParticipantKind;
}

/** Arrows as Mermaid writes them. */
export const SEQUENCE_ARROWS = [
  '->>',
  '-->>',
  '->',
  '-->',
  '-x',
  '--x',
  '-)',
  '--)',
  '<<->>',
  '<<-->>',
] as const;
export type SequenceArrow = (typeof SEQUENCE_ARROWS)[number];

export interface SequenceMessage extends FromOrigin {
  kind: 'message';
  from: string;
  to: string;
  arrow: SequenceArrow;
  text: string;
  /** `+` starts an activation on the receiver, `-` ends one on the sender. */
  activation: '+' | '-' | null;
}

export interface SequenceNote extends FromOrigin {
  kind: 'note';
  side: 'left of' | 'right of' | 'over';
  /** One participant, or two for a note over both. */
  of: string[];
  text: string;
}

export const SEQUENCE_BLOCKS = ['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect'] as const;
export type SequenceBlockKind = (typeof SEQUENCE_BLOCKS)[number];

/** The word that starts each further branch of a block. */
export const BRANCH_WORD: Partial<Record<SequenceBlockKind, string>> = {
  alt: 'else',
  par: 'and',
  critical: 'option',
};

export interface SequenceBranch extends FromOrigin {
  text: string;
  steps: SequenceStep[];
}

export interface SequenceBlock extends FromOrigin {
  kind: 'block';
  block: SequenceBlockKind;
  /** The first branch's text, then one per `else`/`and`/`option`. */
  branches: SequenceBranch[];
}

/** A statement kept as written, in its place. */
export interface SequenceRaw extends FromOrigin {
  kind: 'raw';
  text: string;
}

export type SequenceStep = SequenceMessage | SequenceNote | SequenceBlock | SequenceRaw;

export interface SequenceDiagram extends FromSource {
  type: 'sequence';
  head: string[];
  /** Statements before the participants: a title, accessibility text, `box`es are raw steps. */
  title: string | null;
  autonumber: boolean;
  participants: Participant[];
  steps: SequenceStep[];
}

const ARROW_PATTERN = SEQUENCE_ARROWS.slice()
  .sort((a, b) => b.length - a.length)
  .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const ID = '[^\\s:,;+\\-<>()]+(?:-[^\\s:,;+\\-<>()]+)*';
/** A message in pieces: indentation, `from->>to:`, the spaces after it, its text. */
const MESSAGE = new RegExp(
  `^(\\s*)((${ID})\\s*(${ARROW_PATTERN})\\s*([+-])?\\s*(${ID})\\s*:)(\\s*)(.*)$`,
);
const NOTE = /^(\s*)(note\s+(left of|right of|over)\s+([^:]+?)\s*:)(\s*)(.*)$/i;
const PARTICIPANT = /^(participant|actor)\s+(.+?)(\s+as(?:\s+(.*))?)?$/;

/*
 * Sequence text. `#` starts a comment and `;` ends a statement anywhere in a line, so both are
 * entities; so are spaces at either end, and a `wrap:` Mermaid would take for a setting.
 * Mermaid writes nothing for an empty text, title or `as`, so neither does Memora.
 */
const textOf = (text: string) =>
  keepEnds(
    writeBreaks(
      text
        .replace(/[#;]/g, (c) => (c === '#' ? '#35;' : '#59;'))
        .replace(/<(?=br\s*\/?>)/gi, '#lt;')
        .replace(/^((?:no)?wrap):/i, '$1#58;'),
    ),
  );
const titleOf = (text: string) => textOf(text).replace(/^:/, '#58;');

const readSequenceText = (raw: string) => readText(raw);

/** How a line of a list is written. */
export type ListEntry =
  | { kind: 'line'; text: string; role: 'other' | 'title' | 'autonumber' }
  | { kind: 'participant'; text: string; participant: number }
  | { kind: 'step'; step: number };

export interface StepList {
  entries: ListEntry[];
}

type StepLayout =
  /** A message's or note's line in pieces. */
  | { kind: 'said'; text: string; indent: string; head: string; gap: string }
  | { kind: 'raw'; text: string }
  | {
      kind: 'block';
      text: string;
      /** Each branch's line (null for the first, which is the block's), and its steps. */
      branches: { text: string | null; list: StepList }[];
      end: string;
    };

export interface SequenceLayout {
  was: SequenceDiagram;
  eol: string;
  firstLine: string;
  tail: string[];
  top: StepList;
  /** By step origin (numbered depth first). */
  steps: StepLayout[];
  /** The usual step of indentation into a block. */
  step: string;
}

const readSequenceCode = remembered((code: string): Reading<SequenceDiagram, SequenceLayout> => {
  const source = splitSource(code);
  if (!source) return refuse('The diagram is empty');
  if (!/^sequenceDiagram\b/.test(source.first)) {
    return refuse('This isn’t a sequence diagram', source.firstNumber);
  }
  const diagram: SequenceDiagram = {
    type: 'sequence',
    head: source.head,
    title: null,
    autonumber: false,
    participants: [],
    steps: [],
    source: code,
  };
  const layout: SequenceLayout = {
    was: diagram,
    eol: source.eol,
    firstLine: source.firstLine,
    tail: source.tail,
    top: { entries: [] },
    steps: [],
    step: INDENT,
  };
  const known = (id: string) => {
    if (!diagram.participants.some((p) => p.id === id)) {
      diagram.participants.push({
        id,
        label: id,
        kind: 'participant',
        origin: diagram.participants.length,
      });
    }
  };
  // The open blocks, innermost last; steps go into the last branch of the innermost.
  const open: {
    block: SequenceBlock;
    layout: Extract<StepLayout, { kind: 'block' }>;
    indent: string;
  }[] = [];
  const list = () => open.at(-1)?.layout.branches.at(-1)!.list ?? layout.top;
  const add = (step: SequenceStep, how: StepLayout) => {
    step.origin = layout.steps.length;
    layout.steps.push(how);
    const block = open.at(-1)?.block;
    (block ? block.branches.at(-1)!.steps : diagram.steps).push(step);
    list().entries.push({ kind: 'step', step: step.origin });
  };
  let anySteps = false;
  const steps: string[] = [];

  for (const { text: raw, number } of source.body) {
    const line = raw.trim();
    if (line === '') {
      list().entries.push({ kind: 'line', text: raw, role: 'other' });
      continue;
    }
    if (line.startsWith('%%')) {
      add({ kind: 'raw', text: line }, { kind: 'raw', text: raw });
      anySteps = true;
      continue;
    }
    if (line === 'autonumber') {
      diagram.autonumber = true;
      list().entries.push({ kind: 'line', text: raw, role: 'autonumber' });
      continue;
    }
    const title = /^title\s*:?\s*(.*)$/.exec(line);
    if (title && !anySteps && diagram.title === null) {
      diagram.title = readSequenceText(title[1]!);
      list().entries.push({ kind: 'line', text: raw, role: 'title' });
      continue;
    }
    const participant = PARTICIPANT.exec(line);
    if (participant) {
      const id = participant[2]!.trim();
      if (id.includes('@'))
        return refuse('The `@{ … }` participant syntax isn’t supported yet', number);
      // `participant A as` (with nothing after) is Mermaid's own empty name.
      const label = participant[3] !== undefined ? readSequenceText(participant[4] ?? '') : id;
      const kind = participant[1] as ParticipantKind;
      let existing = diagram.participants.find((p) => p.id === id);
      if (existing) {
        existing.label = label;
        existing.kind = kind;
      } else {
        existing = { id, label, kind, origin: diagram.participants.length };
        diagram.participants.push(existing);
      }
      list().entries.push({ kind: 'participant', text: raw, participant: existing.origin! });
      continue;
    }
    const message = MESSAGE.exec(raw);
    if (message) {
      const [, indent, head, from, arrow, activation, to, gap, text] = message;
      known(from!);
      known(to!);
      add(
        {
          kind: 'message',
          from: from!,
          to: to!,
          arrow: arrow as SequenceArrow,
          text: readSequenceText(text!),
          activation: (activation as '+' | '-' | undefined) ?? null,
        },
        { kind: 'said', text: raw, indent: indent!, head: head!, gap: gap! },
      );
      anySteps = true;
      continue;
    }
    const note = NOTE.exec(raw);
    if (note) {
      const [, indent, head, side, who, gap, text] = note;
      const of = who!.split(',').map((p) => p.trim());
      if (of.length > 2 || of.some((p) => !p))
        return refuse('A note names its participants oddly', number);
      of.forEach(known);
      add(
        {
          kind: 'note',
          side: side!.toLowerCase() as SequenceNote['side'],
          of,
          text: readSequenceText(text!),
        },
        { kind: 'said', text: raw, indent: indent!, head: head!, gap: gap! },
      );
      anySteps = true;
      continue;
    }
    const word = /^(\w+)\b\s*(.*)$/.exec(line);
    const keyword = word?.[1];
    if (keyword && (SEQUENCE_BLOCKS as readonly string[]).includes(keyword)) {
      const block: SequenceBlock = {
        kind: 'block',
        block: keyword as SequenceBlockKind,
        branches: [{ text: readSequenceText(word[2]!), steps: [], origin: 0 }],
      };
      const how: Extract<StepLayout, { kind: 'block' }> = {
        kind: 'block',
        text: raw,
        branches: [{ text: null, list: { entries: [] } }],
        end: '',
      };
      add(block, how);
      open.push({ block, layout: how, indent: indentOf(raw) });
      anySteps = true;
      continue;
    }
    if (keyword && ['else', 'and', 'option'].includes(keyword)) {
      const inner = open.at(-1);
      if (!inner || BRANCH_WORD[inner.block.block] !== keyword) {
        return refuse(`“${keyword}” isn’t inside a block it belongs to`, number);
      }
      inner.block.branches.push({
        text: readSequenceText(word![2]!),
        steps: [],
        origin: inner.block.branches.length,
      });
      inner.layout.branches.push({ text: raw, list: { entries: [] } });
      continue;
    }
    if (line === 'end') {
      // `box … end` is kept as raw lines; its `end` closes it as written.
      const inner = open.pop();
      if (inner) inner.layout.end = raw;
      else add({ kind: 'raw', text: line }, { kind: 'raw', text: raw });
      continue;
    }
    if (
      keyword &&
      [
        'activate',
        'deactivate',
        'create',
        'destroy',
        'box',
        'links',
        'link',
        'accTitle',
        'accDescr',
        'title',
      ].includes(keyword)
    ) {
      add({ kind: 'raw', text: line }, { kind: 'raw', text: raw });
      anySteps = true;
      continue;
    }
    return refuse(`Couldn’t read “${line.slice(0, 40)}”`, number);
  }
  if (open.length) return refuse('A block isn’t closed with “end”');
  // The usual step into a block, from the first block with a step in it.
  for (const how of layout.steps) {
    if (how.kind !== 'block') continue;
    const child = how.branches.flatMap((b) => b.list.entries).find((e) => e.kind === 'step');
    if (child?.kind !== 'step') continue;
    const inner = layout.steps[child.step]!;
    const own = indentOf(how.text);
    const theirs = indentOf(inner.text);
    if (theirs.length > own.length && theirs.startsWith(own)) {
      steps.push(theirs.slice(own.length));
      break;
    }
  }
  if (steps[0]) layout.step = steps[0];
  return { ok: true, model: diagram, layout };
});

/** Reads a sequence diagram from Mermaid code. */
export function parseSequence(code: string): ParseResult<SequenceDiagram> {
  return modelOf(readSequenceCode(code));
}

/** What the printer (`sequencePrint.ts`) writes with; not for use elsewhere. */
export const sequenceSyntax = { readSequenceCode, textOf, titleOf };
