import { describe, expect, it } from 'vitest';
import { columnsOf, fencePrefix, prefixFenceLines, stripFencePrefix } from './fences';

describe('fences in containers', () => {
  it('turns what comes before an opening fence into the prefix of its lines', () => {
    expect(fencePrefix('')).toBe('');
    expect(fencePrefix('  ')).toBe('  ');
    expect(fencePrefix('- ')).toBe('  ');
    expect(fencePrefix('10. ')).toBe('    ');
    expect(fencePrefix('1) - ')).toBe('     ');
    expect(fencePrefix('> ')).toBe('> ');
    expect(fencePrefix('>')).toBe('> ');
    expect(fencePrefix('>> ')).toBe('> > ');
    expect(fencePrefix('> - ')).toBe('>   ');
    expect(fencePrefix('- > ')).toBe('  > ');
    expect(fencePrefix('-\t')).toBe('    ');
    expect(columnsOf('  > ')).toBe(4);
    expect(columnsOf('-\t')).toBe(4);
  });

  it('reads a line of code as Markdown does', () => {
    // List items: their indentation, then the fence's own (as far as the line has it).
    expect(stripFencePrefix('  graph TD', '  ')).toBe('graph TD');
    expect(stripFencePrefix('    A --> B', '  ')).toBe('  A --> B');
    expect(stripFencePrefix('   x', '   ')).toBe('x');
    expect(stripFencePrefix('  x', '   ')).toBe('x');
    expect(stripFencePrefix('', '    ')).toBe('');
    expect(stripFencePrefix('      ', '  ')).toBe('    ');
    // Quotes: up to three spaces before `>`, and one space after it belongs to the marker.
    expect(stripFencePrefix('> pie', '> ')).toBe('pie');
    expect(stripFencePrefix('>pie', '> ')).toBe('pie');
    expect(stripFencePrefix('>   "a" : 1', '> ')).toBe('  "a" : 1');
    expect(stripFencePrefix('  > x', '> ')).toBe('x');
    expect(stripFencePrefix('>', '> ')).toBe('');
    expect(stripFencePrefix('>  x', '>  ')).toBe('x');
    // Both, nested.
    expect(stripFencePrefix('>   graph', '>   ')).toBe('graph');
    expect(stripFencePrefix('  > > x', '  > > ')).toBe('x');
    expect(stripFencePrefix('>>x', '> > ')).toBe('x');
    // A tab counts to the next multiple of four; what is left of it stays.
    expect(stripFencePrefix('\tx', '  ')).toBe('  x');
    expect(stripFencePrefix('\tx', '    ')).toBe('x');
    // A line without the marker (it can't be in the fence) keeps what it has.
    expect(stripFencePrefix('x', '> ')).toBe('x');
  });

  it('writes code back with the prefix, which reads back the same', () => {
    const code = 'flowchart LR\n  A --> B\n\n   %% note';
    for (const prefix of ['', '  ', '    ', '> ', '>   ', '  > ', '> > ', '     ']) {
      const lines = prefixFenceLines(code, prefix);
      expect(
        lines
          .split('\n')
          .map((line) => stripFencePrefix(line, prefix))
          .join('\n'),
        JSON.stringify(prefix),
      ).toBe(code);
    }
    expect(prefixFenceLines('a\n\nb', '> ')).toBe('> a\n>\n> b');
    expect(prefixFenceLines('a\n\nb', '  ')).toBe('  a\n\n  b');
  });
});
