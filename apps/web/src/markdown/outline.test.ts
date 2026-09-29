import { describe, expect, it } from 'vitest';
import { headingsOf, statsOf } from './outline';

describe('outline', () => {
  it('lists headings with their levels and lines, skipping code blocks', () => {
    const text = [
      '# Plan',
      '',
      'Intro',
      '',
      '## Steps ##',
      '',
      '```',
      '# not a heading',
      '```',
      '',
      'Setext title',
      '============',
      '',
      '### **Bold** [link](x)',
    ].join('\n');
    expect(headingsOf(text)).toEqual([
      { level: 1, text: 'Plan', line: 1 },
      { level: 2, text: 'Steps', line: 5 },
      { level: 1, text: 'Setext title', line: 11 },
      { level: 3, text: 'Bold link', line: 14 },
    ]);
  });
});

describe('word count', () => {
  it('counts words, not Markdown', () => {
    expect(statsOf('# Hello world\n\n- **one** two\n- [link text](http://x.y)')).toMatchObject({
      words: 6,
      minutes: 1,
    });
    expect(statsOf('')).toEqual({ words: 0, characters: 0, minutes: 0 });
    expect(statsOf('東京は日本').words).toBe(5);
    expect(statsOf('word '.repeat(460)).minutes).toBe(2);
  });
});
