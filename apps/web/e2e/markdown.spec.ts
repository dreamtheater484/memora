import { expect, test, type Page } from '@playwright/test';
import { FakeApi, expectNoA11yViolations, fontsReady } from './helpers';

/*
 * The Markdown editor (Phase 5, §9.3): tables that line up, the rendered dialect, writing
 * aids, paste, views per page, and typing on a very long page.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const editor = (page: Page) => page.getByRole('textbox', { name: 'Page content', exact: true });
const preview = (page: Page) => page.locator('[data-preview] .markdown-body');
const source = (page: Page) =>
  editor(page).evaluate((el) =>
    [...el.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').join('\n'),
  );

async function open(page: Page, content?: string, id = 'q4', api = new FakeApi()) {
  if (content !== undefined) api.notes.content.set(id, content);
  await api.install(page);
  await page.goto(`/p/${id}`);
  await expect(editor(page)).toBeVisible();
  await fontsReady(page);
  return api;
}

/** Puts the cursor at the end of the page. */
async function toEnd(page: Page) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
}

/** Screen positions of the pipes in each table line of the source. */
function pipeColumns(page: Page): Promise<number[][]> {
  return editor(page).evaluate((el) =>
    [...el.querySelectorAll('.cm-line')]
      .filter((line) => line.textContent?.trim().startsWith('|'))
      .map((line) => {
        const xs: number[] = [];
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          for (let i = 0; i < text.length; i += 1) {
            if (text[i] !== '|') continue;
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            xs.push(Math.round(range.getBoundingClientRect().left));
          }
        }
        return xs;
      }),
  );
}

test('tables line up as they are typed, emoji and CJK included', async ({ page }) => {
  await open(page, 'Shopping\n');
  await toEnd(page);
  await page.keyboard.type('| Item | Qty |');
  await page.keyboard.press('Enter');
  await page.keyboard.type('|-|-|');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Apples 🍎');
  await page.keyboard.press('Tab');
  await page.keyboard.type('3');
  await page.keyboard.press('Tab');
  await page.keyboard.type('東京の野菜');
  await page.keyboard.press('Tab');
  await page.keyboard.type('12');
  await expect
    .poll(() => source(page))
    .toBe(
      [
        'Shopping',
        '| Item       | Qty |',
        '| ---------- | --- |',
        '| Apples 🍎  | 3   |',
        '| 東京の野菜 | 12  |',
      ].join('\n'),
    );
  // Every row's pipes sit exactly under the header's, as drawn on screen.
  const columns = await pipeColumns(page);
  expect(columns).toHaveLength(4);
  for (const row of columns) expect(row).toEqual(columns[0]);
});

test('the preview shows the whole dialect', async ({ page }) => {
  await open(
    page,
    [
      '# Plan',
      '',
      '**bold**, ~~gone~~ and a note[^1].',
      '',
      '> [!WARNING]',
      '> Mind the gap.',
      '',
      '- [ ] open task',
      '- [x] done task',
      '',
      '$$',
      'e^{i\\pi} + 1 = 0',
      '$$',
      '',
      '```js',
      'const answer = 42;',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '<details><summary>More</summary>Hidden</details>',
      '',
      '<script>window.hacked = true</script>',
      '',
      '[^1]: The note.',
    ].join('\n'),
  );
  const body = preview(page);
  await expect(body.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
  await expect(body.locator('strong')).toHaveText('bold');
  await expect(body.locator('del')).toHaveText('gone');
  await expect(body.locator('.markdown-alert-warning')).toContainText('Mind the gap.');
  await expect(body.locator('.task-box')).toHaveCount(2);
  await expect(body.locator('.katex-display')).toBeVisible();
  await expect(body.locator('.shiki span[style*="--shiki"]').first()).toBeAttached();
  await expect(body.locator('.mermaid-diagram svg')).toBeVisible({ timeout: 15_000 });
  await expect(body.locator('details summary')).toHaveText('More');
  await expect(body.locator('.footnotes')).toContainText('The note.');
  expect(await page.evaluate(() => (window as { hacked?: boolean }).hacked)).toBeUndefined();
});

test('ticking a task in the preview changes the page', async ({ page }) => {
  const api = await open(page, '- [ ] water the plants\n- [ ] call home');
  await preview(page).getByRole('checkbox').first().check();
  await expect.poll(() => source(page)).toBe('- [x] water the plants\n- [ ] call home');
  await expect
    .poll(() => api.notes.content.get('q4'), { timeout: 10_000 })
    .toBe('- [x] water the plants\n- [ ] call home');
});

test('a pasted image is kept, linked and shown', async ({ page }) => {
  const api = await open(page, 'Screenshot:\n');
  await toEnd(page);
  await editor(page).evaluate(async (el) => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 20;
    canvas.getContext('2d')!.fillRect(0, 0, 40, 20);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    );
    const data = new DataTransfer();
    data.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect
    .poll(() => source(page))
    .toMatch(/^Screenshot:\n!\[Pasted image\]\(asset:[0-9a-f-]{36}\)$/);
  await expect.poll(() => api.files.size).toBe(1);
  const [id] = [...api.files.keys()];
  expect((await source(page)).includes(`asset:${id}`)).toBe(true);
  const image = preview(page).getByRole('img');
  await expect(image).toBeVisible();
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40);
  // Opens full size.
  await preview(page).getByRole('button', { name: 'Open image: Pasted image' }).click();
  await expect(page.getByRole('dialog', { name: 'Pasted image' })).toBeVisible();
});

