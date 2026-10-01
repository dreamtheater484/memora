import { richFont, type RichNode } from '@memora/shared';
import { expect, test, type Page } from '@playwright/test';
import { FakeApi, PNG, expectNoA11yViolations, fontsReady } from './helpers';
import { richDoc } from './notes';

/*
 * The rich text editor (Phase 6, §9.4, §9.5): formatting as in a word processor, the
 * Word-like toolbar, images and files, cleaned-up pasting, and converting pages between
 * Markdown and rich text. Pages behave like a notebook's: text from the top left, an edge
 * to set its width, to-dos ticked from the keyboard, Tab that indents.
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

test('to-dos sit on their line, are ticked from the keyboard, and done ones are struck through', async ({
  page,
}) => {
  const api = await open(page, '');
  await editor(page).click();
  await page.keyboard.type('[ ] Buy milk');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Eggs');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Free range');
  await page.keyboard.press('ControlOrMeta+Enter');
  const done = editor(page).locator('li[data-checked="true"]');
  await expect(done.locator('p')).toHaveText('Free range');
  await expect(done.locator('p')).toHaveCSS('text-decoration-line', 'line-through');
  // The box is on the line of its text, and a nested to-do is clearly further in.
  const lines = await editor(page).evaluate((root) =>
    [...root.querySelectorAll('li[data-checked]')].map((li) => {
      const box = li.querySelector('input')!.getBoundingClientRect();
      const text = li.querySelector('p')!.getBoundingClientRect();
      return { offset: box.top + box.height / 2 - (text.top + text.height / 2), left: text.left };
    }),
  );
  for (const line of lines) expect(Math.abs(line.offset)).toBeLessThan(3);
  expect(lines[2]!.left - lines[1]!.left).toBeGreaterThan(18);
  await expect(editor(page).locator('ul[data-type="taskList"]').first()).toHaveScreenshot(
    'todos.png',
  );

  // Ctrl+1 makes a line a to-do, and ticks it when it is one.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Call the bank');
  await page.keyboard.press('ControlOrMeta+1');
  const bank = editor(page).locator('li[data-checked]').filter({ hasText: 'Call the bank' });
  await expect(bank).toHaveAttribute('data-checked', 'false');
  await page.keyboard.press('ControlOrMeta+1');
  await expect(bank).toHaveAttribute('data-checked', 'true');
  await expect
    .poll(() => JSON.stringify(stored(api)), { timeout: 10_000 })
    .toMatch(/"checked":true.*Call the bank/);
});

test('Tab indents in the page, and Escape then Tab leaves it', async ({ page }) => {
  const api = await open(page, richDoc('Notes from the call'));
  await editor(page).getByText('Notes from the call').click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const paragraph = editor(page).locator('p').first();
  await expect(paragraph).toHaveAttribute('data-indent', '2');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(paragraph).toHaveAttribute('data-indent', '1');
  await expect.poll(() => JSON.stringify(stored(api)), { timeout: 10_000 }).toContain('"indent":1');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(editor(page)).not.toBeFocused();
});

test('Ctrl+Space clears the formatting of the selection', async ({ page }) => {
  await open(page, '');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('bold words');
  await expect(editor(page).locator('strong')).toHaveText('bold words');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Control+Space');
  await expect(editor(page).locator('strong')).toHaveCount(0);
});

test('Enter in the title goes on to the text, without losing what is typed', async ({ page }) => {
  const api = await open(page, richDoc('First line'));
  await page
    .getByRole('main')
    .getByRole('heading', { name: 'Pricing experiments', level: 1 })
    .click();
  // Typed at once, as a quick typist would.
  await page.keyboard.type('Price list');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Intro. ');
  await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator('p').first()).toHaveText('Intro. First line');
  await expect
    .poll(() => api.notes.tree.pages.find((p) => p.id === 'pricing')?.title)
    .toBe('Price list');
});

test('a click beside or below the text puts the cursor there', async ({ page }) => {
  await open(page, richDoc('Alpha\n\nBeta'));
  const box = (await page.locator('.rich-sheet').boundingBox())!;
  const text = (await editor(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, text.y + text.height + 80);
  await page.keyboard.type(' end');
  await expect(editor(page).locator('p').last()).toHaveText('Beta end');
  const alpha = (await editor(page).getByText('Alpha').boundingBox())!;
  await page.mouse.click(box.x + 4, alpha.y + alpha.height / 2);
  await page.keyboard.type('First: ');
  await expect(editor(page).locator('p').first()).toHaveText('First: Alpha');
});

test('the text starts under the title, and its right edge sets its width', async ({ page }) => {
  const api = await open(page, richDoc('Some text'));
  const title = page.getByRole('main').getByRole('heading', { level: 1 }).first();
  const [text, heading, pane] = await Promise.all([
    editor(page).boundingBox(),
    title.boundingBox(),
    page.locator('.rich-sheet').boundingBox(),
  ]);
  expect(Math.abs(text!.x - heading!.x)).toBeLessThan(2);
  // It fills the pane, inside the page's margins.
  expect(pane!.x + pane!.width - (text!.x + text!.width)).toBeLessThan(40);

  const edge = page.getByRole('separator', { name: 'Text width' });
  const grip = (await edge.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 20);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 300, grip.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => api.notes.settings.ui.pageWidths?.pricing).toBeGreaterThan(0);
  const narrowed = api.notes.settings.ui.pageWidths!.pricing!;
  expect(Math.abs((await editor(page).boundingBox())!.width - narrowed)).toBeLessThan(2);
  // The keyboard moves it too.
  await edge.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => api.notes.settings.ui.pageWidths?.pricing).toBe(narrowed - 20);
  // A double-click fits the text to the pane again, as does the page menu.
  await edge.dblclick();
  await expect.poll(() => api.notes.settings.ui.pageWidths?.pricing).toBeUndefined();
  expect((await editor(page).boundingBox())!.width).toBeGreaterThan(text!.width - 2);
});

test('rich text takes its font, size and spacing from Settings → Editing', async ({ page }) => {
  const api = new FakeApi();
  api.notes.settings.editor = {
    richFont: richFont('Georgia'),
    richFontSize: 14,
    richSpacing: 'comfortable',
  };
  await open(page, richDoc('Some text'), 'pricing', api);
  const paragraph = editor(page).locator('p').first();
  await expect(paragraph).toHaveCSS('font-size', '18.6667px');
  await expect(paragraph).toHaveCSS('font-family', /^Georgia/);
  await expect(page.getByRole('button', { name: 'Font', exact: true })).toHaveText('Georgia');
  await expect(page.getByRole('button', { name: 'Font size', exact: true })).toHaveText('14');

  await page.goto('/settings/editing');
  await page.getByRole('radio', { name: 'Compact' }).click();
  await expect.poll(() => api.notes.settings.editor.richSpacing).toBe('compact');
});

test('at laptop widths the toolbar wraps rather than hiding the essentials', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, richDoc('Some text'));
  for (const name of [
    'Text style',
    'Font',
    'Font size',
    'Bold',
    'Italic',
    'Underline',
    'Text colour',
    'Highlight',
    'Alignment',
    'Bullet list',
    'Numbered list',
    'Task list',
    'Decrease indent',
    'Increase indent',
    'Link',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
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
