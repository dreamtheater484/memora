import { describe, expect, it } from 'vitest';
import { comparableText, textDiff } from './diff';

describe('textDiff', () => {
  it('marks the words that changed in a changed line', () => {
    const { rows, added, removed } = textDiff(
      '# Trip\nTake the hammock.\n',
      '# Trip\nTake the bivvy.\n',
    );
    expect([added, removed]).toEqual([1, 1]);
    expect(rows).toEqual([
      { kind: 'same', text: '# Trip' },
      {
        kind: 'removed',
        parts: [
          { text: 'Take the ', changed: false },
          { text: 'hammock', changed: true },
          { text: '.', changed: false },
        ],
      },
      {
        kind: 'added',
        parts: [
          { text: 'Take the ', changed: false },
          { text: 'bivvy', changed: true },
          { text: '.', changed: false },
        ],
      },
    ]);
  });

  it('leaves out unchanged lines away from the changes', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'line ten');
    const { rows } = textDiff(before, after);
    expect(rows[0]).toEqual({ kind: 'gap', lines: 8 });
    expect(rows.filter((r) => r.kind === 'same')).toHaveLength(4);
    expect(rows.at(-1)).toEqual({ kind: 'gap', lines: 7 });
  });

  it('counts whole lines added and removed, and nothing when nothing changed', () => {
    expect(textDiff('a\n', 'a\nb\nc\n')).toMatchObject({ added: 2, removed: 0 });
    expect(textDiff('a\nb\n', 'a\n')).toMatchObject({ added: 0, removed: 1 });
    expect(textDiff('same\n', 'same\n')).toEqual({ rows: [], added: 0, removed: 0 });
  });

  it('compares rich pages as Markdown', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
      ],
    });
    expect(comparableText('rich', doc)).toBe('## Plan');
    expect(comparableText('rich', 'not a document')).toBe('');
    expect(comparableText('markdown', '# Plan')).toBe('# Plan');
  });
});
