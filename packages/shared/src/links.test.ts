import { describe, expect, it } from 'vitest';
import { linkedTitles, renameLinks, titleKey } from './links';

const rich = (...content: unknown[]) => JSON.stringify({ type: 'doc', content });
const linkText = (text: string, href: string) => ({
  type: 'text',
  text,
  marks: [{ type: 'link', attrs: { href } }],
});

describe('links between pages', () => {
  it('finds the titles a Markdown page links to, outside code', () => {
    const md = [
      'See [[Roadmap]] and [[Budget 2026#Totals|the totals]], and [[roadmap]] again.',
      '`[[Not a link]]` stays code.',
      '```',
      '[[Also code]]',
      '```',
      'Last: [[Plans]]',
    ].join('\n');
    expect(linkedTitles('markdown', md)).toEqual(['Roadmap', 'Budget 2026', 'Plans']);
  });

  it('finds the titles a rich page links to', () => {
    const doc = rich({
      type: 'paragraph',
      content: [
        linkText('Roadmap', 'wiki:Roadmap'),
        linkText('web', 'https://example.org'),
        linkText('Totals', `wiki:${encodeURIComponent('Budget 2026')}#Totals`),
      ],
    });
    expect(linkedTitles('rich', doc)).toEqual(['Roadmap', 'Budget 2026']);
  });

  it('renames links in Markdown, keeping headings and shown text, not code', () => {
    const md = 'A [[Roadmap]], a [[roadmap#Q4|plan]], `[[Roadmap]]`, and [[Roadmaps]].';
    expect(renameLinks('markdown', md, 'Roadmap', 'Plan 2027')).toBe(
      'A [[Plan 2027]], a [[Plan 2027#Q4|plan]], `[[Roadmap]]`, and [[Roadmaps]].',
    );
    expect(renameLinks('markdown', 'No links here.', 'Roadmap', 'Plan')).toBeNull();
  });

  it('renames links in rich pages, and the shown title with them', () => {
    const doc = rich({
      type: 'paragraph',
      content: [
        linkText('Roadmap', 'wiki:Roadmap'),
        { type: 'text', text: ' and ' },
        linkText('the Q4 part', 'wiki:Roadmap#Q4'),
      ],
    });
    const renamed = JSON.parse(renameLinks('rich', doc, 'Roadmap', 'Plan 2027')!);
    expect(renamed.content[0].content).toEqual([
      linkText('Plan 2027', `wiki:${encodeURIComponent('Plan 2027')}`),
      { type: 'text', text: ' and ' },
      linkText('the Q4 part', `wiki:${encodeURIComponent('Plan 2027')}#Q4`),
    ]);
    expect(renameLinks('rich', doc, 'Budget', 'Money')).toBeNull();
  });

  it('compares titles without case or surrounding spaces', () => {
    expect(titleKey('  Road Map ')).toBe('road map');
  });
});
