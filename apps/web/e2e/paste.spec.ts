import { expect, test, type Page } from '@playwright/test';
import { FakeApi, fontsReady } from './helpers';

/*
 * Pasting a screenshot (Phase 6 acceptance, §9.5): in every browser engine, into both kinds
 * of page, the image is kept as the page's file and shown.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const editor = (page: Page) => page.getByRole('textbox', { name: 'Page content', exact: true });

/**
 * Pastes a PNG as a browser's clipboard holds a screenshot: as a file. (The system clipboard
 * itself, on Windows and Ubuntu, is checked by hand; see the implementation plan.)
 */
async function pasteScreenshot(page: Page) {
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
    // Firefox and Safari don't take clipboard data in the event's constructor.
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    el.dispatchEvent(event);
  });
}

for (const [kind, id] of [
  ['Markdown', 'q4'],
  ['rich text', 'pricing'],
] as const) {
  test(`a screenshot pastes into a ${kind} page`, async ({ page }) => {
    const api = new FakeApi();
    api.notes.content.set(id, '');
    await api.install(page);
    await page.goto(`/p/${id}`);
    await expect(editor(page)).toBeVisible();
    await fontsReady(page);
    await editor(page).click();
    await pasteScreenshot(page);
    await expect.poll(() => api.files.size, { timeout: 10_000 }).toBe(1);
    const shown =
      kind === 'Markdown'
        ? page.locator('[data-preview] img')
        : editor(page).getByRole('img', { name: 'Pasted image' });
    await expect(shown).toBeVisible();
    expect(await shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40);
  });
}
