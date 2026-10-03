import { DIAGRAM_FIT, type RichNode } from '@memora/shared';
import { generateHTML, generateJSON, getSchema, type JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_SIZES, findDiagram, frameStyle, isDiagram } from './diagram';
import { richExtensions } from './schema';

const schema = getSchema(richExtensions());
const block = (language: string | null, attrs: Record<string, unknown> = {}): JSONContent => ({
  type: 'codeBlock',
  attrs: { language, ...attrs },
  content: [{ type: 'text', text: 'pie title Spend' }],
});

describe('diagrams in rich pages', () => {
  it('are code blocks in Mermaid, whatever its case', () => {
    for (const language of ['mermaid', 'Mermaid', 'MERMAID']) {
      expect(isDiagram(schema.nodeFromJSON(block(language))), language).toBe(true);
    }
    expect(isDiagram(schema.nodeFromJSON(block('js')))).toBe(false);
    expect(isDiagram(schema.nodeFromJSON(block(null)))).toBe(false);
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph' }, block('Mermaid')],
    });
    expect(findDiagram(doc, null, 'pie title Spend')).toBe(2);
  });

  it('offer Fit beside the fixed sizes, filling the text’s width', () => {
    expect(DIAGRAM_SIZES.map((s) => s.label)).toEqual([
      'Natural size',
      'Small',
      'Medium',
      'Large',
      'Fit',
    ]);
    expect(frameStyle(DIAGRAM_FIT)).toEqual({ width: '100%' });
    expect(frameStyle(480)).toEqual({ width: '480px' });
    expect(frameStyle(null)).toBeUndefined();
    // A width this version doesn't know is the natural size.
    expect(frameStyle('enormous')).toBeUndefined();
  });

  it('keep their width through HTML, Fit included', () => {
    const doc = { type: 'doc', content: [block('mermaid', { width: DIAGRAM_FIT })] };
    const html = generateHTML(doc, richExtensions());
    expect(html).toContain('data-width="fit"');
    const back = generateJSON(html, richExtensions()) as RichNode;
    expect(back.content?.[0]?.attrs).toMatchObject({ language: 'mermaid', width: 'fit' });
    const pixels = generateJSON(
      '<pre data-width="320"><code class="language-mermaid">pie</code></pre><pre data-width="wide"><code class="language-mermaid">pie</code></pre>',
      richExtensions(),
    ) as RichNode;
    expect(pixels.content?.map((n) => n.attrs?.width)).toEqual([320, null]);
  });
});
