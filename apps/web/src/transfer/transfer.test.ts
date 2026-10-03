import type { RichNode } from '@memora/shared';
import mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';
import { bodyHtml, diagramsIn, type ExportDocument } from './document';
import { diagramSize, docxFile } from './docx';
import { convertFile } from './importFiles';
import { printHtml } from './print';

const text = (value: string, marks?: RichNode['marks']): RichNode => ({
  type: 'text',
  text: value,
  marks,
});
const p = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content });

const sample: ExportDocument = {
  title: 'Plans',
  pages: [
    {
      id: 'a',
      title: 'Plans',
      depth: 1,
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [text('Goals')] },
          p(
            text('Ship '),
            text('it', [{ type: 'bold' }]),
            text(' — see '),
            text('docs', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
          ),
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [p(text('One'))] },
              {
                type: 'listItem',
                content: [
                  p(text('Two')),
                  {
                    type: 'orderedList',
                    content: [{ type: 'listItem', content: [p(text('Two a'))] }],
                  },
                ],
              },
            ],
          },
          {
            type: 'taskList',
            content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('Done'))] }],
          },
          {
            type: 'codeBlock',
            attrs: { language: 'js' },
            content: [text('let a = 1;\nlet b = 2;')],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [p(text('Name'))] },
                  { type: 'tableHeader', content: [p(text('Value'))] },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [p(text('x'))] },
                  { type: 'tableCell', content: [p(text('1'))] },
                ],
              },
            ],
          },
          {
            type: 'image',
            attrs: { src: 'asset:0190c0de-0000-7000-8000-000000000001', alt: 'Chart' },
          },
        ],
      },
    },
  ],
};

describe('Word export', () => {
  it('writes headings, lists, links, tasks, code and tables that Word readers understand', async () => {
    const blob = await docxFile(sample);
    expect(blob.size).toBeGreaterThan(1000);
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
    expect(value).toContain('<h2>Goals</h2>');
    expect(value).toContain('<strong>it</strong>');
    expect(value).toContain('<a href="https://example.com">docs</a>');
    expect(value).toMatch(/<ul><li>One<\/li><li>Two<ol><li>Two a<\/li><\/ol><\/li><\/ul>/);
    expect(value).toContain('☒ Done');
    expect(value).toContain('let a = 1;<br />let b = 2;');
    expect(value).toMatch(/<table>.*Name.*Value.*x.*1.*<\/table>/);
    // An image that couldn't be loaded is named instead.
    expect(value).toContain('[Chart]');
  });
});

describe('diagrams in exports', () => {
  const diagram = (language: string, width?: unknown): RichNode => ({
    type: 'codeBlock',
    attrs: { language, width },
    content: [text(`pie title ${language}`)],
  });
  const page = (...content: RichNode[]): ExportDocument['pages'][number] => ({
    id: 'd',
    title: 'Charts',
    depth: 1,
    doc: { type: 'doc', content },
  });

  it('finds them in any case of Mermaid', () => {
    expect(diagramsIn([page(diagram('Mermaid'), diagram('MERMAID'), diagram('js'))])).toEqual([
      'pie title Mermaid',
      'pie title MERMAID',
    ]);
  });

  it('sizes them as in the page: Fit is the text’s width', () => {
    const document: ExportDocument = {
      title: 'Charts',
      pages: [page(diagram('Mermaid', 'fit'), diagram('mermaid', 320))],
      diagrams: new Map([
        ['pie title Mermaid', { svg: '<svg></svg>', width: 300, height: 150 }],
        ['pie title mermaid', { svg: '<svg></svg>', width: 300, height: 150 }],
      ]),
    };
    const html = bodyHtml(document, () => null);
    expect(html).toContain('<div class="diagram-svg" style="width: 100%"><svg></svg></div>');
    expect(html).toContain('<div class="diagram-svg" style="width: 320px"><svg></svg></div>');
    // Word: the page's text is 600 pixels wide.
    expect(diagramSize('fit', { width: 300, height: 150 })).toEqual({ width: 600, height: 300 });
    expect(diagramSize(320, { width: 800, height: 400 })).toEqual({ width: 320, height: 160 });
    expect(diagramSize(null, { width: 900, height: 300 })).toEqual({ width: 600, height: 200 });
    expect(diagramSize('wide', { width: 200, height: 100 })).toEqual({ width: 200, height: 100 });
  });
});

describe('HTML and print', () => {
  it('writes each page of a section under its title, one per sheet', () => {
    const section: ExportDocument = {
      title: 'Work',
      pages: [
        { id: 'a', title: 'First', depth: 1, doc: { type: 'doc', content: [p(text('One'))] } },
        { id: 'b', title: 'Sub', depth: 2, doc: { type: 'doc', content: [p(text('Two'))] } },
      ],
    };
    const body = bodyHtml(section, () => null);
    expect(body).toContain('<h2 class="page-title">First</h2>');
    expect(body).toContain('<h3 class="page-title">Sub</h3>');
    const html = printHtml('Work', body, '/assets/paged.js');
    expect(html).toContain('<script src="/assets/paged.js"></script>');
    expect(html).toContain('.page + .page { break-before: page; }');
    expect(printHtml('Work', body, null)).not.toContain('<script');
  });

  it('points images wherever it is told', () => {
    expect(bodyHtml(sample, (id) => `/files/${id}`)).toContain(
      'src="/files/0190c0de-0000-7000-8000-000000000001"',
    );
  });
});

describe('importing single files', () => {
  it('reads Markdown with front matter', async () => {
    const file = new File(
      ['﻿---\ntitle: "Plans: 2026"\ntags: [work, q1]\n---\n\n# Plans\n'],
      'plans.md',
    );
    expect(await convertFile(file)).toEqual({
      title: 'Plans: 2026',
      type: 'markdown',
      content: '# Plans\n',
      tags: ['work', 'q1'],
    });
  });

  it('keeps text files as they are, named after the file', async () => {
    const file = new File(['Milk\n*not bold*'], 'shopping list.txt');
    expect(await convertFile(file)).toMatchObject({
      title: 'shopping list',
      type: 'markdown',
      content: 'Milk\n*not bold*',
    });
  });

  it('reads web pages as rich pages, without their scripts', async () => {
    const file = new File(
      [
        '<html><head><title>Saved page</title><script>alert(1)</script></head><body><h1>Hello</h1><p onclick="x()">A <b>bold</b> move</p></body></html>',
      ],
      'saved.html',
    );
    const page = await convertFile(file);
    expect(page.title).toBe('Saved page');
    expect(page.type).toBe('rich');
    const doc = JSON.parse(page.content) as RichNode;
    expect(doc.content?.map((n) => n.type)).toEqual(['heading', 'paragraph']);
    expect(page.content).not.toContain('alert');
    expect(page.content).toContain('"bold"');
  });

  it('reads Word files through the same path', async () => {
    const blob = await docxFile(sample);
    const page = await convertFile(new File([blob], 'Plans.docx'));
    expect(page.title).toBe('Plans');
    const types = (JSON.parse(page.content) as RichNode).content?.map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['heading', 'paragraph', 'bulletList', 'table']));
  });

  it('refuses other files', async () => {
    await expect(convertFile(new File(['x'], 'photo.png'))).rejects.toThrow(/can’t import/);
  });
});
