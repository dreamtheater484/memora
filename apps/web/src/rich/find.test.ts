import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { findMatches } from './find';
import { richExtensions } from './schema';

const schema = getSchema(richExtensions());
const doc = schema.nodeFromJSON({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Plan the ' },
        { type: 'text', text: 'plan', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'et trip.' },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'PLAN B' }] },
  ],
});

const texts = (matches: { from: number; to: number }[]) =>
  matches.map((m) => doc.textBetween(m.from, m.to));

describe('find in a rich page', () => {
  it('finds across formatting, ignoring case unless asked', () => {
    expect(texts(findMatches(doc, 'plan', false))).toEqual(['Plan', 'plan', 'PLAN']);
    expect(texts(findMatches(doc, 'planet', false))).toEqual(['planet']);
    expect(texts(findMatches(doc, 'plan', true))).toEqual(['plan']);
    expect(findMatches(doc, '', false)).toEqual([]);
  });
});
