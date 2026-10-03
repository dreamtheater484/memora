import { INDENT } from './common';
import {
  arrange,
  indentOf,
  originsOf,
  printChecked,
  sameJson,
  shiftLines,
  type Entry,
} from './source';
import {
  BRANCH_WORD,
  type ListEntry,
  type Participant,
  type SequenceDiagram,
  type SequenceLayout,
  type SequenceMessage,
  type SequenceNote,
  type SequenceRaw,
  type SequenceStep,
  type StepList,
  sequenceSyntax,
} from './sequence';

const { readSequenceCode, textOf, titleOf } = sequenceSyntax;

/*
 * Sequence diagrams written back as Mermaid code (§9.4), changing as little of the code they
 * were read from as possible. Apart from the reading, so that what only reads diagrams
 * (snippets, search) does not load the writing.
 */

const participantLine = (p: Participant) =>
  p.label === p.id
    ? `${p.kind} ${p.id}`
    : `${p.kind} ${p.id} as${p.label ? ` ${textOf(p.label)}` : ''}`;

const saidHead = (step: SequenceMessage | SequenceNote) =>
  step.kind === 'message'
    ? `${step.from}${step.arrow}${step.activation ?? ''}${step.to}:`
    : `Note ${step.side} ${step.of.join(',')}:`;

const branchLine = (word: string, text: string) => (text ? `${word} ${textOf(text)}` : word);

/** Every step, depth first (as numbered by `origin`). */
function allSteps(steps: SequenceStep[], out: SequenceStep[] = []): SequenceStep[] {
  for (const step of steps) {
    out.push(step);
    if (step.kind === 'block') for (const branch of step.branches) allSteps(branch.steps, out);
  }
  return out;
}

const sameSaid = (a: SequenceMessage | SequenceNote, b: SequenceStep) =>
  a.kind === 'message'
    ? b.kind === 'message' &&
      a.from === b.from &&
      a.to === b.to &&
      a.arrow === b.arrow &&
      a.activation === b.activation
    : b.kind === 'note' && a.side === b.side && sameJson(a.of, b.of);

/** The order participants appear in (declared or first named), as Mermaid places them. */
function appearing(diagram: SequenceDiagram): string[] {
  return diagram.participants.map((p) => p.id);
}

