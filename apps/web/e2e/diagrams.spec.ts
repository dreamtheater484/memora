import { readFile } from 'node:fs/promises';
import type { RichNode } from '@memora/shared';
import { expect, test, type Page } from '@playwright/test';
import { FakeApi, NOW, expectNoA11yViolations, fontsReady, setTheme } from './helpers';

/*
 * Diagrams (§9.3, §9.4): drawn in rich pages, in the Markdown source and preview, edited in
 * the visual editor (boxes and arrows, mind map outlines, sequence steps), written back as
 * Mermaid code, and drawn in exports and in the history.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const editorDialog = (page: Page) => page.locator('.diagram-editor');
const canvas = (page: Page) => page.locator('.diagram-editor .diagram-canvas');

const FLOW =
  'flowchart TD\n    n1(["Order received"]) --> n2{"Paid?"}\n    n2 -->|Yes| n3["Ship it"]';
const MIND = 'mindmap\n  root((Plan))\n    Goals\n    Risks';
const SEQUENCE = 'sequenceDiagram\n  A->>B: Hello';

async function open(page: Page, id: string, content?: string, api = new FakeApi()) {
  if (content !== undefined) api.notes.content.set(id, content);
  await api.install(page);
  await page.clock.setFixedTime(NOW);
  await page.goto(`/p/${id}`);
  await fontsReady(page);
  return api;
}

const fence = (code: string) => '```mermaid\n' + code + '\n```';

/** A rich page holding one diagram. */
const richWith = (code: string, attrs: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before the diagram' }] },
      {
        type: 'codeBlock',
        attrs: { language: 'mermaid', ...attrs },
        content: [{ type: 'text', text: code }],
      },
    ],
  });

/** The first diagram (a Mermaid code block) of a rich page as the fake server has it. */
function storedDiagram(api: FakeApi, id = 'pricing'): RichNode | undefined {
  const content = api.notes.content.get(id) ?? '';
  if (!content) return undefined;
  const doc = JSON.parse(content) as RichNode;
  return doc.content?.find((n) => n.type === 'codeBlock' && n.attrs?.language === 'mermaid');
}
const codeOf = (node: RichNode | undefined) => node?.content?.[0]?.text ?? '';

