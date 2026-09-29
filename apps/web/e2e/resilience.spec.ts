import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import { FakeApi } from './helpers';

/*
 * The resilience suite (§13.1), run in Chromium, Firefox and WebKit: typing offline, the
 * server going away mid-save, a tab closed mid-save, two devices editing at once, a slow
 * network, and a device that can't store anything. It passes only with zero data loss, and
 * only if no save indicator ever said "Saved" for text the server didn't have.
 */

const VIEWPORT = { width: 1440, height: 900 };
test.use({ viewport: VIEWPORT });

const PAGE = 'q4';
const FIRST_LINE = 'Ship the offline outbox first, then polish search.';
const LAST_LINE = 'Boards follow once sync is solid.';
const ORIGINAL = `${FIRST_LINE}\n\n${LAST_LINE}`;

interface SaveState {
  at: number;
  path: string;
  place: 'page' | 'app';
  state: string;
  /** The editor's text at that moment (null: no editor). */
  text: string | null;
}

/** Notes every save state the page shows, with the editor's text at that moment. */
async function watchSaveStates(page: Page) {
  await page.addInitScript(() => {
    const log: SaveState[] = [];
    Object.assign(window, { __saveStates: log });
    const editorText = () => {
      const editor = document.querySelector('section[aria-label="Editor"] .cm-content');
      if (!editor) return null;
      if (editor.querySelector('.cm-placeholder')) return '';
      return Array.from(editor.querySelectorAll('.cm-line'), (l) => l.textContent ?? '').join('\n');
    };
    const note = (el: Element) => {
      const state = el.getAttribute('data-save-state');
      if (!state) return;
      const place = el.closest('section[aria-label="Editor"]') ? 'page' : 'app';
      log.push({ at: Date.now(), path: location.pathname, place, state, text: editorText() });
    };
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') note(m.target as Element);
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.hasAttribute('data-save-state')) note(node);
          node.querySelectorAll('[data-save-state]').forEach(note);
        }
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-save-state'],
    });
  });
}

/** Every "Saved" shown was for text the server had at that moment. */
async function expectNoEarlySaved(page: Page, api: FakeApi, id = PAGE) {
  const log = await page.evaluate(
    () => (window as unknown as { __saveStates: SaveState[] }).__saveStates,
  );
  const shown = log.filter((e) => e.path === `/p/${id}`);
  const early = shown.filter(
    (e) => e.state === 'saved' && e.text !== null && e.text !== api.notes.contentAt(id, e.at),
  );
  expect(early, '"Saved" was shown for text the server didn’t have').toEqual([]);
  expect(shown.some((e) => e.state === 'saved')).toBe(true);
}

const editor = (page: Page) => page.getByRole('textbox', { name: 'Page content', exact: true });
const pageState = (page: Page) =>
  page.getByRole('region', { name: 'Editor' }).locator('[data-save-state]');
const appState = (page: Page) => page.getByRole('banner').locator('[data-save-state]');

/** The editor's text, line by line. */
const editorText = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll('section[aria-label="Editor"] .cm-line'),
      (l) => l.textContent ?? '',
    ).join('\n'),
  );

async function open(page: Page, api: FakeApi, label?: string) {
  await watchSaveStates(page);
  await api.install(page, label);
  await page.goto(`/p/${PAGE}`);
  await expect(editor(page)).toContainText(LAST_LINE);
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved');
}

/** Another device: a browser context with storage of its own. */
async function otherDevice(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({
    baseURL,
    viewport: VIEWPORT,
    serviceWorkers: 'block',
  });
  return context.newPage();
}

