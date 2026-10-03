import { describe, expect, it } from 'vitest';
import { fillEmptyBlocks } from './render';

describe('empty blocks of sequence diagrams', () => {
  it('get a stand-in so Mermaid lays them out (removed from the drawing again)', () => {
    const code =
      'sequenceDiagram\n  A->>B: Hi\n  loop Every day\n  end\n  alt Yes\n    A->>B: Yes\n  else No\n  end';
    const filled = fillEmptyBlocks(code).split('\n');
    expect(filled[3]).toMatch(/^Note over A,B: \u2060$/);
    expect(filled[4]!.trim()).toBe('end');
    // The "else" branch is empty too.
    expect(filled.filter((l) => l.startsWith('Note over')).length).toBe(2);
  });

  it('leaves everything else as it is', () => {
    const code = 'sequenceDiagram\n  loop Every day\n    A->>B: Hi\n  end';
    expect(fillEmptyBlocks(code)).toBe(code);
    expect(fillEmptyBlocks('flowchart TD\n  a --> b')).toBe('flowchart TD\n  a --> b');
  });
});
