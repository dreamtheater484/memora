import { parseRich, richToMarkdown, type PageType } from '@memora/shared';
import { diffLines, diffWords } from 'diff';

/*
 * What changed between two versions of a page (§9.7), line by line, with the changed words
 * marked within a changed line. Rich pages are compared as the Markdown they read as.
 */

export interface DiffPart {
  text: string;
  /** The words that changed within the line. */
  changed: boolean;
}

export type DiffRow =
  | { kind: 'same'; text: string }
  | { kind: 'removed' | 'added'; parts: DiffPart[] }
  /** Unchanged lines left out. */
  | { kind: 'gap'; lines: number };

export interface TextDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
}

/** A version's content as text to compare. */
export function comparableText(type: PageType, content: string): string {
  if (type === 'markdown') return content;
  const doc = parseRich(content);
  return doc ? richToMarkdown(doc).markdown : '';
}

const linesOf = (value: string) => value.replace(/\n$/, '').split('\n');

/** Pairs a removed line with the line that replaced it, marking the words that differ. */
function wordRows(before: string, after: string): [DiffRow, DiffRow] {
  const removed: DiffPart[] = [];
  const added: DiffPart[] = [];
  for (const part of diffWords(before, after)) {
    if (!part.added) removed.push({ text: part.value, changed: part.removed });
    if (!part.removed) added.push({ text: part.value, changed: part.added });
  }
  return [
    { kind: 'removed', parts: removed },
    { kind: 'added', parts: added },
  ];
}

const whole = (kind: 'removed' | 'added', text: string): DiffRow => ({
  kind,
  parts: [{ text, changed: false }],
});

/** Changes from `before` to `after`, with `context` unchanged lines kept around each. */
export function textDiff(before: string, after: string, context = 2): TextDiff {
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  const parts = diffLines(before, after);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (!part.added && !part.removed) {
      for (const text of linesOf(part.value)) rows.push({ kind: 'same', text });
      continue;
    }
    const next = parts[i + 1];
    if (part.removed && next?.added) {
      // A replacement: line by line, the words that changed.
      const gone = linesOf(part.value);
      const come = linesOf(next.value);
      removed += gone.length;
      added += come.length;
      const paired = Math.min(gone.length, come.length);
      const out: DiffRow[] = [];
      const ins: DiffRow[] = [];
      for (let j = 0; j < paired; j += 1) {
        const [r, a] = wordRows(gone[j]!, come[j]!);
        out.push(r);
        ins.push(a);
      }
      for (const text of gone.slice(paired)) out.push(whole('removed', text));
      for (const text of come.slice(paired)) ins.push(whole('added', text));
      rows.push(...out, ...ins);
      i += 1;
      continue;
    }
    const kind = part.added ? 'added' : 'removed';
    const lines = linesOf(part.value);
    if (kind === 'added') added += lines.length;
    else removed += lines.length;
    for (const text of lines) rows.push(whole(kind, text));
  }
  return { rows: collapse(rows, context), added, removed };
}

/** Leaves out unchanged lines further than `context` from a change. */
function collapse(rows: DiffRow[], context: number): DiffRow[] {
  const near = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.kind === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j += 1) {
      near[j] = true;
    }
  });
  const out: DiffRow[] = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    if (near[i]) {
      if (skipped) out.push({ kind: 'gap', lines: skipped });
      skipped = 0;
      out.push(row);
    } else skipped += 1;
  });
  if (skipped && out.length) out.push({ kind: 'gap', lines: skipped });
  return out;
}
