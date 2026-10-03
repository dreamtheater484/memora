import type { FromOrigin, FromSource, ParseResult } from './common';

/*
 * Printing with as few changes as possible (§3.4): what the printers of every diagram type
 * share. A printer reads the model's source again (remembered, so typing doesn't read the
 * same code twice), lays the model's items out against the statements they came from, and
 * checks what it wrote by reading it back; if that ever means something else, the diagram is
 * written afresh in the tidy layout instead.
 */

/** A deep copy of plain data (models are plain JSON). */
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A reading of code: the model, and how its code is laid out. */
export type Reading<M, L> =
  { ok: true; model: M; layout: L } | { ok: false; reason: string; line?: number };

/** Remembers the last few readings, by their code. */
export function remembered<T>(read: (code: string) => T, size = 6): (code: string) => T {
  const cache = new Map<string, T>();
  return (code) => {
    const hit = cache.get(code);
    if (hit !== undefined) {
      cache.delete(code);
      cache.set(code, hit);
      return hit;
    }
    const value = read(code);
    cache.set(code, value);
    while (cache.size > size) cache.delete(cache.keys().next().value!);
    return value;
  };
}

/** A model for the caller: a copy of the reading's, so the remembered one never changes. */
export function modelOf<M, L>(reading: Reading<M, L>): ParseResult<M> {
  return reading.ok ? { ok: true, model: copy(reading.model) } : reading;
}

/** How often each way of writing was taken (for tests: writing afresh should be rare). */
export const printCounts = { kept: 0, afresh: 0 };

/**
 * Writes a model: with as few changes to its source as possible when it has one, checked by
 * reading the result back; otherwise (or if that check fails) afresh.
 */
export function printChecked<M extends FromSource, L>(
  model: M,
  read: (code: string) => Reading<M, L>,
  write: (model: M, layout: L | null) => string,
  same: (a: M, b: M) => boolean,
): string {
  if (model.source !== undefined) {
    const base = read(model.source);
    if (base.ok) {
      const out = write(model, base.layout);
      const again = read(out);
      if (again.ok && same(again.model, model)) {
        printCounts.kept += 1;
        return out;
      }
    }
  }
  printCounts.afresh += 1;
  return write(model, null);
}

/**
 * The origins of a list's items that point at an item of the source (`count` of them) and
 * weren't used before, else null. `seen` is shared between the lists of one model, so an item
 * copied with its origin counts as new.
 */
export function originsOf(
  items: FromOrigin[],
  count: number,
  seen: Set<number>,
): (number | null)[] {
  return items.map((item) => {
    const origin = item.origin;
    if (typeof origin !== 'number' || !Number.isInteger(origin) || origin < 0 || origin >= count)
      return null;
    if (seen.has(origin)) return null;
    seen.add(origin);
    return origin;
  });
}

/** Which positions stay in order: a longest increasing subsequence (nulls never do). */
export function inOrder(positions: (number | null)[]): boolean[] {
  const tails: number[] = []; // indexes into positions
  const previous: number[] = positions.map(() => -1);
  positions.forEach((p, i) => {
    if (p === null) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (positions[tails[mid]!]! < p) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const kept = positions.map(() => false);
  let at = tails.length ? tails.at(-1)! : -1;
  while (at >= 0) {
    kept[at] = true;
    at = previous[at]!;
  }
  return kept;
}

/** One of a list's lines as written: an item (by its origin), or any other line. */
export type Entry = { key: number } | { line: number };

export type Placed =
  /** Another line of the list, where it was. */
  | { kind: 'line'; line: number }
  /** An item of the list now (by its index): `kept` when it stays where it was written. */
  | { kind: 'item'; item: number; kept: boolean }
  /** Where an item was written that isn't there now (removed, or moved elsewhere). */
  | { kind: 'gone'; key: number };

/**
 * Lays out a list's items among the list's lines: items still in their order stay where they
 * were; moved and new items go right after the item before them (or right before the first
 * item that stayed); with none staying, where the first item was, or at the end.
 */
export function arrange(entries: Entry[], keys: (number | null)[]): Placed[] {
  const at = new Map<number, number>();
  entries.forEach((e, i) => {
    if ('key' in e && !at.has(e.key)) at.set(e.key, i);
  });
  const positions = keys.map((k) => (k !== null && at.has(k) ? at.get(k)! : null));
  const kept = inOrder(positions);
  const keptAt = new Map<number, number>();
  kept.forEach((k, i) => k && keptAt.set(positions[i]!, i));
  const out: Placed[] = [];
  const loose = (from: number, to: number) => {
    for (let j = from; j < to; j += 1) out.push({ kind: 'item', item: j, kept: false });
  };
  const firstKept = kept.indexOf(true);
  if (firstKept < 0) {
    const first = entries.findIndex((e) => 'key' in e);
    entries.forEach((e, i) => {
      if (i === first) loose(0, keys.length);
      out.push('key' in e ? { kind: 'gone', key: e.key } : { kind: 'line', line: e.line });
    });
    if (first < 0) loose(0, keys.length);
    return out;
  }
  entries.forEach((e, i) => {
    if ('line' in e) {
      out.push({ kind: 'line', line: e.line });
      return;
    }
    const item = keptAt.get(i);
    if (item === undefined) {
      out.push({ kind: 'gone', key: e.key });
      return;
    }
    if (item === firstKept) loose(0, firstKept);
    out.push({ kind: 'item', item, kept: true });
    let next = item + 1;
    while (next < keys.length && !kept[next]) next += 1;
    loose(item + 1, next);
  });
  return out;
}

/** Pairs of equal strings kept from `before` in `after`, in order (a longest common subsequence). */
export function common(before: readonly string[], after: readonly string[]): [number, number][] {
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

/** A line's indentation. */
export const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0];

/** Moves lines indented under `from` to be indented under `to`, keeping what is deeper. */
export function shiftLines(lines: readonly string[], from: string, to: string): string[] {
  if (from === to) return [...lines];
  return lines.map((line) => {
    if (line.trim() === '') return line;
    const own = indentOf(line);
    const deeper = own.startsWith(from)
      ? own.slice(from.length)
      : ' '.repeat(Math.max(0, own.length - from.length));
    return to + deeper + line.slice(own.length);
  });
}

/** Extras compared regardless of order (where they sit doesn't change what they do). */
export const sameBag = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** Equal as JSON. */
export const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
