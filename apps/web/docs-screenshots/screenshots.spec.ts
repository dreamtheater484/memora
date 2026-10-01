import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';

/*
 * The documentation's screenshots, from a real Memora filled by scripts/demo/seed.mjs. Run by
 * scripts/demo/screenshots.mjs, which starts that Memora and passes its address and password.
 */

const OUT = '../../docs/images';
const password = process.env.MEMORA_DEMO_PASSWORD ?? '';

interface Tree {
  pages: { id: string; title: string }[];
}

async function signedIn(browser: Browser, options: BrowserContextOptions = {}) {
  const context = await browser.newContext({
    ...options,
    baseURL: process.env.MEMORA_DOCS_URL,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Username').fill('demo');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  // From the page, which has the session cookie (a request context leaves out a secure one
  // over plain http).
  const tree = (await page.evaluate(async () => (await fetch('/api/v1/tree')).json())) as Tree;
  const pageId = (title: string) => tree.pages.find((p) => p.title === title)!.id;
  return { page, pageId, close: () => context.close() };
}

/** Everything drawn: fonts, diagrams, and no animation left. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

async function boardId(page: Page) {
  const { boards } = (await page.evaluate(async () =>
    (await fetch('/api/v1/projects')).json(),
  )) as {
    boards: { id: string; name: string }[];
  };
  return boards[0]!.id;
}

test('notes: a Markdown page beside its preview', async ({ browser }) => {
  // A full HD screen: the source is wide enough for its tables to line up unwrapped.
  const { page, pageId, close } = await signedIn(browser, {
    viewport: { width: 1920, height: 1080 },
  });
  await page.goto(`/p/${pageId('Website relaunch plan')}`);
  const preview = page.locator('[data-preview] .markdown-body');
  await expect(preview.locator('.mermaid-diagram .diagram-drawing > svg')).toBeVisible({
    timeout: 20_000,
  });
  await expect(preview.locator('.katex').first()).toBeVisible();
  await settled(page);
  await page.screenshot({ path: `${OUT}/notes.png` });
  await close();
});

test('rich: a rich text page', async ({ browser }) => {
  const { page, pageId, close } = await signedIn(browser);
  await page.goto(`/p/${pageId('Weekly menu')}`);
  await expect(page.getByRole('table')).toBeVisible();
  await settled(page);
  await page.screenshot({ path: `${OUT}/rich.png` });
  await close();
});

test('diagrams: the diagram editor with a mind map', async ({ browser }) => {
  const { page, pageId, close } = await signedIn(browser);
  await page.goto(`/p/${pageId('Relaunch ideas')}`);
  const drawn = page.locator('.cm-diagram');
  await expect(drawn.locator('.diagram-drawing > svg')).toBeVisible({ timeout: 20_000 });
  await drawn.hover();
  await drawn.getByRole('button', { name: 'Edit diagram' }).click();
  const editor = page.locator('.diagram-editor');
  await expect(editor.locator('.diagram-canvas svg')).toBeVisible();
  await editor.locator('.diagram-canvas g.mindmap-node').filter({ hasText: 'Design' }).click();
  await settled(page);
  await page.screenshot({ path: `${OUT}/diagrams.png` });
  await close();
});

test('search: results as you type', async ({ browser }) => {
  const { page, close } = await signedIn(browser);
  await page.goto('/search?q=relaunch');
  const results = page.getByRole('list', { name: 'Results' });
  await expect(results.getByRole('button', { name: /Website relaunch plan/ })).toBeVisible();
  await settled(page);
  await page.screenshot({ path: `${OUT}/search.png` });
  await close();
});

test('board: a Kanban board with swimlanes', async ({ browser }) => {
  const { page, close } = await signedIn(browser);
  await page.goto(`/b/${await boardId(page)}`);
  await expect(page.getByText('Dark theme colours')).toBeVisible();
  await settled(page);
  await page.screenshot({ path: `${OUT}/board.png` });
  await close();
});

test('export: the export dialog', async ({ browser }) => {
  const { page, pageId, close } = await signedIn(browser);
  await page.goto(`/p/${pageId('Sourdough bread')}`);
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Export…' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  await settled(page);
  await page.screenshot({ path: `${OUT}/export.png` });
  await close();
});

test('dark: the board in the dark theme', async ({ browser }) => {
  const { page, close } = await signedIn(browser, { colorScheme: 'dark' });
  await page.goto(`/b/${await boardId(page)}`);
  await expect(page.getByText('Dark theme colours')).toBeVisible();
  await settled(page);
  await page.screenshot({ path: `${OUT}/board-dark.png` });
  await close();
});

test('phone: a page on a phone', async ({ browser }) => {
  const { page, pageId, close } = await signedIn(browser, { ...devices['Pixel 7'] });
  await page.goto(`/p/${pageId('Sourdough bread')}`);
  await expect(
    page.getByRole('heading', { name: 'Sourdough bread', level: 1 }).first(),
  ).toBeVisible();
  await settled(page);
  await page.screenshot({ path: `${OUT}/phone.png` });
  await close();
});
