import type { RichNode } from '@memora/shared';
import { describe, expect, it } from 'vitest';
import {
  comparePage,
  compareRichBlocks,
  composeBlocks,
  compareBlocks,
  composeRichBlocks,
} from './compare';

const theirs = '# Trip\n\nTake the hammock.\n\n- Tickets\n';
const mine = '# Trip\n\nTake the bivvy.\n\n- Tickets\n- Maps\n';

describe('compare', () => {
  it('splits the two versions into shared text and changes', () => {
    expect(compareBlocks(theirs, mine)).toEqual([
      { kind: 'same', text: '# Trip\n\n' },
      { kind: 'change', theirs: 'Take the hammock.\n', mine: 'Take the bivvy.\n' },
      { kind: 'same', text: '\n- Tickets\n' },
      { kind: 'change', theirs: '', mine: '- Maps\n' },
    ]);
  });

  it('builds the text from a choice per change', () => {
    const blocks = compareBlocks(theirs, mine);
    expect(composeBlocks(blocks, ['mine', 'mine'])).toBe(mine);
    expect(composeBlocks(blocks, ['theirs', 'theirs'])).toBe(theirs);
    expect(composeBlocks(blocks, ['theirs', 'mine'])).toBe(
      '# Trip\n\nTake the hammock.\n\n- Tickets\n- Maps\n',
    );
    expect(composeBlocks(blocks, ['both', 'mine'])).toBe(
      '# Trip\n\nTake the hammock.\nTake the bivvy.\n\n- Tickets\n- Maps\n',
    );
  });

  it('keeps both sides on their own lines when the last line has no line break', () => {
    const blocks = compareBlocks('a\nold', 'a\nnew');
    expect(composeBlocks(blocks, ['both'])).toBe('a\nold\nnew');
  });
});

const para = (text: string): RichNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content });

describe('compare rich pages', () => {
  const theirs = doc(para('Trip'), para('Take the hammock.'), para('Tickets'));
  const mine = doc(para('Trip'), para('Take the bivvy.'), para('Tickets'), para('Maps'));

  it('compares block by block', () => {
    expect(compareRichBlocks(theirs, mine)).toEqual([
      { kind: 'same', nodes: [para('Trip')] },
      { kind: 'change', theirs: [para('Take the hammock.')], mine: [para('Take the bivvy.')] },
      { kind: 'same', nodes: [para('Tickets')] },
      { kind: 'change', theirs: [], mine: [para('Maps')] },
    ]);
  });

  it('builds the page from a choice per change', () => {
    const blocks = compareRichBlocks(theirs, mine);
    expect(composeRichBlocks(blocks, ['mine', 'mine'])).toEqual(mine);
    expect(composeRichBlocks(blocks, ['theirs', 'theirs'])).toEqual(theirs);
    expect(composeRichBlocks(blocks, ['both', 'theirs'])).toEqual(
      doc(para('Trip'), para('Take the hammock.'), para('Take the bivvy.'), para('Tickets')),
    );
    // Nothing chosen at all still leaves a page to type in.
    expect(composeRichBlocks(compareRichBlocks(doc(para('a')), doc(para('b'))), ['both'])).toEqual(
      doc(para('a'), para('b')),
    );
  });

  it('shows rich blocks as Markdown and saves the page as rich content', () => {
    const comparison = comparePage('rich', JSON.stringify(theirs), JSON.stringify(mine))!;
    expect(comparison.blocks[1]).toEqual({
      kind: 'change',
      theirs: 'Take the hammock.\n',
      mine: 'Take the bivvy.\n',
    });
    expect(JSON.parse(comparison.compose(['theirs', 'mine']))).toEqual(
      doc(para('Trip'), para('Take the hammock.'), para('Tickets'), para('Maps')),
    );
    expect(comparePage('rich', 'not json', JSON.stringify(mine))).toBeNull();
  });
});