test.describe('rich pages', () => {
  test('a diagram from the gallery, edited with the mouse and keys, kept as Mermaid', async ({
    page,
  }) => {
    const api = await open(page, 'pricing', '');
    const body = page.getByRole('textbox', { name: 'Page content', exact: true });
    await body.click();
    await page.keyboard.type('/diagram');
    await page.keyboard.press('Enter');
    await expect(editorDialog(page).getByText('Flowcharts')).toBeVisible();
    await expectNoA11yViolations(page);
    await editorDialog(page).getByRole('button', { name: 'Decision' }).click();
    await expect(canvas(page).locator('svg')).toBeVisible();

    // Click a box: it is selected and the panel shows it; + adds a connected box, named by typing.
    await canvas(page).locator('g.node').filter({ hasText: 'Ship it' }).click();
    await expect(canvas(page).locator('.diagram-ring')).toHaveCount(1);
    await expect(editorDialog(page).getByLabel('Label')).toHaveValue('Ship it');
    await editorDialog(page).getByRole('button', { name: 'Add a connected box' }).click();
    await page.keyboard.type('Celebrate');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Sleep');
    await page.keyboard.press('Enter');
    await expect(canvas(page).locator('g.node').filter({ hasText: 'Sleep' })).toHaveCount(1);
    await canvas(page).locator('g.node').filter({ hasText: 'Sleep' }).click();
    await editorDialog(page).getByRole('radio', { name: 'Green' }).click();
    await editorDialog(page).getByRole('radio', { name: 'Pill' }).click();
    await expectNoA11yViolations(page);

    // Undo and redo, then Done: Mermaid code in the page, drawn.
    await editorDialog(page).getByRole('button', { name: 'Undo' }).click();
    await editorDialog(page).getByRole('button', { name: 'Redo' }).click();
    await editorDialog(page).getByRole('button', { name: 'Done' }).click();
    await expect(editorDialog(page)).toBeHidden();
    await expect.poll(() => codeOf(storedDiagram(api)), { timeout: 10_000 }).toContain('Sleep');
    const code = codeOf(storedDiagram(api));
    expect(code).toMatch(/^flowchart TD\n/);
    expect(code).toContain('Celebrate');
    expect(code).toMatch(/n\d+ --> n\d+/);
    expect(code).toContain('classDef m-green');
    await expect(page.locator('.ProseMirror .rich-diagram .diagram-drawing > svg')).toBeVisible();

    // Selected like an image: a caption, an alignment, a size.
    await page.locator('.ProseMirror .rich-diagram-frame').click();
    await expect(page.getByRole('toolbar', { name: 'Diagram' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Text style' })).toHaveText(/Diagram/);
    await page.getByRole('button', { name: 'Add a caption' }).click();
    await page.getByRole('textbox', { name: 'Caption' }).fill('How orders flow');
    await page.keyboard.press('Enter');
    await page.locator('.ProseMirror .rich-diagram-frame').click();
    await page.getByRole('button', { name: 'Align left' }).click();
    await expect
      .poll(() => storedDiagram(api)?.attrs, { timeout: 10_000 })
      .toMatchObject({ caption: 'How orders flow', align: 'left' });

    // Enter opens it again; Escape without changes closes it.
    await page.locator('.ProseMirror .rich-diagram-frame').click();
    await page.keyboard.press('Enter');
    await expect(editorDialog(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Flowchart' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editorDialog(page)).toBeHidden();
  });

  test('a drag from one box to another connects them', async ({ page }) => {
    const api = await open(page, 'pricing', richWith(FLOW));
    await page.locator('.ProseMirror .rich-diagram-frame').click();
    await page.getByRole('button', { name: 'Edit diagram' }).click();
    await expect(canvas(page).locator('svg')).toBeVisible();
    const from = await canvas(page).locator('g.node').filter({ hasText: 'Ship it' }).boundingBox();
    const to = await canvas(page)
      .locator('g.node')
      .filter({ hasText: 'Order received' })
      .boundingBox();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(from!.x + 60, from!.y - 20, { steps: 4 });
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
    await page.mouse.up();
    await editorDialog(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => codeOf(storedDiagram(api)), { timeout: 10_000 }).toContain('n3 --> n1');
  });

  test('a diagram with a mistake shows what is wrong, and its code can be fixed', async ({
    page,
  }) => {
    await open(page, 'pricing', richWith('flowchart TD\n  A --> '));
    await expect(page.locator('.ProseMirror .rich-diagram')).toContainText(
      'The diagram has a mistake',
    );
  });
});

test.describe('Markdown pages', () => {
  test('the source view draws diagrams; the editor writes the fence back', async ({ page }) => {
    const before = `Text above\n\n${fence(MIND)}\n\nText below\n`;
    const api = await open(page, 'q4', before);
    const drawn = page.locator('.cm-diagram .diagram-drawing > svg');
    await expect(drawn).toBeVisible();
    await page.locator('.cm-diagram').hover();
    await page.locator('.cm-diagram').getByRole('button', { name: 'Edit diagram' }).click();
    await expect(canvas(page).locator('svg')).toBeVisible();

    // The outline: Enter adds a topic, Tab makes it a child.
    await editorDialog(page).getByRole('textbox', { name: 'Topic, level 1' }).last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Budget');
    await page.keyboard.press('Tab');
    await expect(
      canvas(page).locator('g.mindmap-node').filter({ hasText: 'Budget' }),
    ).toBeVisible();

    // Markdown pages can show the code too.
    await editorDialog(page).getByRole('radio', { name: 'Code' }).click();
    await expect(editorDialog(page).locator('.diagram-code .cm-content')).toContainText('Budget');
    await editorDialog(page).getByRole('button', { name: 'Done' }).click();
    await expect(editorDialog(page)).toBeHidden();
    await expect
      .poll(() => api.notes.content.get('q4'), { timeout: 10_000 })
      .toBe(
        `Text above\n\n${fence(`mindmap\n  root(("Plan"))\n    Goals\n    Risks\n      Budget`)}\n\nText below\n`,
      );

    // Show code puts the cursor in the fence, which then shows its code.
    await page.locator('.cm-diagram').hover();
    await page.locator('.cm-diagram').getByRole('button', { name: 'Show code' }).click();
    await expect(page.locator('.cm-diagram')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText('root(("Plan"))');
  });

  test('a diagram at the top of a page is drawn when it opens', async ({ page }) => {
    await open(page, 'q4', `${fence(MIND)}\n\nAfter\n`);
    await expect(page.locator('.cm-diagram .diagram-drawing > svg')).toBeVisible();
    await expect(page.locator('.cm-line').filter({ hasText: 'root((Plan))' })).toHaveCount(0);
  });

  test('the preview has an Edit button; the sequence editor adds steps', async ({ page }) => {
    const api = await open(page, 'q4', `${fence(SEQUENCE)}\n`);
    await page.getByRole('radio', { name: 'Preview' }).click();
    const figure = page.locator('[data-preview] .mermaid-diagram');
    await expect(figure.locator('.diagram-drawing > svg')).toBeVisible();
    await figure.hover();
    await figure.locator('.diagram-edit').click();
    await expect(page.getByRole('heading', { name: 'Sequence diagram' })).toBeVisible();
    await editorDialog(page).getByRole('button', { name: 'Message', exact: true }).click();
    await expect(canvas(page).locator('text.messageText')).toHaveCount(2);
    await editorDialog(page).getByRole('button', { name: 'Done' }).click();
    await expect
      .poll(() => api.notes.content.get('q4'), { timeout: 10_000 })
      .toContain('A->>B: Message');
  });
});

test.describe('exports and history', () => {
  test('a PDF draws the diagram; Word gets a picture of it', async ({ page }) => {
    const api = new FakeApi();
    api.pdf = true;
    await open(page, 'q4', `# Plan\n\n${fence(FLOW)}\n`, api);
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await dialog.getByRole('radio', { name: 'PDF' }).check();
    await dialog.getByRole('button', { name: 'Preview…' }).click();
    const preview = page.getByRole('dialog', { name: 'Print or save as PDF' });
    const sheet = preview.frameLocator('iframe[title="Print preview"]');
    await expect(sheet.locator('figure.diagram svg')).toBeVisible({ timeout: 15_000 });
    const download = page.waitForEvent('download');
    await preview.getByRole('button', { name: 'Download PDF' }).click();
    await download;
    const sent = api.requests.find((r) => r.path === '/api/v1/exports/pdf');
    const html = String((sent?.body as { html?: string } | undefined)?.html);
    expect(html).toContain('<figure class="diagram"');
    expect(html).toContain('<svg');
    expect(html).not.toContain('```mermaid');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    await dialog.getByRole('radio', { name: 'Word document (.docx)' }).check();
    const word = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export' }).click();
    const data = await readFile((await (await word).path())!);
    // The picture is in the zip's media folder.
    expect(data.includes(Buffer.from('word/media/'))).toBe(true);
  });

  test('a version in the history draws its diagrams', async ({ page }) => {
    const api = new FakeApi();
    api.notes.keep('q4', `Before\n\n${fence(MIND)}\n`, 'manual', {
      name: 'With a map',
      ago: 3_600_000,
    });
    await open(page, 'q4', undefined, api);
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: 'History' }).click();
    const dialog = page.getByRole('dialog', { name: 'Version history' });
    await dialog
      .getByRole('navigation', { name: 'Versions' })
      .getByRole('button', { name: /With a map/ })
      .click();
    await dialog.getByRole('radio', { name: 'Version', exact: true }).click();
    await expect(dialog.locator('.version-view .diagram-drawing > svg')).toBeVisible();
  });
});

test.describe('the look', () => {
  const SHOWCASE = [
    'flowchart LR\n    n1(["Start"]) --> n2{"Ready?"}\n    n2 -->|Yes| n3["Ship it"]\n    n2 -->|No| n4["Fix it"]\n    n4 -.-> n2',
    'mindmap\n  root((Project))\n    Goals\n      Fast\n      Simple\n    Risks\n      Scope\n    People\n      Design',
    'sequenceDiagram\n  participant U as You\n  participant A as App\n  U->>+A: Open a page\n  A-->>-U: Show it\n  Note over U,A: Saved as you type',
  ];

  for (const theme of ['light', 'dark'] as const) {
    test(`diagrams in Memora's style, ${theme}`, async ({ page }) => {
      await setTheme(page, theme);
      await open(page, 'q4', SHOWCASE.map(fence).join('\n\n') + '\n');
      await page.getByRole('radio', { name: 'Preview' }).click();
      const figures = page.locator('[data-preview] .mermaid-diagram .diagram-drawing > svg');
      await expect(figures).toHaveCount(3, { timeout: 15_000 });
      // Each in Memora's colours: the mind map's centre in the accent, boxes in the palette.
      const root = page.locator('[data-preview] g.mindmap-node.mm-root > circle');
      await expect(root).toHaveCSS(
        'fill',
        theme === 'dark' ? 'rgb(187, 199, 255)' : 'rgb(45, 51, 123)',
      );
      for (let i = 0; i < 3; i++) {
        await figures.nth(i).scrollIntoViewIfNeeded();
        await expect(page.locator('[data-preview] .mermaid-diagram').nth(i)).toHaveScreenshot(
          `diagram-${i + 1}-${theme}.png`,
        );
      }
    });
  }
});
