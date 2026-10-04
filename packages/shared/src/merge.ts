import { diff3Merge } from 'node-diff3';
import type { PageType } from './notes';

/*
 * Three-way merging of Markdown text (D9, §9.6): two edits made from the same starting text
 * are combined when they don't touch the same words. Lines first; a region where both sides
 * changed the same lines is tried again word by word, since a Markdown paragraph is one line.
 * The browser merges its edits with the server's this way, and sync merges one computer's with
 * another's (ADR 0006).
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
 * Merges a page's text by its type: Markdown word by word; a rich page's document is never
 * merged as text (Phase 7 compares rich pages block by block), so both edits make a conflict.
 */
export function mergeContent(
  type: PageType,
  base: string,
  theirs: string,
  mine: string,
): MergeResult {
  if (type === 'markdown') return merge3(base, theirs, mine);
  if (mine === theirs || theirs === base) return { ok: true, text: mine };
  if (mine === base) return { ok: true, text: theirs };
  return { ok: false };
}
