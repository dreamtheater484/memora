import { describe, expect, it } from 'vitest';
import {
  isRichContent,
  parseRich,
  richAssetIds,
  richHeadings,
  richToMarkdown,
  richToText,
  type RichNode,
} from './rich';

const text = (value: string, ...marks: RichNode['marks'] & object): RichNode => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks } : {}),
});
const p = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content });
const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content });
const bold = { type: 'bold' };
const italic = { type: 'italic' };

describe('parseRich', () => {
  it('reads documents, treats empty content as an empty page, and refuses the rest', () => {
    expect(parseRich('')?.type).toBe('doc');
    expect(parseRich(JSON.stringify(doc(p(text('a'))))))?.toEqual(doc(p(text('a'))));
    expect(parseRich('{"type":"paragraph"}')).toBeNull();
    expect(parseRich('# Markdown')).toBeNull();
    expect(isRichContent('[1,2]')).toBe(false);
  });
});

describe('richToText', () => {
  it('gives one line per block, with maths, images and files', () => {
    const page = doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Plan')] },
      p(text('Hello '), text('world', bold), { type: 'hardBreak' }, text('again')),
      { type: 'image', attrs: { src: 'asset:1', alt: 'Chart', caption: 'Sales' } },
      { type: 'file', attrs: { src: 'asset:2', name: 'report.pdf' } },
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [p(text('one'))] }],
      },
      p({ type: 'inlineMath', attrs: { latex: 'x^2' } }),
    );
    expect(richToText(page)).toBe('Plan\nHello world\nagain\nChart Sales\nreport.pdf\none\nx^2');
    expect(richToText('not json')).toBe('');
  });
});

describe('richHeadings and richAssetIds', () => {
  it('lists headings and the files used', () => {
    const page = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Intro')] },
      p(text('see', { type: 'link', attrs: { href: 'asset:3' } })),
      { type: 'image', attrs: { src: 'asset:1' } },
      { type: 'image', attrs: { src: 'https://example.com/a.png' } },
    );
    expect(richHeadings(page)).toEqual([{ level: 2, text: 'Intro' }]);
    expect(richAssetIds(page).sort()).toEqual(['1', '3']);
  });
});

describe('richToMarkdown', () => {
  it('writes the dialect: headings, marks, links, lists, quotes, code, maths', () => {
    const page = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
      p(
        text('Some '),
        text('bold', bold),
        text(' and '),
        text('both', bold, italic),
        text(' '),
        text('under', { type: 'underline' }),
        text(', '),
        text('code`s', { type: 'code' }),
        text(', '),
        text('H'),
        text('2', { type: 'subscript' }),
        text('O and '),
        text('site', { type: 'link', attrs: { href: 'https://example.com' } }),
        text(' and '),
        text('Plan', { type: 'link', attrs: { href: 'wiki:Plan' } }),
        text(' or '),
        text('that', { type: 'link', attrs: { href: 'wiki:Plan#Next%20steps' } }),
        text('.'),
      ),
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              p(text('one')),
              {
                type: 'orderedList',
                attrs: { start: 3 },
                content: [{ type: 'listItem', content: [p(text('nested'))] }],
              },
            ],
          },
          { type: 'listItem', content: [p(text('two'))] },
        ],
      },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p(text('done'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [p(text('open'))] },
        ],
      },
      { type: 'blockquote', content: [p(text('quoted')), p(text('twice'))] },
      { type: 'callout', attrs: { kind: 'warning' }, content: [p(text('Careful'))] },
      { type: 'codeBlock', attrs: { language: 'js' }, content: [text('const a = 1;')] },
      { type: 'blockMath', attrs: { latex: 'e^{i\\pi}' } },
      p(text('Inline '), { type: 'inlineMath', attrs: { latex: 'x+1' } }),
      { type: 'horizontalRule' },
      { type: 'image', attrs: { src: 'asset:abc', alt: 'A chart', caption: 'Q3 sales' } },
      { type: 'file', attrs: { src: 'asset:def', name: 'report.pdf' } },
    );
    const { markdown, lost } = richToMarkdown(page);
    expect(markdown).toBe(
      [
        '## Title',
        '',
        'Some **bold** and ***both*** <u>under</u>, ``code`s``, H<sub>2</sub>O and [site](https://example.com) and [[Plan]] or [[Plan#Next steps|that]].',
        '',
        '- one',
        '  3. nested',
        '- two',
        '',
        '- [x] done',
        '- [ ] open',
        '',
        '> quoted',
        '>',
        '> twice',
        '',
        '> [!WARNING]',
        '> Careful',
        '',
        '```js',
        'const a = 1;',
        '```',
        '',
        '$$',
        'e^{i\\pi}',
        '$$',
        '',
        'Inline $x+1$',
        '',
        '---',
        '',
        '![A chart](asset:abc)',
        '',
        '*Q3 sales*',
        '',
        '[report.pdf](asset:def)',
      ].join('\n'),
    );
    expect(lost).toEqual([]);
  });

  it('escapes text that would read as formatting', () => {
    const { markdown } = richToMarkdown(
      doc(
        p(text('# not a heading')),
        p(text('1. not a list, *nor* [a link], snake_case, _this_, $5 and <b>')),
        p(text('- nor this')),
      ),
    );
    expect(markdown).toBe(
      [
        '\\# not a heading',
        '',
        '1\\. not a list, \\*nor\\* \\[a link\\], snake_case, \\_this\\_, \\$5 and \\<b>',
        '',
        '\\- nor this',
      ].join('\n'),
    );
  });

  it('keeps spaces outside formatting', () => {
    const { markdown } = richToMarkdown(doc(p(text('a'), text(' bold ', bold), text('b'))));
    expect(markdown).toBe('a **bold** b');
  });

  it('writes tables lined up, and reports what Markdown can’t keep', () => {
    const cell = (type: string, value: string, attrs: Record<string, unknown> = {}) => ({
      type,
      attrs,
      content: [p(text(value))],
    });
    const page = doc(
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              cell('tableHeader', 'Item'),
              {
                type: 'tableHeader',
                content: [{ ...p(text('Qty')), attrs: { textAlign: 'right' } }],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [cell('tableCell', 'Apples | pears', { colspan: 2 })],
          },
          {
            type: 'tableRow',
            content: [
              cell('tableCell', 'Figs', { backgroundColor: '#ff000040' }),
              cell('tableCell', '3'),
            ],
          },
        ],
      },
      p(text('red', { type: 'textStyle', attrs: { color: '#e5484d', fontSize: '18pt' } })),
      { ...p(text('centred')), attrs: { textAlign: 'center' } },
      { type: 'image', attrs: { src: 'asset:1', alt: '', width: 320 } },
    );
    const { markdown, lost } = richToMarkdown(page);
    expect(markdown.split('\n').slice(0, 4)).toEqual([
      '| Item            | Qty |',
      '| --------------- | --: |',
      '| Apples \\| pears |     |',
      '| Figs            |   3 |',
    ]);
    expect(lost).toEqual(['colour', 'fontSize', 'align', 'mergedCells', 'imageLayout']);
  });
});
