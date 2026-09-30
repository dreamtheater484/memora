import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { FakeApi, NOW, PNG, expectNoA11yViolations, fontsReady } from './helpers';

/*
 * Kanban (Phase 10, §9.11): projects and boards, columns and lanes, quick add, filters, the
 * card panel, linked notes, card keys in notes, moving by keyboard and by dragging (mouse and
 * finger) with forgiving drop targets, a phone, and a big board staying smooth.
 */

test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, path = '/b/relaunch', api = new FakeApi()) {
  await api.install(page);
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
  await fontsReady(page);
  if (path.startsWith('/b/')) {
    await expect(page.locator('[data-kb-board]')).toBeVisible();
  }
  return api;
}

/** A column's cards (in the board without lanes), as the board shows them. */
const column = (page: Page, name: string) => page.getByRole('list', { name, exact: true });

async function titles(page: Page, name: string): Promise<string[]> {
  return column(page, name)
    .locator('[data-kb-card]')
    .evaluateAll((cards) =>
      cards.map((c) =>
        c
          .getAttribute('aria-label')!
          .replace(/^[A-Z0-9]+-(\d+|…): /, '')
          .replace(/, completed$/, ''),
      ),
    );
}

/** A column's name on the board. */
const heading = (page: Page, name: string) =>
  page
    .locator('[data-kb-board]')
    // A Done column's name ends with its mark's label, "Done column".
    .getByRole('heading', { level: 2, name: new RegExp(`^${name}(Done column)?$`) });

const card = (page: Page, title: string) =>
  page
    .locator('[data-kb-board]')
    .getByRole('button', { name: new RegExp(`^[A-Z0-9]+-\\d+: ${title}`) });

/** Picks a radio item from an open menu's submenu. */
async function pick(page: Page, submenu: string, item: string) {
  await page.getByRole('menuitem', { name: submenu }).click();
  const radio = page.getByRole('menuitemradio', { name: item });
  await radio.focus();
  await radio.press('Enter');
}

const columnId = (api: FakeApi, board: string, name: string) =>
  api.kanban.columns.find((c) => c.boardId === board && c.name === name)!.id;

const serverCard = (api: FakeApi, title: string) =>
  api.kanban.cards.find((c) => c.title === title)!;

/** The titles of a column's cards on the fake server, in order. */
const serverColumn = (api: FakeApi, board: string, name: string) => {
  const id = columnId(api, board, name);
  return api.kanban
    .board(board)
    .cards.filter((c) => c.columnId === id)
    .map((c) => c.title);
};

