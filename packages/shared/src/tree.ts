import { diagramText } from './diagrams';
import { SNIPPET_LENGTH, bySortKey, keysBetween } from './notes';

/*
 * Pure helpers for ordered hierarchies (section groups, pages). The server uses them to check
 * moves; the web app uses them to show a change before the server confirms it.
 */

export interface Sortable {
  id: string;
  sortKey: string;
}

/**
 * Sort keys for `n` items placed before `beforeId` among `siblings`, or after the last one when
 * `beforeId` is null. Undefined when `beforeId` isn't one of the siblings.
 */
export function placeKeys(
  siblings: readonly Sortable[],
  beforeId: string | null,
  n = 1,
): string[] | undefined {
  const sorted = [...siblings].sort(bySortKey);
  const index = beforeId === null ? sorted.length : sorted.findIndex((s) => s.id === beforeId);
  if (index < 0) return undefined;
  return keysBetween(sorted[index - 1]?.sortKey ?? null, sorted[index]?.sortKey ?? null, n);
}

/** Each parent's children in order; top-level items are under `null`. */
export function childrenByParent<T extends Sortable>(
  items: readonly T[],
  parentOf: (item: T) => string | null,
): Map<string | null, T[]> {
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    const parent = parentOf(item);
    const list = children.get(parent);
    if (list) list.push(item);
    else children.set(parent, [item]);
  }
  for (const list of children.values()) list.sort(bySortKey);
  return children;
}

/** The item and everything below it, each parent before its children, in list order. */
export function subtreeOf<T extends { id: string }>(
  children: ReadonlyMap<string | null, readonly T[]>,
  root: T,
): T[] {
  const result: T[] = [];
  const visit = (item: T) => {
    result.push(item);
    for (const child of children.get(item.id) ?? []) visit(child);
  };
  visit(root);
  return result;
}

/** Levels from the item down to its deepest descendant: 1 for an item without children. */
export function heightOf(
  children: ReadonlyMap<string | null, readonly { id: string }[]>,
  id: string,
): number {
  let height = 0;
  for (const child of children.get(id) ?? [])
    height = Math.max(height, heightOf(children, child.id));
  return height + 1;
}

/** 1 for a top-level item, 2 for its child, and so on; 0 for `null` (the top level itself). */
export function depthOf<T>(
  byId: ReadonlyMap<string, T>,
  id: string | null,
  parentOf: (item: T) => string | null,
): number {
  let depth = 0;
  for (let current = id; current !== null; depth += 1) {
    const item = byId.get(current);
    if (!item) break;
    current = parentOf(item);
  }
  return depth;
}

/** True when `id` is `ancestorId` or lies below it. */
export function isWithin<T>(
  byId: ReadonlyMap<string, T>,
  id: string | null,
  ancestorId: string,
  parentOf: (item: T) => string | null,
): boolean {
  for (let current = id; current !== null;) {
    if (current === ancestorId) return true;
    const item = byId.get(current);
    if (!item) return false;
    current = parentOf(item);
  }
  return false;
}

/** A ```mermaid block: its code is the third group. */
const DIAGRAM_FENCE =
  /^( {0,3})(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n([\s\S]*?)\n {0,3}\2[`~]*[ \t]*$/gm;

/**
 * Plain text of a Markdown page, for snippets and search: formatting marks, link targets and
 * HTML tags go, the words stay. Deliberately rough; it never needs to round-trip.
 */
export function markdownToText(markdown: string): string {
  // Escaped characters (`\#`, `\*`) are just characters: set aside, so no rule below sees them.
  const escaped: string[] = [];
  return (
    markdown
      // A diagram's words, not its code.
      .replace(DIAGRAM_FENCE, (_, _indent: string, _fence: string, code: string) =>
        diagramText(code),
      )
      .replace(
        /\\([\\`*_{}[\]()#+\-.!|~$<>])/g,
        (_, c: string) => `\uE000${escaped.push(c) - 1}\uE001`,
      )
      .replace(/^\s*(```|~~~).*$/gm, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, target: string, label?: string) =>
        (label ?? target).trim(),
      )
      .replace(/^\s{0,3}(?:>\s?)+/gm, '')
      // An alert's kind (`> [!NOTE]`) is a marker, not words of the page.
      .replace(/^\s*\[!(?:note|tip|important|warning|caution)\][ \t]*$/gim, '')
      // Tables: the cells' words, without the pipes and the alignment row.
      .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+(?:[ \t]*:?-{3,}:?[ \t]*)?$/gm, '')
      .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, cells: string) =>
        cells
          .split('|')
          .map((cell) => cell.trim())
          .join(' '),
      )
      .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
      .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
      .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/gm, '$1$2')
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/\uE000(\d+)\uE001/g, (_, i: string) => escaped[Number(i)] ?? '')
  );
}

/** The start of a page's text, on one line, for the page list. */
export const snippetOf = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH);
