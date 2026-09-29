import { describe, expect, it } from 'vitest';
import { composeBlocks, compareBlocks } from './compare';

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
