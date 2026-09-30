import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { FakeApi, NOW, expectNoA11yViolations, fontsReady } from './helpers';

/*
 * Import and export (Phase 9, §9.10): exports as server jobs and in the browser, the print
 * preview, imports from settings and by dropping files.
 */

test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, path: string, api = new FakeApi()) {
  await api.install(page);
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
  await fontsReady(page);
  return api;
}

async function exportPage(page: Page) {
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Export…' }).click();
  return page.getByRole('dialog', { name: 'Export' });
}

test.describe('export', () => {
  test('a page as Markdown: a job on the server, downloaded when ready', async ({ page }) => {
    const api = await open(page, '/p/q4');
    const dialog = await exportPage(page);
    await expect(dialog).toContainText('Export “Q4 roadmap” as:');
    await expectNoA11yViolations(page);
    await dialog.getByRole('radio', { name: 'Markdown' }).check();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export' }).click();
    await expect(dialog).toBeHidden();
    const status = page.getByRole('region', { name: 'Imports and exports' });
    await expect(status.getByRole('progressbar')).toBeVisible();
    expect((await download).suggestedFilename()).toBe('Q4 roadmap 2026-09-29.md');
    await expect(status).toContainText('Export ready');
    await expect(status).toContainText('Q4 roadmap 2026-09-29.md');
    const request = api.requests.find((r) => r.path === '/api/v1/exports');
    expect(request?.body).toMatchObject({ format: 'markdown', scope: 'page', id: 'q4' });
    await status.getByRole('button', { name: 'Close' }).click();
    await expect(status).toBeHidden();
  });

  test('a section as a Word document, made in the browser', async ({ page }) => {
    await open(page, '/p/q4');
    await page.getByRole('tab', { name: 'Roadmap' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog).toContainText('Export “Roadmap” as:');
    await dialog.getByRole('radio', { name: 'Word document (.docx)' }).check();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Roadmap.docx');
    const data = await readFile((await file.path())!);
    // A .docx is a zip.
    expect(data.subarray(0, 2).toString('latin1')).toBe('PK');
    await expect(dialog).toBeHidden();
  });

  test('a notebook as an encrypted archive, with its history', async ({ page }) => {
    const api = await open(page, '/p/q4');
    await page
      .getByRole('navigation', { name: 'Navigation' })
      .getByRole('treeitem', { name: 'Work', exact: true })
      .getByText('Work', { exact: true })
      .first()
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog.getByRole('radio')).toHaveCount(2);
    await dialog.getByRole('checkbox', { name: 'Include version history' }).click();
    await dialog.getByRole('checkbox', { name: 'Encrypt with a password' }).click();
    await dialog.getByLabel('Password', { exact: true }).fill('open sesame');
    await dialog.getByLabel('Password again').fill('open sesame!');
    await dialog.getByRole('button', { name: 'Export' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('The passwords don’t match.');
    await dialog.getByLabel('Password again').fill('open sesame');
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export' }).click();
    expect((await download).suggestedFilename()).toBe('Work 2026-09-29.memora');
    const request = api.requests.find((r) => r.path === '/api/v1/exports');
    expect(request?.body).toEqual({
      format: 'memora',
      scope: 'notebook',
      id: 'work',
      history: true,
      password: 'open sesame',
    });
  });

  test('prints a page laid out in sheets, or downloads a PDF when a service is set up', async ({
    page,
  }) => {
    const api = new FakeApi();
    api.pdf = true;
    await open(page, '/p/q4', api);
    const dialog = await exportPage(page);
    await dialog.getByRole('radio', { name: 'PDF' }).check();
    await dialog.getByRole('button', { name: 'Preview…' }).click();
    const preview = page.getByRole('dialog', { name: 'Print or save as PDF' });
    await expect(preview).toContainText('1 page.', { timeout: 15_000 });
    await expect(preview.getByRole('button', { name: 'Print…' })).toBeEnabled();
    const sheet = preview.frameLocator('iframe[title="Print preview"]').locator('.pagedjs_page');
    await expect(sheet).toHaveCount(1);
    await expect(sheet).toContainText('Ship the offline outbox first');
    const download = page.waitForEvent('download');
    await preview.getByRole('button', { name: 'Download PDF' }).click();
    expect((await download).suggestedFilename()).toBe('Q4 roadmap.pdf');
    const sent = api.requests.find((r) => r.path === '/api/v1/exports/pdf');
    const html = String((sent?.body as { html?: string } | undefined)?.html);
    expect(html).toContain('<h1 class="document-title">Q4 roadmap</h1>');
    expect(html).not.toContain('<script');
  });
});

test.describe('import', () => {
  test('an archive from settings: asks for the password, then opens what came in', async ({
    page,
  }) => {
    const api = await open(page, '/settings/data');
    await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    const choose = async () =>
      page.getByLabel('Files to import').setInputFiles({
        name: 'encrypted notes.memora',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('not really encrypted'),
      });
    await choose();
    await expect(page.getByText('encrypted notes.memora')).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const status = page.getByRole('region', { name: 'Imports and exports' });
    await expect(status).toContainText('This file is encrypted: enter its password.');
    await status.getByRole('button', { name: 'Close' }).click();

    await choose();
    await page.getByLabel('Password', { exact: true }).fill('open sesame');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(status).toContainText('Import finished');
    await expect(status).toContainText('1 notebook, 1 section, 1 page');
    await status.getByRole('button', { name: '1 skipped' }).click();
    await expect(status).toContainText('Broken page: Its content is damaged.');
    const sent = api.requests.filter((r) => r.path === '/api/v1/imports');
    expect(sent.map((r) => r.headers['x-memora-archive-password'])).toEqual([
      undefined,
      'open sesame',
    ]);
    await status.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/p\/page-new-\d+$/);
    await expect(page.getByRole('heading', { name: 'Imported page' })).toBeVisible();
  });

  test('files dropped on the page list become pages there', async ({ page }) => {
    const api = await open(page, '/p/q4');
    const list = page.getByRole('complementary', { name: 'Pages' });
    const files = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(
          ['---\ntitle: Moving day\ntags: [launch]\n---\n\n- [ ] Tell everyone\n'],
          'launch.md',
          {
            type: 'text/markdown',
          },
        ),
      );
      dt.items.add(
        new File(['<h1>Clipped</h1><p>From the <b>web</b></p>'], 'clipped.html', {
          type: 'text/html',
        }),
      );
      return dt;
    });
    await list.dispatchEvent('dragover', { dataTransfer: files });
    await expect(list.getByRole('status')).toHaveText('Drop to import into Roadmap');
    await list.dispatchEvent('drop', { dataTransfer: files });
    await expect(page.getByText('Imported 2 pages', { exact: true })).toBeVisible();
    await expect(list.getByRole('treeitem', { name: /^Moving day/ })).toBeVisible();
    await expect(list.getByRole('treeitem', { name: /^clipped/ })).toBeVisible();
    const launch = api.notes.tree.pages.find((p) => p.title === 'Moving day')!;
    expect(launch.sectionId).toBe('roadmap');
    expect(api.notes.content.get(launch.id)).toBe('- [ ] Tell everyone\n');
    expect(api.notes.tree.tags?.map((t) => t.name)).toEqual(['launch']);
    const clipped = api.notes.tree.pages.find((p) => p.title === 'clipped')!;
    expect(clipped.type).toBe('rich');
    expect(JSON.parse(api.notes.content.get(clipped.id)!).content[0].type).toBe('heading');
  });
});
