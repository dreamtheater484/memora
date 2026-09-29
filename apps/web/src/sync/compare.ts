import { parseRich, richToMarkdown, type PageType, type RichNode } from '@memora/shared';
import { diffArrays, diffLines } from 'diff';

/*
 * Compare (§9.6): the server's version and this browser's side by side, in blocks. Where they
 * differ, the user picks one side, or both; the result is saved as the page. Markdown pages
 * are compared line by line, rich pages block by block (paragraphs, lists, tables…).
 */

export type Block =
  { kind: 'same'; text: string } | { kind: 'change'; theirs: string; mine: string };

export type Choice = 'mine' | 'theirs' | 'both';

export function compareBlocks(theirs: string, mine: string): Block[] {
  const blocks: Block[] = [];
  for (const part of diffLines(theirs, mine)) {
    if (!part.added && !part.removed) {
      blocks.push({ kind: 'same', text: part.value });
      continue;
    }
    let last = blocks.at(-1);
    if (last?.kind !== 'change') {
      last = { kind: 'change', theirs: '', mine: '' };
      blocks.push(last);
    }
    if (part.removed) last.theirs += part.value;
    else last.mine += part.value;
  }
  return blocks;
}

/** The text from the blocks and a choice per change (in order; mine by default). */
export function composeBlocks(blocks: Block[], choices: Choice[]): string {
  let change = 0;
  return blocks
    .map((block) => {
      if (block.kind === 'same') return block.text;
      const choice = choices[change++] ?? 'mine';
      if (choice === 'theirs') return block.theirs;
      if (choice === 'mine') return block.mine;
      // Both: theirs first, each ending its own line.
      const first =
        block.theirs && !block.theirs.endsWith('\n') ? `${block.theirs}\n` : block.theirs;
      return first + block.mine;
    })
    .join('');
}

/** A rich page's top-level blocks, compared by their content. */
export type RichBlock =
  { kind: 'same'; nodes: RichNode[] } | { kind: 'change'; theirs: RichNode[]; mine: RichNode[] };

export function compareRichBlocks(theirs: RichNode, mine: RichNode): RichBlock[] {
  const a = theirs.content ?? [];
  const b = mine.content ?? [];
  const blocks: RichBlock[] = [];
  let i = 0;
  let j = 0;
  for (const part of diffArrays(a.map(key), b.map(key))) {
    const count = part.count;
    if (!part.added && !part.removed) {
      blocks.push({ kind: 'same', nodes: b.slice(j, j + count) });
      i += count;
      j += count;
      continue;
    }
    let last = blocks.at(-1);
    if (last?.kind !== 'change') {
      last = { kind: 'change', theirs: [], mine: [] };
      blocks.push(last);
    }
    if (part.removed) {
      last.theirs.push(...a.slice(i, i + count));
      i += count;
    } else {
      last.mine.push(...b.slice(j, j + count));
      j += count;
    }
  }
  return blocks;
}

const key = (node: RichNode) => JSON.stringify(node);

export function composeRichBlocks(blocks: RichBlock[], choices: Choice[]): RichNode {
  let change = 0;
  const content = blocks.flatMap((block) => {
    if (block.kind === 'same') return block.nodes;
    const choice = choices[change++] ?? 'mine';
    if (choice === 'theirs') return block.theirs;
    if (choice === 'mine') return block.mine;
    return [...block.theirs, ...block.mine];
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

export interface PageComparison {
  /** What each block reads as (rich blocks as Markdown). */
  blocks: Block[];
  /** The page's content from a choice per change. */
  compose: (choices: Choice[]) => string;
}

/** Either kind of page, or null when a side can't be read as the page's kind. */
export function comparePage(type: PageType, theirs: string, mine: string): PageComparison | null {
  if (type === 'markdown') {
    const blocks = compareBlocks(theirs, mine);
    return { blocks, compose: (choices) => composeBlocks(blocks, choices) };
  }
  const a = parseRich(theirs);
  const b = parseRich(mine);
  if (!a || !b) return null;
  const rich = compareRichBlocks(a, b);
  const text = (nodes: RichNode[]) =>
    nodes.length ? `${richToMarkdown({ type: 'doc', content: nodes }).markdown}\n` : '';
  return {
    blocks: rich.map((block) =>
      block.kind === 'same'
        ? { kind: 'same', text: text(block.nodes) }
        : { kind: 'change', theirs: text(block.theirs), mine: text(block.mine) },
    ),
    compose: (choices) => JSON.stringify(composeRichBlocks(rich, choices)),
  };
}
