import { diff3Merge } from 'node-diff3';

/*
 * Three-way merging of Markdown text (D9, §9.6): two edits made from the same starting text
 * are combined when they don't touch the same words. Lines first; a region where both sides
 * changed the same lines is tried again word by word, since a Markdown paragraph is one line.
 */

export type MergeResult = { ok: true; text: string } | { ok: false };

/** Splits text into words and the whitespace between them, so joining gives it back exactly. */
const words = (text: string) => text.split(/(\s+)/);

function mergeParts(
  mine: string[],
  base: string[],
  theirs: string[],
  digIn: boolean,
): string[] | null {
  const out: string[] = [];
  for (const block of diff3Merge(mine, base, theirs, { excludeFalseConflicts: true })) {
    if (block.ok) {
      out.push(...block.ok);
      continue;
    }
    if (!digIn || !block.conflict) return null;
    const { a, o, b } = block.conflict;
    const merged = mergeParts(words(a.join('\n')), words(o.join('\n')), words(b.join('\n')), false);
    if (!merged) return null;
    out.push(...merged.join('').split('\n'));
  }
  return out;
}

/**
 * Combines `mine` and `theirs`, both changed from `base`. Fails when they changed the same
 * words differently, or both added different text at the same place.
 */
export function merge3(base: string, theirs: string, mine: string): MergeResult {
  if (mine === theirs || theirs === base) return { ok: true, text: mine };
  if (mine === base) return { ok: true, text: theirs };
  const lines = mergeParts(mine.split('\n'), base.split('\n'), theirs.split('\n'), true);
  return lines ? { ok: true, text: lines.join('\n') } : { ok: false };
}

/**
 * The smallest single replacement that turns `from` into `to`: the common start and end stay,
 * so an editor keeps the cursor and selection where they were.
 */
export function textChange(from: string, to: string): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < max - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  ) {
    end++;
  }
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}