test('slash commands insert blocks, and [[ links to pages', async ({ page }) => {
  await open(page, '');
  await editor(page).click();
  await page.keyboard.type('/tab');
  await page.getByRole('option', { name: /\/table/ }).click();
  await expect.poll(() => source(page)).toContain('| Column 1 | Column 2 | Column 3 |');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('See [[Laun');
  await page.getByRole('option', { name: 'Launch checklist' }).click();
  await expect.poll(() => source(page)).toContain('See [[Launch checklist]]');
  const link = preview(page).getByRole('link', { name: 'Launch checklist' });
  await expect(link).toHaveAttribute('href', '/p/launch');
  await link.click();
  await expect(page).toHaveURL(/\/p\/launch$/);
});

test('each page keeps its view, and phones switch between editing and preview', async ({
  page,
}) => {
  const api = await open(page, '# Hello');
  await expect(page.locator('[data-view-mode]')).toHaveAttribute('data-view-mode', 'split');
  await page.getByRole('radio', { name: 'Preview' }).click();
  await expect(page.locator('[data-view-mode]')).toHaveAttribute('data-view-mode', 'preview');
  await expect
    .poll(() =>
      api.requests.some(
        (r) =>
          r.method === 'PATCH' &&
          r.path === '/api/v1/pages/q4' &&
          (r.body as { viewMode?: string }).viewMode === 'preview',
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator('[data-view-mode]')).toHaveAttribute('data-view-mode', 'preview');
  await expect(preview(page).getByRole('heading', { name: 'Hello' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('radio', { name: 'Edit' }).click();
  await expect(editor(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the outline lists the headings and jumps to them', async ({ page }) => {
  const filler = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}`).join('\n\n');
  await open(page, `# First\n\n${filler}\n\n## Second\n\nEnd`);
  await page.getByRole('button', { name: 'Outline' }).click();
  const outline = page.getByRole('navigation', { name: 'Outline' });
  await expect(outline.getByRole('button')).toHaveText(['First', 'Second']);
  await outline.getByRole('button', { name: 'Second' }).click();
  await expect(editor(page).locator('.cm-activeLine')).toHaveText('## Second');
  await expect(preview(page).getByRole('heading', { name: 'Second' })).toBeInViewport();
});

test('the editor has no accessibility violations', async ({ page }) => {
  await open(page, '# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [ ] task');
  await expect(preview(page).locator('table')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('typing in a 10,000-line page stays smooth', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Long animation frames are measured in Chromium only.');
  const lines = Array.from({ length: 10_000 }, (_, i) =>
    i % 50 === 0
      ? `## Section ${i / 50 + 1}`
      : `Line ${i + 1}: the quick brown fox jumps over the lazy dog.`,
  );
  const api = new FakeApi();
  api.notes.tree.pages = api.notes.tree.pages.map((p) =>
    p.id === 'q4' ? { ...p, viewMode: 'source' } : p,
  );
  await open(page, lines.join('\n'), 'q4', api);
  await expect(page.locator('[data-view-mode]')).toHaveAttribute('data-view-mode', 'source');
  await editor(page).locator('.cm-line').nth(3).click();
  await page.keyboard.press('End');
  await page.evaluate(() => {
    const w = window as unknown as { blocking: number[] };
    w.blocking = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.blocking.push((entry as unknown as { blockingDuration: number }).blockingDuration);
      }
    }).observe({ type: 'long-animation-frame' });
  });
  const started = Date.now();
  await page.keyboard.type(' and then some more words', { delay: 40 });
  const elapsed = Date.now() - started;
  await expect(editor(page)).toContainText('lazy dog. and then some more words');
  const blocking = await page.evaluate(
    () => (window as unknown as { blocking: number[] }).blocking,
  );
  // No frame held up for long while typing (a 60 Hz frame is 16 ms; CI machines are slower).
  expect(Math.max(0, ...blocking), `blocking: ${blocking.join(', ')}`).toBeLessThan(100);
  expect(elapsed).toBeLessThan(25 * 40 + 2000);
});
