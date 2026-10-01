import { INDENT, decodeEntities, refuse, splitSource, withHead, type ParseResult } from './common';

/*
 * Sequence diagrams (§9.4): participants, and the steps between them (messages, notes and
 * blocks such as loops and alternatives). Statements the model doesn't edit (activations,
 * boxes, creating and destroying participants, comments) stay where they were, as written.
 */

export type ParticipantKind = 'participant' | 'actor';

export interface Participant {
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

export interface SequenceMessage {
  kind: 'message';
  from: string;
  to: string;
  arrow: SequenceArrow;
  text: string;
  /** `+` starts an activation on the receiver, `-` ends one on the sender. */
  activation: '+' | '-' | null;
}

export interface SequenceNote {
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

export interface SequenceBlock {
  kind: 'block';
  block: SequenceBlockKind;
  /** The first branch's text, then one per `else`/`and`/`option`. */
  branches: { text: string; steps: SequenceStep[] }[];
}

/** A statement kept as written, in its place. */
export interface SequenceRaw {
  kind: 'raw';
  text: string;
}

export type SequenceStep = SequenceMessage | SequenceNote | SequenceBlock | SequenceRaw;

export interface SequenceDiagram {
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
const MESSAGE = new RegExp(`^(${ID})\\s*(${ARROW_PATTERN})\\s*([+-])?\\s*(${ID})\\s*:(.*)$`);
const NOTE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:(.*)$/i;
const PARTICIPANT = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/;

/** Message and note text as written: `;` and `#` are entities. */
const writeText = (text: string) => text.replace(/[#;]/g, (c) => (c === '#' ? '#35;' : '#59;'));
const readText = (text: string) => decodeEntities(text.trim().replace(/<br\s*\/?>/gi, '\n'));

/** Reads a sequence diagram from Mermaid code. */
export function parseSequence(code: string): ParseResult<SequenceDiagram> {
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
  };
  const known = (id: string) => {
    if (!diagram.participants.some((p) => p.id === id)) {
      diagram.participants.push({ id, label: id, kind: 'participant' });
    }
  };
  // The open blocks, innermost last; steps go into the last branch of the innermost.
  const open: SequenceBlock[] = [];
  const add = (step: SequenceStep) => {
    const block = open.at(-1);
    (block ? block.branches.at(-1)!.steps : diagram.steps).push(step);
  };

  for (const { text: raw, number } of source.body) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('%%')) {
      add({ kind: 'raw', text: line });
      continue;
    }
    if (line === 'autonumber') {
      diagram.autonumber = true;
      continue;
    }
    const title = /^title\s*:?\s*(.*)$/.exec(line);
    if (title && !diagram.steps.length && diagram.title === null) {
      diagram.title = title[1]!.trim();
      continue;
    }
    const participant = PARTICIPANT.exec(line);
    if (participant) {
      const id = participant[2]!.trim();
      if (id.includes('@'))
        return refuse('The `@{ … }` participant syntax isn’t supported yet', number);
      const label = participant[3] ? readText(participant[3]) : id;
      const existing = diagram.participants.find((p) => p.id === id);
      if (existing) {
        existing.label = label;
        existing.kind = participant[1] as ParticipantKind;
      } else diagram.participants.push({ id, label, kind: participant[1] as ParticipantKind });
      continue;
    }
    const message = MESSAGE.exec(line);
    if (message) {
      const [, from, arrow, activation, to, text] = message;
      known(from!);
      known(to!);
      add({
        kind: 'message',
        from: from!,
        to: to!,
        arrow: arrow as SequenceArrow,
        text: readText(text!),
        activation: (activation as '+' | '-' | undefined) ?? null,
      });
      continue;
    }
    const note = NOTE.exec(line);
    if (note) {
      const of = note[2]!.split(',').map((p) => p.trim());
      if (of.length > 2 || of.some((p) => !p))
        return refuse('A note names its participants oddly', number);
      of.forEach(known);
      add({
        kind: 'note',
        side: note[1]!.toLowerCase() as SequenceNote['side'],
        of,
        text: readText(note[3]!),
      });
      continue;
    }
    const word = /^(\w+)\b\s*(.*)$/.exec(line);
    const keyword = word?.[1];
    if (keyword && (SEQUENCE_BLOCKS as readonly string[]).includes(keyword)) {
      const block: SequenceBlock = {
        kind: 'block',
        block: keyword as SequenceBlockKind,
        branches: [{ text: word[2]!.trim(), steps: [] }],
      };
      add(block);
      open.push(block);
      continue;
    }
    if (keyword && ['else', 'and', 'option'].includes(keyword)) {
      const block = open.at(-1);
      if (!block || BRANCH_WORD[block.block] !== keyword) {
        return refuse(`“${keyword}” isn’t inside a block it belongs to`, number);
      }
      block.branches.push({ text: word[2]!.trim(), steps: [] });
      continue;
    }
    if (line === 'end') {
      // `box … end` is kept as raw lines; its `end` closes it as written.
      if (open.length) open.pop();
      else add({ kind: 'raw', text: line });
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
      add({ kind: 'raw', text: line });
      continue;
    }
    return refuse(`Couldn’t read “${line.slice(0, 40)}”`, number);
  }
  if (open.length) return refuse('A block isn’t closed with “end”');
  return { ok: true, model: diagram };
}

const participantLine = (p: Participant) =>
  p.label === p.id
    ? `${p.kind} ${p.id}`
    : `${p.kind} ${p.id} as ${writeText(p.label).replace(/\n/g, '<br>')}`;

/** Writes a sequence diagram as Mermaid code. */
export function printSequence(diagram: SequenceDiagram): string {
  const out = ['sequenceDiagram'];
  const write = (depth: number, text: string) => out.push(INDENT.repeat(depth) + text);
  if (diagram.title) write(1, `title ${diagram.title}`);
  if (diagram.autonumber) write(1, 'autonumber');
  for (const p of diagram.participants) write(1, participantLine(p));
  const text = (t: string) => writeText(t).replace(/\n/g, '<br>');
  const steps = (list: SequenceStep[], depth: number) => {
    for (const step of list) {
      switch (step.kind) {
        case 'message':
          write(
            depth,
            `${step.from}${step.arrow}${step.activation ?? ''}${step.to}: ${text(step.text)}`,
          );
          break;
        case 'note':
          write(depth, `Note ${step.side} ${step.of.join(',')}: ${text(step.text)}`);
          break;
        case 'block':
          step.branches.forEach((branch, i) => {
            const word = i === 0 ? step.block : BRANCH_WORD[step.block]!;
            write(depth, branch.text ? `${word} ${branch.text}` : word);
            steps(branch.steps, depth + 1);
          });
          write(depth, 'end');
          break;
        case 'raw':
          write(depth, step.text);
          break;
      }
    }
  };
  steps(diagram.steps, 1);
  return withHead(diagram.head, out);
}
