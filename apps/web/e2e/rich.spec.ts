import type { RichNode } from '@memora/shared';
import { expect, test, type Page } from '@playwright/test';
import { FakeApi, PNG, expectNoA11yViolations, fontsReady } from './helpers';
import { richDoc } from './notes';

/*
 * The rich text editor (Phase 6, §9.4, §9.5): formatting as in a word processor, the
 * Word-like toolbar, images and files, cleaned-up pasting, and converting pages between
 * Markdown and rich text.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const editor = (page: Page) => page.getByRole('textbox', { name: 'Page content', exact: true });

/** The page as the fake server has it. */
const stored = (api: FakeApi, id = 'pricing'): RichNode | null => {
  const content = api.notes.content.get(id) ?? '';
  return content ? (JSON.parse(content) as RichNode) : null;
};
const types = (node: RichNode | null): string[] =>
  node
    ? [
        node.type,
        ...(node.marks ?? []).map((m) => `mark:${m.type}`),
        ...(node.content ?? []).flatMap(types),
      ]
    : [];

async function open(page: Page, content?: string, id = 'pricing', api = new FakeApi()) {
  if (content !== undefined) api.notes.content.set(id, content);
  await api.install(page);
  await page.goto(`/p/${id}`);
  await expect(editor(page)).toBeVisible();
  await fontsReady(page);
  return api;
}

/** Pastes clipboard data into the editor. */
async function paste(page: Page, data: Record<string, string>, png?: boolean) {
  await editor(page).evaluate(
    async (el, { data, png }) => {
      const transfer = new DataTransfer();
      for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
      if (png) {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 20;
        canvas.getContext('2d')!.fillRect(0, 0, 40, 20);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), 'image/png'),
        );
        transfer.items.add(new File([blob], 'image.png', { type: 'image/png' }));
      }
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { data, png },
  );
}

test('formatting, lists and tables are typed like in a word processor, and saved', async ({
  page,
}) => {
  const api = await open(page, '');
  await editor(page).click();
  await page.keyboard.type('# Pricing');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plans start at ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('nine euros');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' a month.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- Basic');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Pro');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/table');
  await page.getByRole('option', { name: 'Table' }).click();
  await page.keyboard.type('Plan');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Price');
  await expect(editor(page).getByRole('heading', { name: 'Pricing', level: 1 })).toBeVisible();
  await expect(editor(page).locator('strong')).toHaveText('nine euros');
  await expect(editor(page).locator('ul > li')).toHaveText(['Basic', 'Pro']);
  await expect(editor(page).locator('th').first()).toHaveText('Plan');
  // The page reaches the server as a document.
  await expect
    .poll(() => types(stored(api)), { timeout: 10_000 })
    .toEqual(
      expect.arrayContaining(['heading', 'mark:bold', 'bulletList', 'table', 'tableHeader']),
    );
  expect(api.notes.tree.pages.find((p) => p.id === 'pricing')?.snippet).toContain(
    'Plans start at nine euros',
  );
});

test('the toolbar is grouped Home, Insert and Table, and condenses on narrow panes', async ({
  page,
}) => {
  await open(page, richDoc('Some text'));
  const tabs = page.getByRole('tablist', { name: 'Toolbar' });
  await expect(tabs.getByRole('tab')).toHaveText(['Home', 'Insert']);
  await tabs.getByRole('tab', { name: 'Insert' }).click();
  await expect(page.getByRole('button', { name: 'Insert table' })).toBeVisible();
  await page.getByRole('button', { name: 'Insert table' }).click();
  await page.getByRole('button', { name: '2 columns, 2 rows' }).click();
  await expect(editor(page).locator('table tr')).toHaveCount(3);
  // In a table, the Table tab appears.
  await tabs.getByRole('tab', { name: 'Table' }).click();
  await page.getByRole('button', { name: 'Row below' }).click();
  await expect(editor(page).locator('table tr')).toHaveCount(4);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tabs).toBeHidden();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Image…' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('text from Word keeps its formatting, cleaned', async ({ page }) => {
  const api = await open(page, '');
  await editor(page).click();
  await paste(page, {
    'text/html': `<p class=MsoNormal style='font-family:"Calibri",sans-serif;color:black;mso-bidi-font-size:11.0pt'>Budget <b>approved</b> <span style='color:#C00000'>today</span></p>
      <p class=MsoListParagraph style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp; </span></span></span><![endif]>Hire two people</p>`,
    'text/plain': 'Budget approved today\nHire two people',
  });
  await expect(editor(page).locator('strong')).toHaveText('approved');
  await expect(editor(page).locator('ul > li')).toHaveText(['Hire two people']);
  const html = await editor(page).innerHTML();
  expect(html).not.toMatch(/mso-|Calibri|MsoNormal|·/);
  await expect.poll(() => types(stored(api)), { timeout: 10_000 }).toContain('bulletList');
  expect(api.notes.content.get('pricing')).toContain('#c00000');
});

