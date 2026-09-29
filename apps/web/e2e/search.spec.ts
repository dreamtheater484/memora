import { expect, test, type Page } from '@playwright/test';
import { FakeApi, NOW, expectNoA11yViolations, fontsReady } from './helpers';
import { richDoc } from './notes';

/*
 * Search, tags, links, favourites, recent pages, back and forward, templates, and find and
 * replace (Phase 8, §9.8, §9.9).
 */

test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, path: string, api = new FakeApi()) {
  await api.install(page);
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
  await fontsReady(page);
  return api;
}

const editorText = (page: Page) =>
  page
    .evaluate(() =>
      Array.from(
        document.querySelectorAll('section[aria-label="Editor"] .cm-content .cm-line'),
        (line) => line.textContent ?? '',
      ).join('\n'),
    )
    .catch(() => null);

test.describe('search', () => {
  test('finds pages as you type, marks the words and opens a result', async ({ page }) => {
    await open(page, '/search');
    await page.getByRole('searchbox', { name: 'Search' }).fill('outbox');
    const results = page.getByRole('list', { name: 'Results' });
    await expect(results.getByRole('listitem')).toHaveCount(3);
    await expect(results.locator('mark').first()).toHaveText(/outbox/i);
    await expect(page).toHaveURL(/q=outbox/);
    await expectNoA11yViolations(page);
    await results.getByRole('button', { name: /Design review notes/ }).click();
    await expect(page).toHaveURL(/\/p\/drn$/);
  });

  test('the palette offers a full-text search and lists recent pages first', async ({ page }) => {
    await open(page, '/p/q4');
    await page.getByRole('treeitem', { name: /^Open questions/ }).click();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Search and commands' });
    await expect(palette.getByRole('option').first()).toContainText('Open questions');
    await palette.getByRole('combobox').fill('swimlanes');
    await palette.getByRole('option', { name: /Search all pages for “swimlanes”/ }).click();
    await expect(page).toHaveURL(/\/search\?q=swimlanes/);
    await expect(
      page.getByRole('list', { name: 'Results' }).getByRole('button', { name: /Open questions/ }),
    ).toBeVisible();
  });
});

