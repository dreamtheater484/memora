import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';
import { initials, nameHue } from './names';

describe('fuzzyScore', () => {
  it('matches everything for an empty query', () => {
    expect(fuzzyScore('  ', 'Anything')).toBe(0);
  });

  it('needs every character in order', () => {
    expect(fuzzyScore('rdmp', 'Q4 roadmap')).not.toBeNull();
    expect(fuzzyScore('pmdr', 'Q4 roadmap')).toBeNull();
  });

  it('ranks substrings above scattered matches, and word starts above the middle', () => {
    const substring = fuzzyScore('road', 'Q4 roadmap')!;
    const scattered = fuzzyScore('rdmp', 'Q4 roadmap')!;
    const middle = fuzzyScore('oad', 'Q4 roadmap')!;
    expect(substring).toBeGreaterThan(scattered);
    expect(substring).toBeGreaterThan(middle);
  });

  it('ignores case', () => {
    expect(fuzzyScore('ROAD', 'Q4 roadmap')).toBe(fuzzyScore('road', 'q4 ROADMAP'));
  });
});

describe('fuzzyFilter', () => {
  const items = ['Launch checklist', 'Q4 roadmap', 'Retro — September', 'Roadmap archive'];

  it('drops non-matches and sorts by score, keeping ties in input order', () => {
    expect(fuzzyFilter(items, 'roadmap', (s) => s)).toEqual(['Roadmap archive', 'Q4 roadmap']);
  });

  it('returns a copy of everything for an empty query', () => {
    const out = fuzzyFilter(items, '', (s) => s);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });
});

describe('names', () => {
  it('takes the first letters of the first and last word', () => {
    expect(initials('Alex Morgan')).toBe('AM');
    expect(initials('  priya  van der rao ')).toBe('PR');
    expect(initials('Jo')).toBe('J');
    expect(initials('')).toBe('?');
  });

  it('gives a stable hue per name', () => {
    expect(nameHue('Sam Kaur')).toBe(nameHue('Sam Kaur'));
    expect(nameHue('Sam Kaur')).toBeGreaterThanOrEqual(0);
    expect(nameHue('Sam Kaur')).toBeLessThan(360);
  });
});
