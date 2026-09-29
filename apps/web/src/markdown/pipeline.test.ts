import type { Element, Root } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { describe, expect, it } from 'vitest';
import { parseWiki, toHast } from './pipeline';

const html = (markdown: string) => toHtml(toHast(markdown));

function find(tree: Root | Element, test: (e: Element) => boolean): Element[] {
  const found: Element[] = [];
  const walk = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      if (test(child)) found.push(child);
      walk(child);
    }
  };
  walk(tree);
  return found;
}

describe('the Markdown dialect (§8.2)', () => {
  it('renders CommonMark and GFM', () => {
    const out = html(
      [
        '# Title',
        '',
        '**bold** *italic* ~~gone~~ `code` https://example.org',
        '',
        '| a | b |',
        '| - | -: |',
        '| 1 | 2 |',
        '',
        '- [ ] todo',
        '- [x] done',
      ].join('\n'),
    );
    expect(out).toContain('<h1 data-line="1">Title</h1>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<del>gone</del>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<a href="https://example.org">https://example.org</a>');
    expect(out).toContain('<td align="right">2</td>');
    expect(out).toMatch(/<input type="checkbox" disabled data-line="9">/);
    expect(out).toMatch(/<input type="checkbox" checked disabled data-line="10">/);
  });

  it('renders footnotes with prefixed ids', () => {
    const out = html('Text[^1]\n\n[^1]: The note.');
    expect(out).toContain('href="#fn-1"');
    expect(out).toContain('id="user-content-fn-1"');
    expect(out).toContain('id="user-content-fnref-1"');
    expect(out).toContain('The note.');
  });

  it('turns GitHub alerts into titled boxes', () => {
    const out = html('> [!WARNING]\n> Mind the gap.');
    expect(out).toContain('<div class="markdown-alert markdown-alert-warning"');
    expect(out).toContain('<p class="markdown-alert-title">Warning</p>');
    expect(out).toContain('Mind the gap.');
    // An ordinary quote stays a quote.
    expect(html('> [!unknown] x')).toContain('<blockquote');
  });

  it('marks maths and Mermaid blocks for their renderers', () => {
    const out = html('Inline $a^2$.\n\n$$\n\\sum_i x_i\n$$\n\n```mermaid\ngraph TD; A-->B\n```');
    expect(out).toContain('<code class="language-math math-inline">a^2</code>');
    expect(out).toContain('class="language-math math-display"');
    expect(out).toContain('<code class="language-mermaid">graph TD; A-->B\n</code>');
  });

  it('turns wiki links into links by title, with a label and heading', () => {
    const tree = toHast('See [[Project plan]], [[Budget|the money]] and [[Notes#Ideas]].');
    const links = find(tree, (e) => e.tagName === 'a');
    expect(links.map((a) => a.properties.href)).toEqual([
      'wiki:Project%20plan',
      'wiki:Budget',
      'wiki:Notes#Ideas',
    ]);
    expect(links.map((a) => (a.children[0] as { value: string }).value)).toEqual([
      'Project plan',
      'the money',
      'Notes#Ideas',
    ]);
    // Not inside code.
    expect(html('`[[Not a link]]`')).not.toContain('wiki:');
    expect(parseWiki('Page#Head', undefined)).toEqual({
      title: 'Page',
      heading: 'Head',
      label: 'Page#Head',
    });
  });

  it('keeps pasted files as asset links', () => {
    const id = '0190f7a1-2b3c-7d4e-8f90-a1b2c3d4e5f6';
    const out = html(`![Screenshot](asset:${id})\n\n[report.pdf](asset:${id})`);
    expect(out).toContain(`<img src="asset:${id}" alt="Screenshot"`);
    expect(out).toContain(`<a href="asset:${id}">report.pdf</a>`);
  });

  it('hides front matter', () => {
    expect(html('---\ntitle: x\n---\n\nBody')).toBe('<p data-line="5">Body</p>');
  });

  it('allows safe HTML and removes anything that could run', () => {
    const out = html(
      [
        '<details><summary>More</summary>Hidden</details>',
        '',
        '<script>alert(1)</script>',
        '',
        '<img src="x" onerror="alert(1)">',
        '',
        '[click](javascript:alert(1))',
        '',
        '<a href="https://ok.example" style="color:red" onclick="x()">ok</a>',
        '',
        '<iframe src="https://evil.example"></iframe>',
      ].join('\n'),
    );
    expect(out).toContain('<details');
    expect(out).toContain('<summary>More</summary>');
    expect(out).not.toMatch(/script|onerror|javascript:|onclick|style=|iframe/);
  });

  it('notes the source line of every block, for scroll sync', () => {
    const tree = toHast('Para one\n\n## Heading\n\n```js\nx\n```\n\n> quote');
    const lines = find(tree, (e) => e.properties.dataLine !== undefined).map(
      (e) => `${e.tagName}:${String(e.properties.dataLine)}`,
    );
    expect(lines).toEqual(['p:1', 'h2:3', 'pre:5', 'blockquote:9', 'p:9']);
  });
});