test.describe('tags', () => {
  test('adds tags with suggestions, lists a tag’s pages, and takes a tag off', async ({ page }) => {
    const api = await open(page, '/p/q4');
    await page.getByRole('button', { name: 'Add tag' }).click();
    await page.getByRole('combobox', { name: 'Add a tag' }).fill('Urgent');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const chip = page.getByRole('button', { name: 'Urgent', exact: true });
    await expect(chip).toBeVisible();
    await expect.poll(() => api.notes.tree.tags?.map((t) => t.name)).toEqual(['Urgent']);

    // Another page: the tag is offered as soon as its start is typed.
    await page.getByRole('treeitem', { name: /^Open questions/ }).click();
    await page.getByRole('button', { name: 'Add tag' }).click();
    await page.getByRole('combobox', { name: 'Add a tag' }).fill('urg');
    await expect(page.getByRole('option', { name: 'Urgent' })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Urgent', exact: true })).toBeVisible();
    expect(api.notes.tree.tags).toHaveLength(1);

    // The chip lists the tag's pages.
    await page.getByRole('button', { name: 'Urgent', exact: true }).click();
    await expect(page).toHaveURL(/\/search\?tag=/);
    await expect(page.getByRole('list', { name: 'Results' }).getByRole('listitem')).toHaveCount(2);

    // Taking it off a page.
    await page
      .getByRole('list', { name: 'Results' })
      .getByRole('button', { name: /Open questions/ })
      .click();
    await page.getByRole('button', { name: 'Remove tag Urgent' }).click();
    await expect(page.getByRole('button', { name: 'Urgent', exact: true })).toHaveCount(0);
    await expect.poll(() => api.notes.tree.pages.find((p) => p.id === 'openq')?.tags).toEqual([]);
  });

  test('the tag browser colours tags', async ({ page }) => {
    const api = new FakeApi();
    api.notes.respond('PUT', '/api/v1/pages/q4/tags', { names: ['Work'] });
    await open(page, '/search', api);
    const tags = page.getByRole('list', { name: 'Tags' });
    await expect(tags).toContainText('Work');
    await tags.getByRole('button', { name: 'Tag “Work” options' }).click();
    await page.getByRole('menuitem', { name: 'Colour' }).click();
    await page.getByRole('menuitemradio', { name: 'Teal' }).click();
    await expect.poll(() => api.notes.tree.tags?.[0]?.color).toBe('teal');
    await tags.getByRole('button', { name: /Work/ }).first().click();
    await expect(page.getByRole('list', { name: 'Results' }).getByRole('listitem')).toHaveCount(1);
  });
});

test.describe('links between pages', () => {
  test('renaming a page updates the links to it, and they preview the page', async ({ page }) => {
    const api = new FakeApi();
    api.notes.content.set('drn', 'See [[Q4 roadmap]] for the plan.');
    await open(page, '/p/drn', api);
    const link = page.locator('.markdown-body a.wiki-link', { hasText: 'Q4 roadmap' });
    await link.hover();
    const preview = page.getByRole('tooltip');
    await expect(preview).toContainText('Ship the offline outbox first, then polish search.');
    // Away from the link, the preview goes.
    await page.mouse.move(5, 5);
    await expect(preview).toBeHidden();

    // The row's own title: the middle of an open parent row is its first subpage.
    await page
      .getByRole('treeitem', { name: /^Q4 roadmap/ })
      .getByText('Q4 roadmap', { exact: true })
      .click();
    await expect(page).toHaveURL(/\/p\/q4$/);
    await page.getByRole('heading', { level: 1, name: 'Q4 roadmap' }).click();
    await page.getByRole('textbox', { name: 'Page title' }).fill('Roadmap 2027');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => api.notes.content.get('drn'))
      .toBe('See [[Roadmap 2027]] for the plan.');
    await page.getByRole('treeitem', { name: /^Design review notes/ }).click();
    await expect.poll(() => editorText(page)).toBe('See [[Roadmap 2027]] for the plan.');
  });

  test('the inspector lists the pages that link here', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const api = new FakeApi();
    api.notes.content.set('drn', 'See [[Q4 roadmap]].');
    await open(page, '/p/q4', api);
    const backlinks = page.getByRole('list', { name: 'Linked from' });
    await expect(backlinks.getByRole('button', { name: /Design review notes/ })).toBeVisible();
    await backlinks.getByRole('button', { name: /Design review notes/ }).click();
    await expect(page).toHaveURL(/\/p\/drn$/);
  });

  test('a rich page marks links to pages that don’t exist', async ({ page }) => {
    const api = new FakeApi();
    api.notes.content.set(
      'pricing',
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Gone',
                marks: [{ type: 'link', attrs: { href: 'wiki:Gone' } }],
              },
              { type: 'text', text: ' and ' },
              {
                type: 'text',
                text: 'Q4 roadmap',
                marks: [{ type: 'link', attrs: { href: 'wiki:Q4%20roadmap' } }],
              },
            ],
          },
        ],
      }),
    );
    await open(page, '/p/pricing', api);
    const editor = page.getByRole('textbox', { name: 'Page content', exact: true });
    await expect(editor.locator('.wiki-link-missing')).toHaveText('Gone');
    await editor.getByText('Q4 roadmap').hover();
    await expect(page.getByRole('tooltip')).toContainText('Ship the offline outbox first');
  });
});

