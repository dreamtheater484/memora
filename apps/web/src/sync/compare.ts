import { diffLines } from 'diff';

/*
 * Compare (§9.6): the server's version and this browser's side by side, in blocks. Where they
 * differ, the user picks one side, or both; the result is saved as the page.
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