test('images pasted with a web page are downloaded into the page', async ({ page }) => {
  const api = new FakeApi();
  api.web.set('https://images.example/cat.png', PNG);
  await open(page, '', 'pricing', api);
  await editor(page).click();
  await paste(page, {
    'text/html':
      '<p>A cat: <img src="https://images.example/cat.png" alt="Cat"> and <img src="https://gone.example/dog.png" alt="Dog"></p>',
    'text/plain': 'A cat',
  });
  // The one the server could download now lives in the page's files.
  await expect(editor(page).getByRole('img', { name: 'Cat' })).toHaveAttribute(
    'src',
    /^\/api\/v1\/assets\/0190e5a4-/,
  );
  // The other keeps its web address, and says so.
  await expect(page.getByText('An image couldn’t be downloaded')).toBeVisible();
  await expect(editor(page).getByText('not kept in this page yet')).toBeVisible();
  expect(
    api.requests
      .filter((r) => r.path === '/api/v1/assets/fetch')
      .map((r) => (r.body as { url?: string }).url),
  ).toEqual(
    expect.arrayContaining(['https://images.example/cat.png', 'https://gone.example/dog.png']),
  );
});

test('a pasted screenshot can be aligned, captioned and opened full size', async ({ page }) => {
  const api = await open(page, '');
  await editor(page).click();
  await paste(page, {}, true);
  const image = editor(page).locator('figure.rich-image');
  await expect(image.getByRole('img')).toBeVisible();
  await expect.poll(() => api.files.size).toBe(1);
  await image.getByRole('img').click();
  await page.getByRole('button', { name: 'Left, text beside it' }).click();
  await expect(image).toHaveAttribute('data-align', 'left');
  await page.getByRole('button', { name: 'Add a caption' }).click();
  await page.getByRole('textbox', { name: 'Caption' }).fill('The sales chart');
  await page.getByRole('button', { name: 'Open full size' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect
    .poll(() => JSON.stringify(stored(api)), { timeout: 10_000 })
    .toMatch(
      /"align":"left".*"caption":"The sales chart"|"caption":"The sales chart".*"align":"left"/,
    );
});

test('[[ links to a page, and Ctrl+click follows it', async ({ page }) => {
  await open(page, '');
  await editor(page).click();
  await page.keyboard.type('See [[Launch');
  await page.getByRole('option', { name: 'Launch checklist' }).click();
  const link = editor(page).getByRole('link', { name: 'Launch checklist' });
  await expect(link).toHaveAttribute('href', 'wiki:Launch%20checklist');
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect(page).toHaveURL(/\/p\/launch$/);
});

test('converting to rich text keeps everything, and back reports what Markdown can’t keep', async ({
  page,
}) => {
  const api = new FakeApi();
  api.notes.content.set('q4', '# Plan\n\n**Ship** it.\n\n- [x] done\n\n> [!TIP]\n> Go.');
  await api.install(page);
  await page.goto('/p/q4');
  await expect(page.getByRole('textbox', { name: 'Page content', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Convert to rich text…' }).click();
  await expect(page.getByRole('dialog', { name: 'Convert to rich text' })).toContainText(
    'Nothing is lost',
  );
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'Toolbar' })).toBeVisible();
  await expect(editor(page).getByRole('heading', { name: 'Plan' })).toBeVisible();
  await expect(editor(page).locator('.markdown-alert[data-kind="tip"]')).toContainText('Go.');
  expect(api.notes.versions).toContainEqual(
    expect.objectContaining({ pageId: 'q4', reason: 'conversion' }),
  );
  // Colour some text, then go back to Markdown.
  await editor(page).getByText('Go.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Text colour' }).click();
  await page.getByRole('button', { name: 'Red', exact: true }).click();
  await expect(editor(page).locator('span[style*="color"]')).toHaveText('Go.');
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Convert to Markdown…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convert to Markdown' });
  await expect(dialog).toContainText('Text colours');
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect
    .poll(() => api.notes.content.get('q4'))
    .toBe('# Plan\n\n**Ship** it.\n\n- [x] done\n\n> [!TIP]\n> Go.');
});

test('the rich editor has no accessibility violations', async ({ page }) => {
  await open(
    page,
    JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Some text.' }] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task' }] }],
            },
          ],
        },
      ],
    }),
  );
  await expectNoA11yViolations(page);
});
