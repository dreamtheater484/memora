import type { RichNode } from '@memora/shared';
import { generateJSON } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { cleanPastedHtml } from './clean';
import { richExtensions } from './schema';

/* Pasted HTML (§9.4): formatting kept, but only what rich pages support, and nothing unsafe. */

const read = (html: string) => generateJSON(cleanPastedHtml(html), richExtensions()) as RichNode;
const marksOf = (doc: RichNode): string[] =>
  (doc.content ?? []).flatMap((n) => [
    ...(n.marks ?? []).map((m) => `${m.type}${m.attrs ? JSON.stringify(m.attrs) : ''}`),
    ...marksOf(n),
  ]);

describe('cleanPastedHtml', () => {
  it('removes scripts, event handlers and unsafe links', () => {
    const html = cleanPastedHtml(
      '<p onclick="steal()">Hi <a href="javascript:alert(1)">there</a><script>alert(1)</script><img src="x" onerror="alert(1)"></p>',
    );
    expect(html).not.toMatch(/onclick|javascript:|<script|onerror/);
  });

  it('keeps links to pages and files', () => {
    const html = cleanPastedHtml('<p><a href="wiki:Plan">Plan</a> <a href="asset:1">file</a></p>');
    expect(html).toContain('href="wiki:Plan"');
    expect(html).toContain('href="asset:1"');
  });

  it('cleans Word: styles, fonts, sizes, black text and lists', () => {
    const word = `
      <p class=MsoNormal style='margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif;color:black;mso-fareast-language:EN-US'>
        Plain <b>bold</b> <span style='color:#C00000'>red</span>
        <span style='font-size:20.0pt;font-family:"Times New Roman",serif'>big serif</span><o:p></o:p>
      </p>
      <p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>First</p>
      <p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New"'><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp; </span></span></span><![endif]>Nested</p>
      <p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>Second</p>
      <p class=MsoNormal><o:p>&nbsp;</o:p></p>
      <p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span><span style='mso-list:Ignore'>1.<span>&nbsp; </span></span></span><![endif]>Numbered</p>`;
    const html = cleanPastedHtml(word);
    expect(html).not.toMatch(/mso-|class=|Calibri|color: black|11\.0pt/i);
    const doc = read(word);
    const types = doc.content!.map((n) => n.type);
    expect(types).toEqual(['paragraph', 'bulletList', 'orderedList']);
    const bullets = doc.content![1]!;
    expect(bullets.content).toHaveLength(2);
    expect(bullets.content![0]!.content!.map((n) => n.type)).toEqual(['paragraph', 'bulletList']);
    expect(JSON.stringify(bullets)).not.toContain('·');
    const marks = marksOf(doc);
    expect(marks).toContain('bold');
    expect(marks.some((m) => m.startsWith('textStyle') && m.includes('#c00000'))).toBe(true);
    expect(marks.some((m) => m.includes('"fontSize":"20pt"') && m.includes('Georgia'))).toBe(true);
  });

  it('cleans Google Docs: the bold wrapper, weights and spacing', () => {
    const docs = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;">Normal </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;">strong</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-style:italic;"> leaning</span><span style="background-color:#ffff00;font-weight:400"> marked</span></p></b>`;
    const doc = read(docs);
    expect(doc.content).toHaveLength(1);
    const texts = doc.content![0]!.content!.map((n) => [
      n.text,
      (n.marks ?? []).map((m) => m.type),
    ]);
    expect(texts).toEqual([
      ['Normal ', []],
      ['strong', ['bold']],
      [' leaning', ['italic']],
      [' marked', ['textStyle']],
    ]);
    expect(JSON.stringify(doc)).not.toMatch(/Arial|#000000|line-height/);
  });

  it('keeps what a rich page copies to itself', () => {
    const html = `<div data-type="callout" data-kind="warning" class="markdown-alert markdown-alert-warning"><p>Hot</p></div><pre><code class="language-ts">let a = 1;</code></pre><p><span style="color: #e5484d; font-size: 18pt; font-family: Georgia, &quot;Times New Roman&quot;, serif">styled</span></p><figure class="rich-image" data-align="left"><img src="asset:0190e5a4-7c1d-7b3e-8a2f-1234567890ab" width="320"><figcaption>Cap</figcaption></figure>`;
    const doc = read(html);
    expect(doc.content!.map((n) => n.type)).toEqual(['callout', 'codeBlock', 'paragraph', 'image']);
    expect(doc.content![0]!.attrs?.kind).toBe('warning');
    expect(doc.content![1]!.attrs?.language).toBe('ts');
    expect(doc.content![3]!.attrs).toMatchObject({
      src: 'asset:0190e5a4-7c1d-7b3e-8a2f-1234567890ab',
      width: 320,
      align: 'left',
      caption: 'Cap',
    });
    expect(marksOf(doc)[0]).toContain('"fontSize":"18pt"');
  });
});
