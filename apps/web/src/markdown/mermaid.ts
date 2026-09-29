import mermaid from 'mermaid';

/*
 * Diagrams (§8.2): ```mermaid blocks, drawn by Mermaid at its strict security level (no
 * scripts, no HTML labels, sanitised output). Loaded the first time a page shows a diagram.
 */

let current: 'light' | 'dark' | null = null;
let counter = 0;

export async function renderDiagram(code: string, theme: 'light' | 'dark'): Promise<string> {
  if (current !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'Figtree Variable, system-ui, sans-serif',
    });
    current = theme;
  }
  const { svg } = await mermaid.render(`memora-diagram-${++counter}`, code);
  return svg;
}