function writeSequence(
  diagram: SequenceDiagram,
  layout: SequenceLayout | null,
  declareAll = false,
): string {
  const was = layout?.was;
  const out = [layout?.firstLine ?? 'sequenceDiagram'];
  const wasSteps = was ? allSteps(was.steps) : [];
  const step = layout?.step ?? INDENT;
  const people = was
    ? originsOf(diagram.participants, was.participants.length, new Set())
    : diagram.participants.map(() => null);
  const byOrigin = new Map<number, Participant>();
  people.forEach((origin, i) => origin !== null && byOrigin.set(origin, diagram.participants[i]!));
  const declared = new Set<number>();
  const seenSteps = new Set<number>();
  const sameTitle = (diagram.title || null) === (was?.title ?? null);
  // Where new declarations go: after the last one at the top, before the first step.
  let anchor: number | null = null;
  let stepped = false;
  let inBox = 0;
  const topIndent = (() => {
    const first = layout?.top.entries.find((e) => e.kind !== 'line' || e.role !== 'other');
    if (!first || !layout) return INDENT;
    const text = first.kind === 'step' ? layout.steps[first.step]!.text : first.text;
    return indentOf(text) || INDENT;
  })();

  const writeEntry = (entry: ListEntry, top: boolean): string[] => {
    if (entry.kind === 'participant') {
      const p = byOrigin.get(entry.participant);
      if (!p) return [];
      const before = was!.participants[entry.participant]!;
      if (declareAll && top && !stepped && !inBox) return [];
      declared.add(entry.participant);
      if (top && !stepped && !inBox) anchor = out.length + 1;
      if (p.label === before.label && p.kind === before.kind) return [entry.text];
      return [indentOf(entry.text) + participantLine(p)];
    }
    if (entry.kind !== 'line') return [];
    if (entry.role === 'title') {
      if (sameTitle) return [entry.text];
      return diagram.title ? [`${indentOf(entry.text)}title ${titleOf(diagram.title)}`] : [];
    }
    if (entry.role === 'autonumber') return diagram.autonumber ? [entry.text] : [];
    return [entry.text];
  };

  /** A step's lines; a moved step is indented to `indent`. */
  const writeStep = (s: SequenceStep, origin: number | null, indent: string | null): string[] => {
    const how = origin === null ? undefined : layout?.steps[origin];
    const before = origin === null ? undefined : wasSteps[origin];
    if (!how || !before || before.kind !== s.kind) return fresh(s, indent ?? topIndent);
    if (s.kind === 'block' && how.kind === 'block' && before.kind === 'block') {
      const own = indentOf(how.text);
      const lines: string[] = [];
      lines.push(
        s.block === before.block && s.branches[0]!.text === before.branches[0]!.text
          ? how.text
          : own + branchLine(s.block, s.branches[0]!.text),
      );
      // Steps go in as the block's first step was, else one step in.
      const firstStep = how.branches.flatMap((b) => b.list.entries).find((e) => e.kind === 'step');
      const inner =
        firstStep?.kind === 'step' ? indentOf(layout!.steps[firstStep.step]!.text) : own + step;
      const branches = originsOf(s.branches, how.branches.length, new Set());
      s.branches.forEach((branch, b) => {
        const from = branches[b]!;
        if (b > 0) {
          const line = from !== null && from > 0 ? how.branches[from]!.text : null;
          const same =
            line !== null &&
            s.block === before.block &&
            branch.text === before.branches[from!]!.text;
          lines.push(same ? line! : own + branchLine(BRANCH_WORD[s.block] ?? 'else', branch.text));
        }
        const list = from === null ? null : how.branches[from]!.list;
        lines.push(...writeList(list, branch.steps, inner, false));
      });
      lines.push(how.end);
      return indent === null ? lines : shiftLines(lines, own, indent);
    }
    let text = how.text;
    if (s.kind === 'raw') {
      if (s.text !== (before as SequenceRaw).text) text = indentOf(how.text) + s.text;
    } else if (how.kind === 'said' && (s.kind === 'message' || s.kind === 'note')) {
      const said = before as SequenceMessage | SequenceNote;
      if (!sameSaid(s, said) || s.text !== said.text) {
        const head = sameSaid(s, said) ? how.head : saidHead(s);
        text = how.indent + head + (s.text ? (how.gap || ' ') + textOf(s.text) : '');
      }
    }
    return indent === null ? [text] : [indent + text.trimStart()];
  };

  /** A new step, written afresh. */
  const fresh = (s: SequenceStep, indent: string): string[] => {
    switch (s.kind) {
      case 'message':
      case 'note':
        return [indent + saidHead(s) + (s.text ? ` ${textOf(s.text)}` : '')];
      case 'raw':
        return [indent + s.text];
      case 'block': {
        const lines: string[] = [];
        s.branches.forEach((branch, b) => {
          const word = b === 0 ? s.block : (BRANCH_WORD[s.block] ?? 'else');
          lines.push(indent + branchLine(word, branch.text));
          lines.push(...writeList(null, branch.steps, indent + step, false));
        });
        lines.push(`${indent}end`);
        return lines;
      }
    }
  };

  const writeList = (
    list: StepList | null,
    steps: SequenceStep[],
    indent: string,
    top: boolean,
  ): string[] => {
    const lines: string[] = [];
    const keys = originsOf(steps, wasSteps.length, seenSteps);
    const entries: Entry[] = (list?.entries ?? []).map((e, i) =>
      e.kind === 'step' ? { key: e.step } : { line: i },
    );
    const emit = (more: string[]) => {
      if (top) out.push(...more);
      else lines.push(...more);
    };
    for (const placed of arrange(entries, keys)) {
      if (placed.kind === 'line') emit(writeEntry(list!.entries[placed.line]!, top));
      else if (placed.kind === 'item') {
        const s = steps[placed.item]!;
        if (top && (s.kind === 'message' || s.kind === 'note' || s.kind === 'block') && !stepped) {
          stepped = true;
          anchor ??= out.length;
        }
        if (top && s.kind === 'raw') {
          if (/^box\b/.test(s.text)) inBox += 1;
          else if (s.text === 'end' && inBox) inBox -= 1;
        }
        emit(writeStep(s, keys[placed.item]!, placed.kept ? null : indent));
      }
    }
    return lines;
  };

  writeList(layout?.top ?? null, diagram.steps, topIndent, true);
  anchor ??= out.length;

  // What the code didn't have: a title and numbering at the top, declarations at the anchor.
  // New participants, and named ones that had no declaration (or, to set their order, all).
  const add = diagram.participants
    .filter((p, i) => {
      const origin = people[i]!;
      const plain = p.label === p.id && p.kind === 'participant';
      return declareAll || origin === null || (!declared.has(origin) && !plain);
    })
    .map((p) => topIndent + participantLine(p));
  out.splice(anchor, 0, ...add);
  const top: string[] = [];
  if (
    diagram.title &&
    (!layout || !layout.top.entries.some((e) => e.kind === 'line' && e.role === 'title'))
  ) {
    top.push(`${topIndent}title ${titleOf(diagram.title)}`);
  }
  if (diagram.autonumber && !was?.autonumber) top.push(`${topIndent}autonumber`);
  out.splice(1, 0, ...top);
  const code = [...diagram.head, ...out, ...(layout?.tail ?? [])].join(layout?.eol ?? '\n');
  if (!declareAll && layout) {
    // Participants stand in the order they first appear; declare them when that changed.
    const again = readSequenceCode(code);
    if (again.ok && !sameJson(appearing(again.model), appearing(diagram))) {
      return writeSequence(diagram, layout, true);
    }
  }
  return code;
}

const stepMeaning = (s: SequenceStep): unknown => {
  switch (s.kind) {
    case 'message':
      return [s.kind, s.from, s.to, s.arrow, s.text, s.activation];
    case 'note':
      return [s.kind, s.side, s.of, s.text];
    case 'raw':
      return [s.kind, s.text];
    case 'block':
      return [s.kind, s.block, s.branches.map((b) => [b.text, b.steps.map(stepMeaning)])];
  }
};

/** What a sequence diagram means, without how its code is written (for comparing two). */
export const sequenceMeaning = (d: SequenceDiagram) => ({
  head: d.head,
  title: d.title || null,
  autonumber: d.autonumber,
  participants: d.participants.map((p) => [p.id, p.label, p.kind]),
  steps: d.steps.map(stepMeaning),
});

/** Writes a sequence diagram as Mermaid code. */
export function printSequence(diagram: SequenceDiagram): string {
  return printChecked(
    diagram,
    readSequenceCode,
    (d, layout) => writeSequence(d, layout),
    (a, b) => sameJson(sequenceMeaning(a), sequenceMeaning(b)),
  );
}
