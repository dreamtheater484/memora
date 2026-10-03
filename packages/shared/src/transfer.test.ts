import { describe, expect, it } from 'vitest';
import { richToHtml } from './richHtml';
import { readFrontMatter, safeFileName, uniqueNames, writeFrontMatter } from './transfer';

describe('file names', () => {
  it('makes titles into names any system accepts', () => {
    expect(safeFileName('Plans: Q4/Q1 <draft>?')).toBe('Plans Q4 Q1 draft');
    expect(safeFileName('  ...  ')).toBe('Untitled');
    expect(safeFileName('CON')).toBe('CON_');
    expect(safeFileName('Trailing dots...')).toBe('Trailing dots');
    expect(safeFileName('x'.repeat(300))).toHaveLength(100);
  });

  it('keeps names in one folder unique, whatever their case', () => {
    const unique = uniqueNames();
    expect(['Plan', 'plan', 'Plan', 'Other'].map(unique)).toEqual([
      'Plan',
      'plan (2)',
      'Plan (3)',
      'Other',
    ]);
  });
});

describe('front matter', () => {
  it('writes and reads back what Memora keeps', () => {
    const block = writeFrontMatter({
      id: '0190e5a4-7c1d-7b3e-8a2f-000000000001',
      tags: ['work', 'Q4 plans', 'a:b'],
      created: '2026-09-29T14:30:00.000Z',
      updated: '2026-09-30T08:00:00.000Z',
    });
    expect(block).toBe(
      '---\nid: 0190e5a4-7c1d-7b3e-8a2f-000000000001\ntags: [work, Q4 plans, "a:b"]\ncreated: 2026-09-29T14:30:00.000Z\nupdated: 2026-09-30T08:00:00.000Z\n---\n\n',
    );
    const { fields, body } = readFrontMatter(`${block}# Hello\n`);
    expect(fields.tags).toEqual(['work', 'Q4 plans', 'a:b']);
    expect(fields.created).toBe('2026-09-29T14:30:00.000Z');
    expect(body).toBe('# Hello\n');
  });

  it('reads other tools’ front matter, and text without any', () => {
    const { fields, body } = readFrontMatter(
      '---\ntitle: "Plans"\ntags:\n  - one\n  - two\ndate: 2026-01-02\nauthor: someone\n---\nText',
    );
    expect(fields).toEqual({ title: 'Plans', tags: ['one', 'two'], created: '2026-01-02' });
    expect(body).toBe('Text');
    expect(readFrontMatter('No front matter\n---\n')).toEqual({
      fields: {},
      body: 'No front matter\n---\n',
    });
  });
});

describe('rich pages as HTML', () => {
  it('keeps indented paragraphs indented, within reason', () => {
    const para = (indent: unknown) => ({
      type: 'paragraph',
      attrs: { indent },
      content: [{ type: 'text', text: 'x' }],
    });
    const html = richToHtml({ type: 'doc', content: [para(2), para(99), para('1em')] }, {});
    expect(html).toBe('<p style="margin-left: 4em">x</p>\n<p>x</p>\n<p>x</p>\n');
  });

  it('draws diagrams in any case of Mermaid, at their size: pixels, Fit or natural', () => {
    const diagram = (language: string, width?: unknown) => ({
      type: 'codeBlock',
      attrs: { language, ...(width === undefined ? {} : { width }) },
      content: [{ type: 'text', text: 'pie' }],
    });
    const html = richToHtml(
      {
        type: 'doc',
        content: [
          diagram('Mermaid', 320),
          diagram('mermaid', 'fit'),
          diagram('MERMAID'),
          diagram('mermaid', 'huge'),
        ],
      },
      { diagram: () => '<svg></svg>' },
    );
    expect(html.match(/<div class="diagram-svg"[^>]*>/g)).toEqual([
      '<div class="diagram-svg" style="width: 320px">',
      '<div class="diagram-svg" style="width: 100%">',
      '<div class="diagram-svg">',
      '<div class="diagram-svg">',
    ]);
    // Without a drawing, the code, marked as Mermaid.
    expect(richToHtml({ type: 'doc', content: [diagram('Mermaid')] })).toContain(
      '<pre class="diagram-code"><code class="language-mermaid">pie</code></pre>',
    );
  });

  it('writes the document, escaping text and dropping unsafe addresses', () => {
    const html = richToHtml(
      {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A <plan>' }] },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'bad',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
              { type: 'text', text: ' good', marks: [{ type: 'bold' }] },
            ],
          },
          { type: 'image', attrs: { src: 'asset:abc', alt: 'Shot' } },
        ],
      },
      { asset: (id) => `assets/${id}.png` },
    );
    expect(html).toBe(
      '<h2>A &lt;plan&gt;</h2>\n<p>bad<strong> good</strong></p>\n<p><img src="assets/abc.png" alt="Shot"></p>\n',
    );
  });
});
