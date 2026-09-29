/**
 * Small fuzzy matcher for the command palette and pickers: every query
 * character must appear in order. Higher scores for matches at the start,
 * at word starts and in unbroken runs. Returns null when there is no match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();

  const direct = t.indexOf(q);
  if (direct !== -1) {
    // A plain substring beats any scattered match; earlier and word-start is better.
    const wordStart = direct === 0 || !isWordChar(t[direct - 1]);
    return 1000 - direct + (wordStart ? 200 : 0);
  }

  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    const wordStart = found === 0 || !isWordChar(t[found - 1]);
    run = found === ti ? run + 1 : 0;
    score += 1 + run * 2 + (wordStart ? 6 : 0) - Math.min(found - ti, 5) * 0.5;
    ti = found + 1;
  }
  return score;
}

/** Filters and sorts items by fuzzy score, keeping the input order for ties. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}