async function typeAtEnd(page: Page, text: string) {
  await editor(page).locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

/** Replaces the first line with `text`. */
async function rewriteFirstLine(page: Page, text: string) {
  await editor(page).locator('.cm-line').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.type(text);
}

const saved = { timeout: 20_000 };

test('typing offline keeps every keystroke on the device, and sends it when back', async ({
  page,
  context,
}) => {
  const api = new FakeApi();
  await open(page, api);
  api.goDown();
  await context.setOffline(true);
  await typeAtEnd(page, ' Written on the train.');
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'local');
  await expect(appState(page)).toHaveAttribute('data-save-state', 'local');
  await expect(page.getByRole('status').filter({ hasText: 'You’re offline' })).toContainText(
    'saved on this device',
  );
  expect(api.notes.content.get(PAGE)).toBe(ORIGINAL);

  api.comeBack();
  await context.setOffline(false);
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', saved);
  await expect(appState(page)).toHaveAttribute('data-save-state', 'saved');
  expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} Written on the train.`);
  await expectNoEarlySaved(page, api);
});

test('a page made offline is created, named and filled when back', async ({ page, context }) => {
  const api = new FakeApi();
  await open(page, api);
  api.goDown();
  await context.setOffline(true);
  await page.keyboard.press('Alt+n');
  await page.getByRole('textbox', { name: 'Page title' }).fill('Train notes');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Train notes');
  await editor(page).click();
  await page.keyboard.type('Written with no connection.');
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'local');

  api.comeBack();
  await context.setOffline(false);
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', saved);
  const made = api.notes.tree.pages.find((p) => p.title === 'Train notes');
  expect(made).toMatchObject({ sectionId: 'roadmap' });
  expect(api.notes.content.get(made!.id)).toBe('Written with no connection.');
  await expectNoEarlySaved(page, api, made!.id);
});

test.describe('the server going away mid-save', () => {
  test('a save the server never took is sent again', async ({ page }) => {
    const api = new FakeApi();
    await open(page, api);
    const release = api.holdSaves();
    await typeAtEnd(page, ' First part.');
    await expect.poll(() => api.saves().length).toBe(1);
    await expect(pageState(page)).toHaveAttribute('data-save-state', 'saving');
    // It goes down with the save in flight, and stays down for a while.
    api.goDown();
    release();
    await expect(pageState(page)).toHaveAttribute('data-save-state', 'local');
    await typeAtEnd(page, ' Second part.');
    expect(api.notes.content.get(PAGE)).toBe(ORIGINAL);

    api.comeBack();
    await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', saved);
    expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} First part. Second part.`);
    await expectNoEarlySaved(page, api);
  });

  test('a save whose answer was lost is taken once', async ({ page }) => {
    const api = new FakeApi();
    await open(page, api);
    api.loseAnswers = true;
    await typeAtEnd(page, ' Only once.');
    await expect.poll(() => api.notes.content.get(PAGE)).toBe(`${ORIGINAL} Only once.`);
    await expect(pageState(page)).toHaveAttribute('data-save-state', 'local');

    api.loseAnswers = false;
    await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', saved);
    expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} Only once.`);
    expect(api.notes.versions).toEqual([]);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expectNoEarlySaved(page, api);
  });

  test('errors from a proxy while the server restarts', async ({ page }) => {
    const api = new FakeApi();
    await open(page, api);
    api.errorStatus = 502;
    await typeAtEnd(page, ' Typed during the restart.');
    await expect(pageState(page)).toHaveAttribute('data-save-state', 'local');
    expect(api.notes.content.get(PAGE)).toBe(ORIGINAL);

    api.errorStatus = null;
    await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', saved);
    expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} Typed during the restart.`);
    await expectNoEarlySaved(page, api);
  });
});