test.describe('favourites, recent pages and going back', () => {
  test('stars pages into the sidebar, lists recent ones and goes back and forth', async ({
    page,
  }) => {
    await open(page, '/p/q4');
    await page.getByRole('button', { name: 'Add to favourites' }).click();
    const nav = page.getByRole('navigation', { name: 'Navigation' });
    await expect(nav.getByRole('list', { name: 'Favourites' })).toContainText('Q4 roadmap');
    await page.getByRole('treeitem', { name: /^Open questions/ }).click();
    await expect(page).toHaveURL(/\/p\/openq$/);
    await nav.getByRole('button', { name: /Recent/ }).click();
    await expect(nav.getByRole('list', { name: 'Recent' }).getByRole('button')).toHaveText([
      'Open questions',
      'Q4 roadmap',
    ]);
    await page.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/p\/q4$/);
    await page.getByRole('banner').getByRole('button', { name: 'Forward' }).click();
    await expect(page).toHaveURL(/\/p\/openq$/);
    await nav
      .getByRole('list', { name: 'Favourites' })
      .getByRole('button', { name: 'Q4 roadmap' })
      .click();
    await expect(page).toHaveURL(/\/p\/q4$/);
    await page.getByRole('button', { name: 'Remove from favourites' }).first().click();
    await expect(
      nav.getByRole('list', { name: 'Favourites' }).getByRole('button', { name: 'Q4 roadmap' }),
    ).toHaveCount(0);
  });
});

test.describe('templates', () => {
  test('makes pages from templates, and a section’s default', async ({ page }) => {
    const api = await open(page, '/p/q4');
    await page.getByRole('button', { name: 'New page from a template' }).click();
    await page.getByRole('menuitem', { name: 'Meeting notes' }).click();
    await page.keyboard.press('Escape');
    await expect.poll(() => editorText(page)).toContain('## Agenda');
    await expect.poll(() => editorText(page)).toContain('**Date:** 2026-09-29');

    await page.getByRole('button', { name: 'New page from a template' }).click();
    await page.getByRole('menuitem', { name: 'Default for this section' }).click();
    const todo = page.getByRole('menuitemradio', { name: 'To-do list' });
    await todo.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Page', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect.poll(() => editorText(page)).toContain('## This week');
    await expect
      .poll(() =>
        api.requests.some(
          (r) => r.body && (r.body as { ui?: { sectionTemplates?: unknown } }).ui?.sectionTemplates,
        ),
      )
      .toBe(true);
  });

  test('saves a page as a template, and inserts one with /template', async ({ page }) => {
    const api = await open(page, '/p/q4');
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: 'Save as template…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as template' });
    await dialog.getByLabel('Name').fill('Roadmap');
    await dialog.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByText('Saved as a template', { exact: true })).toBeVisible();
    expect(api.notes.templates.map((t) => t.name)).toEqual(['Roadmap']);

    await page.getByRole('treeitem', { name: /^Open questions/ }).click();
    const editor = page.locator('section[aria-label="Editor"] .cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/templ');
    await page.getByRole('option', { name: /template/ }).click();
    await page
      .getByRole('dialog', { name: 'Insert a template' })
      .getByRole('button', { name: 'Decision record' })
      .click();
    await expect.poll(() => editorText(page)).toContain('## Decision');
  });
});

test('find and replace in a rich page', async ({ page }) => {
  const api = new FakeApi();
  api.notes.content.set('pricing', richDoc('Plan the plan.\n\nA third plan.'));
  await open(page, '/p/pricing', api);
  const editor = page.getByRole('textbox', { name: 'Page content', exact: true });
  await editor.click();
  await page.keyboard.press('Control+f');
  const find = page.getByRole('search', { name: 'Find in page' });
  await find.getByRole('textbox', { name: 'Find' }).fill('plan');
  await expect(find).toContainText('1 of 3');
  await expect(editor.locator('.find-match')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(find).toContainText('2 of 3');
  await find.getByRole('button', { name: 'Replace' }).click();
  await find.getByRole('textbox', { name: 'Replace with' }).fill('idea');
  await find.getByRole('button', { name: 'Replace all' }).click();
  await expect(editor).toContainText('idea the idea.');
  await expect(editor).toContainText('A third idea.');
  await page.keyboard.press('Escape');
  await expect(find).toBeHidden();
  await expect.poll(() => api.notes.content.get('pricing')).toContain('idea the idea.');
});
