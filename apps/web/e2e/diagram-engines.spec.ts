import { expect, test } from '@playwright/test';
import { FakeApi, fontsReady } from './helpers';

/*
 * Diagrams are drawn in every engine (§9.4): Mermaid measures text and shapes in the
 * browser, and the mind map layout and the finishing touches (shadows, centred words) run
 * on what it drew.
 */

test.use({ viewport: { width: 1280, height: 900 } });

const fence = (code: string) => '```mermaid\n' + code + '\n```';

test('flowcharts, mind maps and sequence diagrams are drawn', async ({ page }) => {
  const api = new FakeApi();
  api.notes.content.set(
    'q4',
    [
      fence('flowchart LR\n  A["Start"] --> B{"Ready?"}\n  B -->|Yes| C["Go"]'),
      fence('mindmap\n  root((Plan))\n    Goals\n      Fast\n    Risks'),
      fence('sequenceDiagram\n  A->>+B: Hello\n  B-->>-A: Hi'),
    ].join('\n\n'),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await api.install(page);
  await page.goto('/p/q4');
  await fontsReady(page);
  await page.getByRole('radio', { name: 'Preview' }).click();
  const drawings = page.locator('[data-preview] .mermaid-diagram .diagram-drawing > svg');
  await expect(drawings).toHaveCount(3, { timeout: 20_000 });
  // The mind map is laid out as a tree: the centre between its topics.
  const centre = await page.locator('[data-preview] g.mm-root').boundingBox();
  const goals = await page.locator('[data-preview] g.mm-main').first().boundingBox();
  expect(goals!.x).toBeGreaterThan(centre!.x + centre!.width);
  await expect(page.locator('[data-preview] path.mm-branch')).toHaveCount(3);
  expect(errors).toEqual([]);
});
