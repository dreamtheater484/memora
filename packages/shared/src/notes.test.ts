import { describe, expect, it } from 'vitest';
import { uuidv7 } from './ids';
import {
  COLOR_IDS,
  bySortKey,
  createPageSchema,
  keyBetween,
  keysBetween,
  pickColor,
  placePagesSchema,
  updateNotebookSchema,
  uiStateSchema,
} from './notes';
import {
  childrenByParent,
  depthOf,
  heightOf,
  isWithin,
  markdownToText,
  placeKeys,
  snippetOf,
  subtreeOf,
} from './tree';

describe('sort keys', () => {
  it('always fit between two neighbours, in code-unit order', () => {
    let low = keyBetween(null, null);
    let high = keyBetween(low, null);
    for (let i = 0; i < 200; i += 1) {
      const middle = keyBetween(low, high);
      expect(low < middle && middle < high).toBe(true);
      if (i % 2) low = middle;
      else high = middle;
    }
  });

  it('makes several keys at once, in order', () => {
    const keys = keysBetween('a0', 'a1', 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toEqual(keys);
    expect(keys.every((k) => 'a0' < k && k < 'a1')).toBe(true);
  });

  it('sorts by key, then by id for equal keys', () => {
    const items = [
      { id: 'b', sortKey: 'a1' },
      { id: 'c', sortKey: 'a0' },
      { id: 'a', sortKey: 'a1' },
    ];
    expect(items.sort(bySortKey).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('placeKeys', () => {
  const siblings = [
    { id: 'x', sortKey: 'a0' },
    { id: 'z', sortKey: 'a2' },
    { id: 'y', sortKey: 'a1' },
  ];

  it('places before a sibling, or last', () => {
    const [before] = placeKeys(siblings, 'y')!;
    expect('a0' < before! && before! < 'a1').toBe(true);
    const [last] = placeKeys(siblings, null)!;
    expect(last! > 'a2').toBe(true);
    const [first] = placeKeys(siblings, 'x')!;
    expect(first! < 'a0').toBe(true);
    expect(placeKeys([], null)).toEqual(['a0']);
  });

  it('refuses a neighbour that is not a sibling', () => {
    expect(placeKeys(siblings, 'nope')).toBeUndefined();
  });
});

describe('hierarchies', () => {
  // a ─ b ─ c
  //   └ d
  // e
  const items = [
    { id: 'a', parent: null, sortKey: 'a0' },
    { id: 'b', parent: 'a', sortKey: 'a0' },
    { id: 'c', parent: 'b', sortKey: 'a0' },
    { id: 'd', parent: 'a', sortKey: 'a1' },
    { id: 'e', parent: null, sortKey: 'a1' },
  ];
  const byId = new Map(items.map((i) => [i.id, i]));
  const parentOf = (i: { parent: string | null }) => i.parent;
  const children = childrenByParent(items, parentOf);

  it('lists a subtree parents first, in order', () => {
    expect(subtreeOf(children, byId.get('a')!).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(subtreeOf(children, byId.get('e')!).map((i) => i.id)).toEqual(['e']);
  });

  it('measures depth and height', () => {
    expect(depthOf(byId, null, parentOf)).toBe(0);
    expect(depthOf(byId, 'a', parentOf)).toBe(1);
    expect(depthOf(byId, 'c', parentOf)).toBe(3);
    expect(heightOf(children, 'a')).toBe(3);
    expect(heightOf(children, 'd')).toBe(1);
  });

  it('knows what lies within what', () => {
    expect(isWithin(byId, 'c', 'a', parentOf)).toBe(true);
    expect(isWithin(byId, 'a', 'a', parentOf)).toBe(true);
    expect(isWithin(byId, 'e', 'a', parentOf)).toBe(false);
    expect(isWithin(byId, null, 'a', parentOf)).toBe(false);
  });
});

describe('markdownToText', () => {
  it('keeps the words and drops the marks', () => {
    const md = [
      '# Weekly review',
      '',
      '> Quote with **bold** and _italic_',
      '- [x] Done item with `code`',
      '1. See [the docs](https://example.com) and [[Other page|that page]]',
      '---',
      '```ts',
      'const a = 1;',
      '```',
      '<b>html</b> snake_case_name',
    ].join('\n');
    expect(snippetOf(markdownToText(md))).toBe(
      'Weekly review Quote with bold and italic Done item with code See the docs and that page const a = 1; html snake_case_name',
    );
  });

  it('cuts snippets to one short line', () => {
    expect(snippetOf(`  a\n\n b ${'x'.repeat(500)}`)).toHaveLength(140);
  });
});

describe('request schemas', () => {
  const id = uuidv7();

  it('fills defaults for new pages', () => {
    expect(createPageSchema.parse({ sectionId: id })).toEqual({
      sectionId: id,
      parentPageId: null,
      title: '',
      type: 'markdown',
      content: '',
      beforeId: null,
    });
  });

  it('only lets Markdown pages start with text', () => {
    expect(createPageSchema.safeParse({ sectionId: id, type: 'rich', content: 'x' }).success).toBe(
      false,
    );
  });

  it('refuses empty changes, bad ids and repeated pages', () => {
    expect(updateNotebookSchema.safeParse({}).success).toBe(false);
    expect(updateNotebookSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(placePagesSchema.safeParse({ ids: ['x'], sectionId: id }).success).toBe(false);
    expect(placePagesSchema.safeParse({ ids: [id, id], sectionId: id }).success).toBe(false);
  });

  it('bounds the UI state', () => {
    const lastPages = Object.fromEntries(Array.from({ length: 1001 }, () => [uuidv7(), uuidv7()]));
    expect(uiStateSchema.safeParse({ lastPages }).success).toBe(false);
    expect(uiStateSchema.safeParse({ pageListSide: 'left', expanded: [id] }).success).toBe(true);
  });
});

describe('section colours', () => {
  it('pick the first one not in use, and cycle once all are taken', () => {
    expect(pickColor([])).toBe('coral');
    expect(pickColor(['coral', 'amber'])).toBe('orange');
    expect(pickColor(COLOR_IDS)).toBe('coral');
    expect(pickColor([...COLOR_IDS, 'coral'])).toBe('coral');
  });
});