test.describe('closing the tab mid-save', () => {
  test('what was stored on the device is sent from the next tab', async ({ context }) => {
    const api = new FakeApi();
    const first = await context.newPage();
    await open(first, api);
    const release = api.holdSaves();
    await typeAtEnd(first, ' Typed, then the tab closed.');
    await expect.poll(() => api.saves().length).toBe(1);
    // The tab goes with its save in flight, which never arrives.
    await first.close();
    api.goDown();
    release();
    api.comeBack();
    expect(api.notes.content.get(PAGE)).toBe(ORIGINAL);

    const next = await context.newPage();
    await watchSaveStates(next);
    await api.install(next);
    await next.goto(`/p/${PAGE}`);
    await expect(editor(next)).toContainText('Typed, then the tab closed.');
    await expect(pageState(next)).toHaveAttribute('data-save-state', 'saved', saved);
    expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} Typed, then the tab closed.`);
    await expectNoEarlySaved(next, api);
  });

  test('leaving right after typing keeps the text for the next tab', async ({ context }) => {
    const api = new FakeApi();
    const first = await context.newPage();
    await open(first, api);
    // Nothing reaches the server: only this device can keep the text.
    api.goDown();
    first.on('dialog', (dialog) => void dialog.accept());
    await typeAtEnd(first, ' Typed as the tab closed.');
    await first.close({ runBeforeUnload: true });
    await expect.poll(() => first.isClosed()).toBe(true);

    api.comeBack();
    const next = await context.newPage();
    await watchSaveStates(next);
    await api.install(next);
    await next.goto(`/p/${PAGE}`);
    await expect(editor(next)).toContainText('Typed as the tab closed.');
    await expect(pageState(next)).toHaveAttribute('data-save-state', 'saved', saved);
    expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} Typed as the tab closed.`);
    await expectNoEarlySaved(next, api);
  });

  test('closing right after typing asks first, and staying saves it', async ({ page }) => {
    const api = new FakeApi();
    await open(page, api);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await typeAtEnd(page, ' Not stored yet.');
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs).toEqual(['beforeunload']);
    expect(page.isClosed()).toBe(false);

    await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', saved);
    expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} Not stored yet.`);
    // Saved: closing no longer asks.
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs).toEqual(['beforeunload']);
  });
});

test.describe('two devices editing at once', () => {
  test('edits to different lines are merged, on both', async ({
    page: laptop,
    browser,
    baseURL,
  }) => {
    const api = new FakeApi();
    const phone = await otherDevice(browser, baseURL);
    await open(laptop, api, 'Chrome on Linux');
    await open(phone, api, 'Safari on iPhone');
    await expect(laptop.getByText('Also open on: Safari on iPhone')).toBeVisible();
    await expect(phone.getByText('Also open on: Chrome on Linux')).toBeVisible();

    await Promise.all([
      rewriteFirstLine(laptop, 'Written on the laptop.'),
      typeAtEnd(phone, ' Added on the phone.'),
    ]);
    const merged = `Written on the laptop.\n\n${LAST_LINE} Added on the phone.`;
    await expect.poll(() => api.notes.content.get(PAGE), saved).toBe(merged);
    await expect.poll(() => editorText(laptop), saved).toBe(merged);
    await expect.poll(() => editorText(phone), saved).toBe(merged);
    await expect(pageState(laptop)).toHaveAttribute('data-save-state', 'saved');
    await expect(pageState(phone)).toHaveAttribute('data-save-state', 'saved');
    expect(api.notes.versions).toEqual([]);
    await phone.context().close();
  });

  test('overlapping edits keep both texts, and the choice is the user’s', async ({
    page: laptop,
    browser,
    baseURL,
  }) => {
    const api = new FakeApi();
    const phone = await otherDevice(browser, baseURL);
    await open(laptop, api, 'Chrome on Linux');
    await open(phone, api, 'Safari on iPhone');

    // The phone has no connection while both change the first line.
    const noConnection = (route: Route) => route.abort('internetdisconnected');
    await phone.route('**/api/**', noConnection);
    await rewriteFirstLine(laptop, 'The laptop’s first line.');
    await expect.poll(() => api.notes.content.get(PAGE), saved).toContain('laptop');
    await rewriteFirstLine(phone, 'The phone’s first line.');
    await expect(pageState(phone)).toHaveAttribute('data-save-state', 'local');

    await phone.unroute('**/api/**', noConnection);
    await expect(phone.getByRole('alert')).toContainText(
      'Changed on another device as well',
      saved,
    );
    await expect(pageState(phone)).toHaveAttribute('data-save-state', 'conflict');
    const laptopText = `The laptop’s first line.\n\n${LAST_LINE}`;
    const phoneText = `The phone’s first line.\n\n${LAST_LINE}`;
    // Neither text is lost: the phone's is kept as a version of the page.
    expect(api.notes.content.get(PAGE)).toBe(laptopText);
    expect(api.notes.versions.map((v) => v.content)).toEqual([phoneText]);

    await phone.getByRole('button', { name: 'Keep mine' }).click();
    await expect(pageState(phone)).toHaveAttribute('data-save-state', 'saved', saved);
    expect(api.notes.content.get(PAGE)).toBe(phoneText);
    expect(api.notes.versions.map((v) => v.content)).toEqual([phoneText, laptopText]);
    await expect.poll(() => editorText(laptop), saved).toBe(phoneText);
    await phone.context().close();
  });
});

test('on a slow network, “Saved” waits for the server', async ({ page }) => {
  const api = new FakeApi();
  await open(page, api);
  api.latency = 1_500;
  // Typing goes on across several saves, each slower than the pauses between them.
  for (const word of [' One', ' two', ' three', ' four']) {
    await typeAtEnd(page, word);
    await page.waitForTimeout(1_200);
  }
  await expect(pageState(page)).not.toHaveAttribute('data-save-state', 'saved');
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', saved);
  expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} One two three four`);
  await expectNoEarlySaved(page, api);
});

test('when the device can’t store anything, changes go straight to the server', async ({
  page,
}) => {
  // The browser refuses to store pages from the moment the test says so ("disk full").
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
      if ((window as unknown as { __full?: boolean }).__full && this.name === 'pages') {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
  const api = new FakeApi();
  await open(page, api);
  await page.evaluate(() => Object.assign(window, { __full: true }));
  await typeAtEnd(page, ' Kept only in this tab.');
  await expect(page.getByRole('alert')).toContainText('Changes can’t be stored on this device');
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', saved);
  expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} Kept only in this tab.`);

  // And again, with the server away for a moment: the tab keeps trying.
  api.goDown();
  await typeAtEnd(page, ' And more.');
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'failed');
  api.comeBack();
  await expect(pageState(page)).toHaveAttribute('data-save-state', 'saved', saved);
  expect(api.notes.content.get(PAGE)).toBe(`${ORIGINAL} Kept only in this tab. And more.`);
  await expectNoEarlySaved(page, api);
});