test.describe('projects and boards', () => {
  test('a new project starts with a board; more boards, renaming and archiving', async ({
    page,
  }) => {
    const api = await open(page, '/p/q4');
    await page.getByRole('button', { name: 'New project' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('Name').fill('Mobile app');
    await expect(dialog.getByLabel('Key')).not.toHaveValue('');
    await dialog.getByLabel('Key').fill('APP');
    await expectNoA11yViolations(page);
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/b\//);
    await expect(page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
    for (const name of ['To do', 'Doing', 'Done']) {
      await expect(heading(page, name)).toBeVisible();
    }
    const nav = page.getByRole('tree', { name: 'Boards' });
    await expect(nav.getByRole('treeitem', { name: 'Mobile app' })).toBeVisible();

    // A second board, with the longer set of columns.
    await page.getByRole('button', { name: 'New board' }).click();
    const create = page.getByRole('dialog', { name: 'New board' });
    await create.getByLabel('Name').fill('Releases');
    await create.getByRole('combobox', { name: 'Columns' }).click();
    await page.getByRole('option', { name: /Backlog/ }).click();
    await create.getByRole('button', { name: 'Create board' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Releases' })).toBeVisible();
    await expect(heading(page, 'Review')).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Boards in this project' });
    await expect(tabs.getByRole('button')).toHaveText(['Board', 'Releases', '']);
    await expect(tabs.getByRole('button', { name: 'Releases' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Renaming by double-click, then archiving: it leaves the navigation until asked for.
    await page.getByRole('heading', { level: 1, name: 'Releases' }).dblclick();
    await page.getByRole('textbox', { name: 'Board name' }).fill('Release train');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Release train' })).toBeVisible();
    await page.getByRole('button', { name: 'Board options' }).click();
    await page.getByRole('menuitem', { name: 'Archive board' }).click();
    await expect(page.getByText('Archived', { exact: true })).toBeVisible();
    await expect(nav.getByRole('treeitem', { name: 'Release train' })).toBeHidden();
    await page.getByRole('button', { name: /Show archived/ }).click();
    await expect(nav.getByRole('treeitem', { name: 'Release train' })).toBeVisible();
    const made = api.kanban.projects.find((p) => p.key === 'APP')!;
    expect(api.kanban.boards.filter((b) => b.projectId === made.id).map((b) => b.name)).toEqual([
      'Board',
      'Release train',
    ]);
  });

  test('the board passes an accessibility check', async ({ page }) => {
    await open(page);
    await expect(card(page, 'Hero section copy')).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe('cards on the board', () => {
  test('quick add keeps going; Esc closes; the keys count up', async ({ page }) => {
    const api = await open(page);
    await page.getByRole('button', { name: 'Add card to To do' }).click();
    const input = page.getByRole('textbox', { name: 'New card in To do' });
    await input.fill('Write the FAQ');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await input.fill('Update the sitemap');
    await input.press('Enter');
    await input.press('Escape');
    await expect(input).toBeHidden();
    await expect(card(page, 'Write the FAQ')).toHaveAccessibleName('WEB-8: Write the FAQ');
    await expect(card(page, 'Update the sitemap')).toHaveAccessibleName(
      'WEB-9: Update the sitemap',
    );
    expect(await titles(page, 'To do')).toEqual([
      'Hero section copy',
      'Pricing page layout',
      'Broken link in the footer',
      'Write the FAQ',
      'Update the sitemap',
    ]);
    await expect.poll(() => serverColumn(api, 'relaunch', 'To do').length).toBe(5);

    // N adds at the column of the focused card; the + in a header adds at the top.
    await page.getByRole('button', { name: 'Add a card at the top of Doing' }).click();
    await page.getByRole('textbox', { name: 'New card in Doing' }).fill('Hotfix the menu');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect
      .poll(() => titles(page, 'Doing'))
      .toEqual(['Hotfix the menu', 'New navigation', 'Launch announcement']);
    await expect(card(page, 'Hotfix the menu')).toHaveAccessibleName('WEB-10: Hotfix the menu');
  });

  test('the keyboard moves focus and cards, and Ctrl+Z undoes a move', async ({ page }) => {
    const api = await open(page);
    await card(page, 'Hero section copy').focus();
    await page.keyboard.press('ArrowDown');
    await expect(card(page, 'Pricing page layout')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(card(page, 'Launch announcement')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(card(page, 'Pricing page layout')).toBeFocused();

    await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
    await expect(page.getByRole('status').getByText('Moved to Doing')).toBeVisible();
    await expect(card(page, 'Pricing page layout')).toBeFocused();
    expect(await titles(page, 'Doing')).toEqual([
      'New navigation',
      'Pricing page layout',
      'Launch announcement',
    ]);
    await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
    await expect
      .poll(() => titles(page, 'Doing'))
      .toEqual(['Pricing page layout', 'New navigation', 'Launch announcement']);
    await expect
      .poll(() => serverColumn(api, 'relaunch', 'Doing'))
      .toEqual(['Pricing page layout', 'New navigation', 'Launch announcement']);

    // Undo goes back one move at a time.
    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(() => titles(page, 'Doing'))
      .toEqual(['New navigation', 'Pricing page layout', 'Launch announcement']);
    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(() => serverColumn(api, 'relaunch', 'To do'))
      .toEqual(['Hero section copy', 'Pricing page layout', 'Broken link in the footer']);

    // Into the Done column: the card is completed.
    await card(page, 'Launch announcement').focus();
    await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
    await expect(card(page, 'Launch announcement')).toHaveAccessibleName(
      'WEB-5: Launch announcement, completed',
    );
    await expect.poll(() => serverCard(api, 'Launch announcement').completedAt).not.toBeNull();

    // Enter opens the card; e goes to its title.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'WEB-5: Launch announcement' })).toBeVisible();
    await page.keyboard.press('Escape');
    await card(page, 'Hero section copy').focus();
    await page.keyboard.press('e');
    await expect(page.getByRole('textbox', { name: 'Card title' })).toBeFocused();
  });

  test('filters narrow the board, with chips to take them off', async ({ page }) => {
    await open(page);
    await page.getByRole('textbox', { name: 'Filter cards' }).fill('pricing');
    await expect(page.locator('[data-kb-card]')).toHaveCount(1);
    await expect(page.getByText('5 cards are hidden by the filters.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Filter cards' }).fill('');

    await page.getByRole('button', { name: 'Labels', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Design' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Due', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Overdue' }).click();
    const chips = page.getByRole('list', { name: 'Filters' });
    await expect(chips.getByRole('listitem')).toHaveText(['Label: Design', 'Due: Overdue']);
    await expect(page.locator('[data-kb-card]')).toHaveCount(0);
    await chips.getByRole('button', { name: 'Remove filter Due: Overdue' }).click();
    await expect(page.locator('[data-kb-card]')).toHaveCount(2);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Has linked notes' }).click();
    await expect(page.locator('[data-kb-card]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.locator('[data-kb-card]')).toHaveCount(6);
    await expect(chips).toBeHidden();
  });
});

test.describe('columns and lanes', () => {
  test('WIP limits, Done columns, sorting, collapsing and the archive', async ({ page }) => {
    const api = await open(page);
    await page.getByRole('button', { name: 'Doing options' }).click();
    await page.getByRole('menuitem', { name: 'Limit cards (WIP)…' }).click();
    const wip = page.getByRole('dialog', { name: 'Limit “Doing”' });
    await wip.getByRole('spinbutton', { name: 'Most cards' }).fill('2');
    await wip.getByRole('switch', { name: 'Strict limit' }).click();
    await wip.getByRole('button', { name: 'Save' }).click();
    const head = page.locator(`[data-kb-column-head="${columnId(api, 'relaunch', 'Doing')}"]`);
    await expect(head).toContainText('2/2');

    // A strict, full column takes no more cards: the card goes back, and says why.
    await card(page, 'Hero section copy').focus();
    await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
    await expect(
      page.getByText('“Doing” is full: its limit is 2 cards.', { exact: true }),
    ).toBeVisible();
    await expect.poll(() => titles(page, 'To do')).toContain('Hero section copy');
    expect(serverColumn(api, 'relaunch', 'Doing')).toHaveLength(2);

    // Sorting by priority: urgent and high first.
    await page.getByRole('button', { name: 'To do options' }).click();
    await pick(page, 'Sort cards', 'By priority');
    await expect
      .poll(() => titles(page, 'To do'))
      .toEqual(['Hero section copy', 'Pricing page layout', 'Broken link in the footer']);

    // A Done column completes what is in it.
    await page.getByRole('button', { name: 'Doing options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Done column' }).click();
    await expect(card(page, 'New navigation')).toHaveAccessibleName(/, completed$/);

    // Collapsing leaves a slim strip; archiving takes the column away until asked for.
    await page.getByRole('button', { name: 'Done options' }).click();
    await page.getByRole('menuitem', { name: 'Collapse' }).click();
    await expect(page.getByRole('button', { name: 'Expand Done' })).toBeVisible();
    await expect(column(page, 'Done')).toBeHidden();
    await page.getByRole('button', { name: 'Expand Done' }).click();
    await expect(column(page, 'Done')).toBeVisible();
    await page.getByRole('button', { name: 'Done options' }).click();
    await page.getByRole('menuitem', { name: 'Archive column' }).click();
    await expect(heading(page, 'Done')).toBeHidden();
    await page.getByRole('button', { name: 'Board options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show the archive' }).click();
    const archived = page.getByRole('region', { name: 'Archived columns' });
    await expect(archived).toContainText('Done');
    await expect(page.getByRole('region', { name: 'Archived cards' })).toContainText(
      'Old landing page',
    );
  });

  test('lanes of the board’s own, by priority and by label', async ({ page }) => {
    const api = await open(page);
    await page.getByRole('button', { name: 'Board options' }).click();
    await pick(page, 'Swimlanes', 'By priority');
    for (const name of ['Urgent', 'High', 'Medium', 'Low', 'No priority']) {
      await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
    }
    await expect(page.getByRole('list', { name: 'Doing, Urgent' })).toContainText('New navigation');
    // Dropped into another lane, a card takes its priority.
    const from = await centre(card(page, 'Pricing page layout'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
    const urgent = (await card(page, 'New navigation').boundingBox())!;
    await page.mouse.move(urgent.x + 40, urgent.y + urgent.height - 4, { steps: 10 });
    await expect(
      page.getByRole('list', { name: 'Doing, Urgent' }).locator('[data-kb-placeholder]'),
    ).toHaveCount(1);
    await page.mouse.up();
    await expect(page.getByRole('list', { name: 'Doing, Urgent' })).toContainText(
      'Pricing page layout',
    );
    await expect.poll(() => serverCard(api, 'Pricing page layout').priority).toBe('urgent');

    await page.getByRole('button', { name: 'Board options' }).click();
    await pick(page, 'Swimlanes', 'Own lanes');
    await expect(page.getByRole('heading', { level: 3, name: 'No lane' })).toBeVisible();
    await page.getByRole('button', { name: 'Board options' }).click();
    await page.getByRole('menuitem', { name: 'Add a lane…' }).click();
    const name = page.getByRole('dialog', { name: 'New lane' });
    await name.getByLabel('Lane name').fill('Mobile');
    await name.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Mobile' })).toBeVisible();
    await page.getByRole('button', { name: 'Add card to To do, Mobile' }).click();
    await page.getByRole('textbox', { name: 'New card in To do' }).fill('Touch targets');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('list', { name: 'To do, Mobile' })).toContainText('Touch targets');
    await expect
      .poll(() => serverCard(api, 'Touch targets')?.swimlaneId)
      .toBe(api.kanban.lanes[0]!.id);
  });
});

test.describe('the card panel', () => {
  test('labels, priority, dates, description, checklists, comments and files', async ({ page }) => {
    const api = await open(page);
    await card(page, 'Pricing page layout').click();
    const panel = page.getByRole('region', { name: 'WEB-2: Pricing page layout' });
    await expect(panel).toBeVisible();
    await expectNoA11yViolations(page);

    await panel.getByRole('button', { name: 'Labels: Design' }).click();
    await page.getByRole('list', { name: 'Labels' }).getByText('Copy').click();
    await page.keyboard.press('Escape');
    await expect(panel.getByRole('button', { name: 'Labels: Design, Copy' })).toBeVisible();
    await panel.getByRole('combobox', { name: 'Priority' }).click();
    await page.getByRole('option', { name: 'Urgent' }).click();
    await panel.getByLabel('Due date').fill('2026-09-29');
    const face = card(page, 'Pricing page layout');
    await expect(face).toContainText('Copy');
    await expect(face.getByTitle('Due today')).toContainText('Sep 29');
    await expect(face).toContainText('Urgent priority');

    await panel.getByRole('button', { name: 'Add a description…' }).click();
    await panel
      .getByRole('textbox', { name: 'Description' })
      .fill('Three tiers, **yearly** first.');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByRole('button', { name: 'Edit the description' })).toContainText(
      'Three tiers, yearly first.',
    );

    await panel.getByRole('button', { name: 'Checklist' }).click();
    await page.keyboard.press('Enter');
    const item = panel.getByRole('textbox', { name: 'Add an item to Checklist' });
    await item.fill('Wireframe');
    await item.press('Enter');
    await item.fill('Copy review');
    await item.press('Enter');
    await panel.getByRole('checkbox', { name: 'Wireframe' }).click();
    await expect(panel.getByRole('checkbox', { name: 'Wireframe' })).toBeChecked();
    await expect(face.getByTitle('Checklist')).toHaveText('1/2');

    const comment = panel.getByRole('textbox', { name: 'Write a comment' });
    await comment.fill('Looks good to me.');
    await comment.press('ControlOrMeta+Enter');
    await expect(panel.getByRole('region', { name: 'Comments' })).toContainText(
      'Looks good to me.',
    );
    await expect(face.getByTitle('Comments')).toHaveText('1');

    await panel.getByLabel('Files to attach').setInputFiles({
      name: 'mockup.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(panel.getByRole('img', { name: 'mockup.png' })).toBeVisible();
    await expect(face.getByTitle('Files')).toHaveText('1');

    await expect(panel.getByRole('region', { name: 'Activity' })).toContainText('commented');
    const saved = serverCard(api, 'Pricing page layout');
    expect(saved.priority).toBe('urgent');
    expect(saved.dueDate).toBe('2026-09-29');
    expect(saved.description).toBe('Three tiers, **yearly** first.');
  });

  test('duplicate, move to another board, archive and delete', async ({ page }) => {
    const api = await open(page);
    await card(page, 'Hero section copy').click();
    let panel = page.getByRole('region', { name: 'WEB-1: Hero section copy' });
    await panel.getByRole('button', { name: 'Card options' }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    panel = page.getByRole('region', { name: 'WEB-8: Hero section copy (copy)' });
    await expect(panel).toBeVisible();
    // The copy has the same checklist and linked note.
    await expect(panel.getByRole('region', { name: 'Linked notes' })).toContainText('Q4 roadmap');
    await expect(panel.getByRole('checkbox', { name: 'First draft' })).toBeChecked();

    await panel.getByRole('button', { name: 'Card options' }).click();
    await page.getByRole('menuitem', { name: 'Move to…' }).click();
    const move = page.getByRole('dialog', { name: 'Move card' });
    await move.getByRole('combobox', { name: 'Board' }).click();
    await page.getByRole('option', { name: 'Garden app › Sprint board' }).click();
    await move.getByRole('combobox', { name: 'Column' }).click();
    await page.getByRole('option', { name: 'Doing' }).click();
    await move.getByRole('button', { name: 'Move' }).click();
    await expect(page.getByRole('status').getByText('Moved to Sprint board')).toBeVisible();
    // Another project: a new number there, and the labels stay behind.
    await expect
      .poll(() => api.kanban.cards.find((c) => c.title === 'Hero section copy (copy)')?.boardId)
      .toBe('sprint');
    const moved = serverCard(api, 'Hero section copy (copy)');
    expect(moved.number).toBe(2);
    expect(moved.labelIds).toEqual([]);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sprint board' })).toBeVisible();
    await expect(card(page, 'Hero section copy \\(copy\\)')).toHaveAccessibleName(
      'GRD-2: Hero section copy (copy)',
    );

    // Archive, with undo; then delete for good.
    await card(page, 'Watering schedule').click();
    panel = page.getByRole('region', { name: 'GRD-1: Watering schedule' });
    await panel.getByRole('button', { name: 'Card options' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(card(page, 'Watering schedule')).toBeHidden();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(card(page, 'Watering schedule')).toBeVisible();
    await card(page, 'Watering schedule').click();
    await panel.getByRole('button', { name: 'Card options' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(card(page, 'Watering schedule')).toBeHidden();
    await expect
      .poll(() => api.kanban.cards.some((c) => c.title === 'Watering schedule'))
      .toBe(false);
  });
});

test.describe('cards and notes', () => {
  test('N, ↓, Enter links the second most recent note: three keystrokes', async ({ page }) => {
    const api = await open(page);
    await card(page, 'Pricing page layout').click();
    const panel = page.getByRole('region', { name: 'WEB-2: Pricing page layout' });
    await expect(panel).toBeFocused();
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog', { name: 'Link notes' });
    await expect(dialog.getByRole('option').first()).toContainText('Q4 roadmap');
    await expectNoA11yViolations(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    const linked = panel.getByRole('region', { name: 'Linked notes' });
    await expect(linked).toContainText('Call the plumber');
    await expect(linked).toContainText('Inbox');
    await expect(card(page, 'Pricing page layout').getByTitle('Linked notes')).toHaveText('1');
    expect(
      api.kanban.links.find((l) => l.cardId === serverCard(api, 'Pricing page layout').id),
    ).toMatchObject({ pageId: 'plumber' });

    // Searching, and making a new note in a chosen section.
    await linked.getByRole('button', { name: 'Link note' }).click();
    await page.getByRole('combobox', { name: 'Find a note' }).fill('Tier names');
    await page.getByRole('option', { name: 'Create new note “Tier names”' }).click();
    await expect(linked).toContainText('Tier names');
    expect(api.notes.tree.pages.some((p) => p.title === 'Tier names')).toBe(true);

    // Unlinking.
    await linked.getByRole('button', { name: 'Unlink Call the plumber' }).click();
    await expect(linked).not.toContainText('Call the plumber');
  });

  test('a note lists its cards, and adds itself to a board', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const api = await open(page, '/p/q4');
    const cards = page.getByRole('list', { name: 'Linked cards' });
    await expect(cards.getByRole('button', { name: /WEB-1/ })).toContainText('Hero section copy');
    await page.getByRole('button', { name: 'Add to board…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add to board' });
    await expect(dialog.getByLabel('Card title')).toHaveValue('Q4 roadmap');
    await dialog.getByRole('button', { name: 'Add card' }).click();
    await expect(page.getByRole('status').getByText('Added to Website relaunch')).toBeVisible();
    await expect(cards.getByRole('button')).toHaveCount(2);
    const made = api.kanban.cards.find((c) => c.title === 'Q4 roadmap')!;
    expect(api.kanban.links.some((l) => l.cardId === made.id && l.pageId === 'q4')).toBe(true);
    await cards.getByRole('button', { name: /WEB-8/ }).click();
    await expect(page.getByRole('region', { name: 'WEB-8: Q4 roadmap' })).toBeVisible();
  });

  test('a card key in a note opens the card', async ({ page }) => {
    const api = new FakeApi();
    api.notes.content.set('drn', 'Blocked by WEB-4 until design signs off. Not ABC-1.');
    await open(page, '/p/drn', api);
    await page.getByRole('radio', { name: 'Preview' }).click();
    const preview = page.locator('[data-preview] .markdown-body');
    // Only keys of projects that exist are links.
    await expect(preview.getByRole('link')).toHaveText(['WEB-4']);
    await preview.getByRole('link', { name: 'WEB-4' }).click();
    await expect(page).toHaveURL(/\/b\/relaunch\?card=/);
    await expect(page.getByRole('region', { name: 'WEB-4: New navigation' })).toBeVisible();
  });

  test('search finds cards too', async ({ page }) => {
    await open(page, '/search?q=navigation');
    const cards = page.getByRole('list', { name: 'Cards' });
    await expect(cards).toContainText('WEB-4');
    await expect(cards).toContainText('New navigation');
    await page.getByRole('checkbox', { name: 'Include cards' }).uncheck();
    await expect(cards).toBeHidden();
  });
});

// Dragging (§9.11): wherever the pointer is over a column, the card lands in that column,
// where the placeholder shows.

interface Point {
  x: number;
  y: number;
}

async function centre(locator: Locator): Promise<Point> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

type Pointer = {
  down(at: Point): Promise<void>;
  move(to: Point): Promise<void>;
  up(): Promise<void>;
};

function mouse(page: Page): Pointer {
  return {
    async down(at) {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
    },
    async move(to) {
      await page.mouse.move(to.x, to.y, { steps: 8 });
    },
    up: () => page.mouse.up(),
  };
}

function finger(page: Page, cdp: CDPSession): Pointer {
  let last: Point = { x: 0, y: 0 };
  const touch = (type: string, points: Point[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: points.map((p) => ({ x: p.x, y: p.y })),
    });
  return {
    async down(at) {
      last = at;
      await touch('touchStart', [at]);
      // A long press picks the card up.
      await page.waitForTimeout(500);
    },
    async move(to) {
      const from = last;
      for (let i = 1; i <= 8; i++) {
        await touch('touchMove', [
          { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 },
        ]);
      }
      last = to;
    },
    up: async () => {
      await touch('touchEnd', []);
    },
  };
}

/** Drags a card to a point, checks the highlighted column and the placeholder, and drops. */
async function dragTo(
  page: Page,
  pointer: Pointer,
  title: string,
  to: (board: Locator) => Promise<Point>,
  expected: { column: string; index: number },
  api: FakeApi,
) {
  const from = await centre(card(page, title));
  await pointer.down(from);
  await pointer.move({ x: from.x + 12, y: from.y + 12 });
  await pointer.move(await to(page.locator('[data-kb-board]')));
  const id = columnId(api, 'relaunch', expected.column);
  await expect(page.locator('[data-kb-target]')).toHaveCount(1);
  await expect(page.locator(`[data-kb-column-head="${id}"]`)).toHaveAttribute('data-kb-target', '');
  const items = column(page, expected.column).locator(':scope > li');
  await expect(items.nth(expected.index)).toHaveAttribute('data-kb-placeholder');
  await pointer.up();
  await expect.poll(() => titles(page, expected.column)).toContain(title);
  expect((await titles(page, expected.column)).indexOf(title)).toBe(expected.index);
  await expect
    .poll(() => serverColumn(api, 'relaunch', expected.column).indexOf(title))
    .toBe(expected.index);
}

async function withReview(page: Page) {
  const api = new FakeApi();
  // An empty column between Doing and Done.
  api.kanban.addColumn('relaunch', 'Review', false, columnId(api, 'relaunch', 'Done'));
  await open(page, '/b/relaunch', api);
  return api;
}

const DROPS: {
  name: string;
  title: string;
  to: (page: Page) => (board: Locator) => Promise<Point>;
  expected: { column: string; index: number };
}[] = [
  {
    name: 'onto another card',
    title: 'Pricing page layout',
    // The top half of a card: before it.
    to: (page) => async () => {
      const box = (await card(page, 'Launch announcement').boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height * 0.3 };
    },
    expected: { column: 'Doing', index: 1 },
  },
  {
    name: 'onto a column header',
    title: 'Broken link in the footer',
    to: (page) => () => centre(heading(page, 'Doing')),
    expected: { column: 'Doing', index: 0 },
  },
  {
    name: 'onto the empty space below the last card',
    title: 'Hero section copy',
    to: (page) => async (board) => {
      const box = (await board.boundingBox())!;
      const done = (await heading(page, 'Done').boundingBox())!;
      return { x: done.x + 40, y: box.y + box.height - 60 };
    },
    expected: { column: 'Done', index: 1 },
  },
  {
    name: 'onto an empty column',
    title: 'New navigation',
    to: (page) => () => centre(column(page, 'Review')),
    expected: { column: 'Review', index: 0 },
  },
  {
    name: 'into the gap between two columns',
    title: 'Pick the fonts',
    // Nearer the right-hand column.
    to: (page) => async () => {
      const heads = page.locator('[data-kb-column-head]');
      const left = (await heads.nth(0).boundingBox())!;
      const right = (await heads.nth(1).boundingBox())!;
      const doing = (await column(page, 'Doing').boundingBox())!;
      return { x: (left.x + left.width + right.x) / 2 + 3, y: doing.y + doing.height + 30 };
    },
    expected: { column: 'Doing', index: 2 },
  },
];

test.describe('dragging with a mouse', () => {
  for (const drop of DROPS) {
    test(`drops ${drop.name}`, async ({ page }) => {
      const api = await withReview(page);
      await dragTo(page, mouse(page), drop.title, drop.to(page), drop.expected, api);
    });
  }

  test('Esc cancels a drag; columns drag by their header', async ({ page }) => {
    const api = await withReview(page);
    const pointer = mouse(page);
    const from = await centre(card(page, 'Hero section copy'));
    await pointer.down(from);
    await pointer.move(await centre(column(page, 'Review')));
    await expect(page.locator('[data-kb-placeholder]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-kb-placeholder]')).toHaveCount(0);
    await pointer.up();
    expect(await titles(page, 'To do')).toContain('Hero section copy');

    // A column dragged by its name goes where the line shows.
    const head = heading(page, 'Review');
    await pointer.down(await centre(head));
    const todo = (await heading(page, 'To do').boundingBox())!;
    await pointer.move({ x: todo.x + 10, y: todo.y + todo.height / 2 });
    await pointer.up();
    await expect(page.locator('[data-kb-board]').getByRole('heading', { level: 2 })).toHaveText([
      'Review',
      'To do',
      'Doing',
      /^Done/,
    ]);
    await expect
      .poll(() => api.kanban.board('relaunch').columns.map((c) => c.name))
      .toEqual(['Review', 'To do', 'Doing', 'Done']);
  });
});

test.describe('dragging with a finger', () => {
  test.use({ hasTouch: true });

  for (const drop of DROPS) {
    test(`drops ${drop.name}`, async ({ page }) => {
      const api = await withReview(page);
      const cdp = await page.context().newCDPSession(page);
      await dragTo(page, finger(page, cdp), drop.title, drop.to(page), drop.expected, api);
    });
  }

  test('a quick swipe scrolls instead of dragging', async ({ page }) => {
    const api = await withReview(page);
    const cdp = await page.context().newCDPSession(page);
    const from = await centre(card(page, 'Hero section copy'));
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y }],
    });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + i * 30, y: from.y }],
      });
    }
    await expect(page.locator('[data-kb-placeholder]')).toHaveCount(0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(serverColumn(api, 'relaunch', 'To do')).toContain('Hero section copy');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('one column per screen; the card sheet moves a card', async ({ page }) => {
    const api = await open(page);
    const board = page.locator('[data-kb-board]');
    await expect(column(page, 'To do')).toBeInViewport();
    await expect(column(page, 'Doing')).not.toBeInViewport({ ratio: 0.5 });
    await board.evaluate((el) => el.scrollTo({ left: el.clientWidth }));
    await expect(column(page, 'Doing')).toBeInViewport({ ratio: 0.9 });
    await board.evaluate((el) => el.scrollTo({ left: 0 }));

    await card(page, 'Broken link in the footer').click();
    const sheet = page.getByRole('dialog', { name: 'Card' });
    await expect(
      sheet.getByRole('region', { name: 'WEB-3: Broken link in the footer' }),
    ).toBeVisible();
    await sheet.getByRole('combobox', { name: 'Column' }).click();
    await page.getByRole('option', { name: 'Done' }).click();
    await expect
      .poll(() => serverCard(api, 'Broken link in the footer').completedAt)
      .not.toBeNull();
    await expectNoA11yViolations(page);
  });
});
