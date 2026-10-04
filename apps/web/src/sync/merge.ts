export { merge3, mergeContent, type MergeResult } from '@memora/shared';

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
