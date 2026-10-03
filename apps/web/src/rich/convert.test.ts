import { richToMarkdown, type RichNode } from '@memora/shared';
import { describe, expect, it } from 'vitest';
import { markdownToRich } from './convert';

/*
 * The conversion fixture suite (§15, Phase 6): Markdown → rich keeps everything, and a page
 * that went to rich text and back reads the same.
 */

const types = (node: RichNode): string[] => [
  node.type,
  ...(node.content ?? []).flatMap(types),
  ...(node.marks ?? []).map((m) => `mark:${m.type}`),
];

const roundTrip = (markdown: string) => richToMarkdown(markdownToRich(markdown));

describe('Markdown → rich', () => {
  it('turns each part of the dialect into its rich node', () => {
    const doc = markdownToRich(
      [
        '# Title',
        '',
        'Text with **bold**, *italic*, ~~gone~~, `code`, <u>under</u>, <mark>marked</mark>, H<sub>2</sub>O and x<sup>2</sup>.',
        '',
        '- [ ] open',
        '- [x] done',
        '',
        '> [!TIP]',
        '> Use the stove.',
        '',
        '$$',
        'e^{i\\pi} + 1 = 0',
        '$$',
        '',
        'Inline $a^2$ maths.',
        '',
        '![Chart](asset:0190e5a4-7c1d-7b3e-8a2f-1234567890ab)',
        '',
        '| Item | Qty |',
        '| ---- | --: |',
        '| Figs | 3   |',
      ].join('\n'),
    );
    const all = types(doc);
    for (const expected of [
      'heading',
      'mark:bold',
      'mark:italic',
      'mark:strike',
      'mark:code',
      'mark:underline',
      'mark:highlight',
      'mark:subscript',
      'mark:superscript',
      'taskList',
      'taskItem',
      'callout',
      'blockMath',
      'inlineMath',
      'image',
      'table',
      'tableHeader',
      'tableCell',
    ]) {
      expect(all, expected).toContain(expected);
    }
    const tasks = doc.content!.find((n) => n.type === 'taskList')!;
    expect(tasks.content!.map((item) => item.attrs?.checked)).toEqual([false, true]);
    expect(doc.content!.find((n) => n.type === 'callout')?.attrs?.kind).toBe('tip');
    expect(doc.content!.find((n) => n.type === 'blockMath')?.attrs?.latex).toBe(
      'e^{i\\pi} + 1 = 0',
    );
    expect(doc.content!.find((n) => n.type === 'image')?.attrs).toMatchObject({
      src: 'asset:0190e5a4-7c1d-7b3e-8a2f-1234567890ab',
      alt: 'Chart',
    });
  });

  it('makes diagrams of Mermaid in any case, in lists and quotes too', () => {
    const doc = markdownToRich(
      [
        '```Mermaid',
        'pie title One',
        '```',
        '',
        '- Step',
        '  ```MERMAID',
        '  pie title Two',
        '  ```',
        '',
        '> [!NOTE]',
        '> ```mermaid',
        '> pie title Three',
        '> ```',
      ].join('\n'),
    );
    const blocks: RichNode[] = [];
    const walk = (node: RichNode) => {
      if (node.type === 'codeBlock') blocks.push(node);
      node.content?.forEach(walk);
    };
    walk(doc);
    expect(blocks.map((b) => [b.attrs?.language, b.content?.[0]?.text])).toEqual([
      ['mermaid', 'pie title One'],
      ['mermaid', 'pie title Two'],
      ['mermaid', 'pie title Three'],
    ]);
    // And back: written as ```mermaid, in its list item.
    expect(richToMarkdown(doc).markdown).toMatch(
      /^- Step *\n\n? {2}```mermaid\n {2}pie title Two\n {2}```$/m,
    );
  });

  it('keeps links to pages and files, and never script', () => {
    const doc = markdownToRich(
      'See [[Launch plan|the plan]] and [the file](asset:0190e5a4-7c1d-7b3e-8a2f-1234567890ab).\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))',
    );
    const links = JSON.stringify(doc);
    expect(links).toContain('wiki:Launch%20plan');
    expect(links).toContain('asset:0190e5a4-7c1d-7b3e-8a2f-1234567890ab');
    expect(links).not.toContain('javascript:');
    expect(links).not.toContain('alert(1)</script');
  });
});

describe('Markdown → rich → Markdown', () => {
  const fixtures: Record<string, string> = {
    headings: '# One\n\n## Two\n\n### Three',
    emphasis: 'Plain, **bold**, *italic*, ***both***, ~~struck~~ and `code`.',
    html: 'An <u>underlined</u> word, <mark>marked</mark> text, H<sub>2</sub>O and E = mc<sup>2</sup>.',
    links:
      'A [link](https://example.com), a [[Page]], a [[Page#Section]] and [[Other|shown text]].',
    lists: '- one\n- two\n  - nested\n- three\n\n1. first\n2. second',
    ordered: '3. three\n4. four',
    tasks: '- [ ] open\n- [x] done',
    quote: '> quoted\n>\n> twice',
    alerts: '> [!NOTE]\n> Remember this.\n\n> [!CAUTION]\n> Hot.',
    code: '```ts\nconst a: number = 1;\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```',
    maths: 'Inline $x^2 + y^2$ here.\n\n$$\n\\frac{a}{b}\n$$',
    rule: 'Above\n\n---\n\nBelow',
    image: '![A chart](asset:0190e5a4-7c1d-7b3e-8a2f-1234567890ab)',
    file: '[report.pdf](asset:0190e5a4-7c1d-7b3e-8a2f-1234567890ab)',
    table: '| Item   | Qty |\n| :----- | --: |\n| Apples |   3 |\n| Figs   |  12 |',
    escapes: 'Not \\*emphasis\\*, a \\[bracket\\], \\$5 and snake_case.',
    breaks: 'Line one\\\nline two',
  };
  for (const [name, markdown] of Object.entries(fixtures)) {
    it(`reads the same: ${name}`, () => {
      const { markdown: back, lost } = roundTrip(markdown);
      expect(back).toBe(markdown);
      expect(lost).toEqual([]);
    });
  }

  it('reports what rich formatting Markdown can’t keep', () => {
    const doc = markdownToRich('Some text');
    const paragraph = doc.content![0]!;
    paragraph.attrs = { ...paragraph.attrs, textAlign: 'center' };
    paragraph.content = [
      {
        type: 'text',
        text: 'Some text',
        marks: [{ type: 'textStyle', attrs: { color: '#e5484d', fontFamily: 'Georgia, serif' } }],
      },
    ];
    const { markdown, lost } = richToMarkdown(doc);
    expect(markdown).toBe('Some text');
    expect(lost).toEqual(['colour', 'font', 'align']);
  });
});
