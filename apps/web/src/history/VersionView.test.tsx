import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionView } from './VersionView';

vi.mock('../diagrams/render', () => ({
  renderDiagram: (code: string) => Promise.resolve({ svg: `<svg aria-label="${code}"></svg>` }),
}));

describe('a rich version', () => {
  it('draws a diagram whatever the case of Mermaid, and leaves other code alone', async () => {
    const block = (language: string, code: string) => ({
      type: 'codeBlock',
      attrs: { language },
      content: [{ type: 'text', text: code }],
    });
    const content = JSON.stringify({
      type: 'doc',
      content: [block('js', 'let a'), block('MERMAID', 'pie title One')],
    });
    const { container } = render(<VersionView type="rich" content={content} />);
    await waitFor(
      () =>
        expect(container.querySelector('.diagram-drawing svg')?.getAttribute('aria-label')).toBe(
          'pie title One',
        ),
      { timeout: 10_000 },
    );
    expect([...container.querySelectorAll('pre code')].map((c) => c.textContent)).toEqual([
      'let a',
    ]);
  });
});
