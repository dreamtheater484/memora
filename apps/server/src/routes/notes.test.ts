import {
  bySortKey,
  uuidv7,
  type DeleteResponse,
  type Page,
  type PageMeta,
  type Tree,
  type TreeChanges,
} from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type Client, type TestApp } from '../test/harness';

let t: TestApp;
let me: Client;

beforeEach(async () => {
  t = await createTestApp();
  me = await t.setupAdmin('alex');
});
afterEach(async () => {
  await t.close();
});

const tree = async (): Promise<Tree> => (await me.get('/api/v1/tree')).json();

/** Sends a change that must succeed and returns its answer. */
async function ok<T = TreeChanges>(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await me.request(method, url, body ?? {});
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json();
}

/** Sends a change that must fail, and returns the error code. */
async function refused(method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const res = await me.request(method, url, body ?? {});
  expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
  return { status: res.statusCode, code: res.json().error.code as string };
}

async function notebook(name = 'Work') {
  const res = await ok('POST', '/api/v1/notebooks', { name, color: 'blue' });
  return { notebook: res.notebooks![0]!, section: res.sections![0]! };
}

async function page(sectionId: string, title: string, extra: Record<string, unknown> = {}) {
  return (await ok('POST', '/api/v1/pages', { sectionId, title, ...extra })).pages![0]!;
}

/** Titles in list order, subpages indented by their depth. */
function outline(pages: PageMeta[], sectionId: string): string[] {
  const inSection = pages.filter((p) => p.sectionId === sectionId).sort(bySortKey);
  const lines: string[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const p of inSection.filter((x) => x.parentPageId === parent)) {
      lines.push(`${'  '.repeat(depth)}${p.title}`);
      visit(p.id, depth + 1);
    }
  };
  visit(null, 0);
  return lines;
}

describe('tree', () => {
  it('starts with just an inbox, created once', async () => {
    const first = await tree();
    expect(first.notebooks).toEqual([]);
    expect(first.sections).toEqual([
      expect.objectContaining({
        id: first.inboxId,
        name: 'Inbox',
        isInbox: true,
        notebookId: null,
      }),
    ]);
    expect((await tree()).inboxId).toBe(first.inboxId);
  });

  it('answers quickly with 1,000 pages', async () => {
    const { section } = await notebook();
    const insert = t.db.prepare(
      `INSERT INTO pages (id, owner_id, section_id, title, type, content, content_text, sort_key, created_at, updated_at)
       VALUES (?, (SELECT owner_id FROM sections WHERE id = ?), ?, ?, 'markdown', ?, ?, ?, 0, 0)`,
    );
    const text = 'Lorem ipsum dolor sit amet. '.repeat(200);
    t.db.transaction(() => {
      for (let i = 0; i < 1000; i += 1) {
        insert.run(
          uuidv7(),
          section.id,
          section.id,
          `Page ${i}`,
          text,
          text,
          `a${String(i).padStart(4, '0')}`,
        );
      }
    })();
    await tree(); // warm up
    const started = performance.now();
    const result = await tree();
    const elapsed = performance.now() - started;
    expect(result.pages).toHaveLength(1000);
    expect(result.pages[0]!.snippet).toHaveLength(140);
    expect(elapsed).toBeLessThan(150);
  });
});

describe('notebooks', () => {
  it('come with a first section and keep their order', async () => {
    const work = await notebook('Work');
    expect(work.section).toMatchObject({ notebookId: work.notebook.id, groupId: null });
    const home = await notebook('Home');
    const ideas = await notebook('Ideas');
    await ok('POST', `/api/v1/notebooks/${ideas.notebook.id}/move`, { beforeId: work.notebook.id });
    await ok('POST', `/api/v1/notebooks/${work.notebook.id}/move`, { beforeId: null });
    expect((await tree()).notebooks.map((n) => n.name)).toEqual(['Ideas', 'Home', 'Work']);
    expect(home).toBeTruthy();
  });

  it('can be renamed, recoloured and given an icon', async () => {
    const { notebook: nb } = await notebook();
    t.clock.advance(1000);
    const res = await ok('PATCH', `/api/v1/notebooks/${nb.id}`, {
      name: '  Projects ',
      color: 'teal',
      icon: 'briefcase',
    });
    expect(res.notebooks![0]).toMatchObject({ name: 'Projects', color: 'teal', icon: 'briefcase' });
    expect(res.notebooks![0]!.updatedAt).toBeGreaterThan(nb.updatedAt);
  });

  it('refuses unknown colours, empty names and places that aren’t siblings', async () => {
    const { notebook: nb } = await notebook();
    expect(await refused('POST', '/api/v1/notebooks', { name: 'X', color: 'gold' })).toEqual({
      status: 400,
      code: 'invalid_request',
    });
    expect((await refused('PATCH', `/api/v1/notebooks/${nb.id}`, { name: ' ' })).code).toBe(
      'invalid_request',
    );
    expect(
      (await refused('POST', `/api/v1/notebooks/${nb.id}/move`, { beforeId: uuidv7() })).code,
    ).toBe('invalid_move');
  });

  it('go to the recycle bin with everything in them, and come back', async () => {
    const { notebook: nb, section } = await notebook();
    const group = (await ok('POST', '/api/v1/groups', { notebookId: nb.id, name: 'G' }))
      .groups![0]!;
    const p = await page(section.id, 'Plan');
    const deleted = await ok<DeleteResponse>('DELETE', `/api/v1/notebooks/${nb.id}`);
    expect(deleted.deleted).toEqual([{ type: 'notebook', id: nb.id }]);

    const empty = await tree();
    expect(empty.notebooks).toEqual([]);
    expect(empty.groups).toEqual([]);
    expect(empty.sections.map((s) => s.name)).toEqual(['Inbox']);
    expect(empty.pages).toEqual([]);
    expect((await me.get(`/api/v1/pages/${p.id}`)).statusCode).toBe(404);

    const back = await ok('POST', '/api/v1/trash/restore', {
      items: [{ type: 'notebook', id: nb.id }],
    });
    expect(back.notebooks!.map((n) => n.id)).toEqual([nb.id]);
    expect(back.groups!.map((g) => g.id)).toEqual([group.id]);
    expect(back.sections).toHaveLength(2);
    expect(back.pages!.map((x) => x.id)).toEqual([p.id]);
    expect((await tree()).pages).toHaveLength(1);
  });
});

describe('section groups', () => {
  it('nest up to four levels', async () => {
    const { notebook: nb } = await notebook();
    let parentGroupId: string | null = null;
    for (let level = 1; level <= 4; level += 1) {
      const res: TreeChanges = await ok('POST', '/api/v1/groups', {
        notebookId: nb.id,
        parentGroupId,
        name: `Level ${level}`,
      });
      expect(res.sections![0]!.groupId).toBe(res.groups![0]!.id);
      parentGroupId = res.groups![0]!.id;
    }
    // Each group's first section takes a colour the notebook isn't using yet.
    const colors = (await tree()).sections
      .filter((s) => s.notebookId === nb.id)
      .map((s) => s.color);
    expect(new Set(colors).size).toBe(5);
    expect(
      await refused('POST', '/api/v1/groups', { notebookId: nb.id, parentGroupId, name: 'Five' }),
    ).toEqual({ status: 400, code: 'too_deep' });
  });

  it('can’t go inside themselves or too deep', async () => {
    const { notebook: nb } = await notebook();
    const outer = (await ok('POST', '/api/v1/groups', { notebookId: nb.id, name: 'Outer' }))
      .groups![0]!;
    const inner = (
      await ok('POST', '/api/v1/groups', { notebookId: nb.id, parentGroupId: outer.id, name: 'In' })
    ).groups![0]!;
    const move = (id: string, parentGroupId: string | null) =>
      refused('POST', `/api/v1/groups/${id}/move`, { notebookId: nb.id, parentGroupId });
    expect((await move(outer.id, inner.id)).code).toBe('invalid_move');
    expect((await move(outer.id, outer.id)).code).toBe('invalid_move');

    const a = (await ok('POST', '/api/v1/groups', { notebookId: nb.id, name: 'A' })).groups![0]!;
    const b = (
      await ok('POST', '/api/v1/groups', { notebookId: nb.id, parentGroupId: a.id, name: 'B' })
    ).groups![0]!;
    const c = (
      await ok('POST', '/api/v1/groups', { notebookId: nb.id, parentGroupId: b.id, name: 'C' })
    ).groups![0]!;
    // Outer (2 levels) under C (level 3) would reach level 5.
    expect((await move(outer.id, c.id)).code).toBe('too_deep');
    await ok('POST', `/api/v1/groups/${outer.id}/move`, { notebookId: nb.id, parentGroupId: b.id });
  });

  it('take their sections and subgroups to another notebook', async () => {
    const one = await notebook('One');
    const two = await notebook('Two');
    const outer = await ok('POST', '/api/v1/groups', {
      notebookId: one.notebook.id,
      name: 'Outer',
    });
    const inner = await ok('POST', '/api/v1/groups', {
      notebookId: one.notebook.id,
      parentGroupId: outer.groups![0]!.id,
      name: 'Inner',
    });
    const res = await ok('POST', `/api/v1/groups/${outer.groups![0]!.id}/move`, {
      notebookId: two.notebook.id,
      parentGroupId: null,
    });
    expect(res.groups!.map((g) => g.notebookId)).toEqual([two.notebook.id, two.notebook.id]);
    expect(res.sections!.map((s) => s.id).sort()).toEqual(
      [outer.sections![0]!.id, inner.sections![0]!.id].sort(),
    );
    expect(res.sections!.every((s) => s.notebookId === two.notebook.id)).toBe(true);
  });

  it('can be renamed and deleted with their contents', async () => {
    const { notebook: nb } = await notebook();
    const created = await ok('POST', '/api/v1/groups', { notebookId: nb.id, name: 'Old' });
    const group = created.groups![0]!;
    const renamed = await ok('PATCH', `/api/v1/groups/${group.id}`, { name: 'New' });
    expect(renamed.groups![0]!.name).toBe('New');
    const p = await page(created.sections![0]!.id, 'Inside');
    await ok('DELETE', `/api/v1/groups/${group.id}`);
    const after = await tree();
    expect(after.groups).toEqual([]);
    expect(after.pages.map((x) => x.id)).not.toContain(p.id);
  });
});

describe('sections', () => {
  it('move between notebooks and groups, in order', async () => {
    const one = await notebook('One');
    const two = await notebook('Two');
    const group = (await ok('POST', '/api/v1/groups', { notebookId: two.notebook.id, name: 'G' }))
      .groups![0]!;
    const res = await ok('POST', `/api/v1/sections/${one.section.id}/move`, {
      notebookId: two.notebook.id,
      groupId: group.id,
      beforeId: null,
    });
    expect(res.sections![0]).toMatchObject({ notebookId: two.notebook.id, groupId: group.id });
    const ordered = await ok('POST', `/api/v1/sections/${two.section.id}/move`, {
      notebookId: two.notebook.id,
      groupId: group.id,
      beforeId: one.section.id,
    });
    const inGroup = (await tree()).sections.filter((s) => s.groupId === group.id).sort(bySortKey);
    expect(inGroup.map((s) => s.id).slice(-2)).toEqual([two.section.id, one.section.id]);
    expect(ordered).toBeTruthy();
  });

  it('refuse a group from another notebook', async () => {
    const one = await notebook('One');
    const two = await notebook('Two');
    const group = (await ok('POST', '/api/v1/groups', { notebookId: two.notebook.id, name: 'G' }))
      .groups![0]!;
    expect(
      (
        await refused('POST', '/api/v1/sections', {
          notebookId: one.notebook.id,
          groupId: group.id,
          name: 'S',
          color: 'lime',
        })
      ).code,
    ).toBe('invalid_move');
  });

  it('keep the inbox in its place', async () => {
    const { inboxId } = await tree();
    const { notebook: nb } = await notebook();
    expect((await refused('PATCH', `/api/v1/sections/${inboxId}`, { name: 'Mine' })).status).toBe(
      409,
    );
    expect(
      (await refused('POST', `/api/v1/sections/${inboxId}/move`, { notebookId: nb.id })).status,
    ).toBe(409);
    expect((await refused('DELETE', `/api/v1/sections/${inboxId}`)).status).toBe(409);
    const recoloured = await ok('PATCH', `/api/v1/sections/${inboxId}`, { color: 'green' });
    expect(recoloured.sections![0]!.color).toBe('green');
  });
});

describe('pages', () => {
  it('start with a snippet of their text, and open with all of it', async () => {
    const { inboxId } = await tree();
    const content = '# Shopping\n\n- **Milk**\n- [Bread](https://example.com)';
    const created = await page(inboxId, 'Quick note', { content });
    expect(created.snippet).toBe('Shopping Milk Bread');
    const full: Page = (await me.get(`/api/v1/pages/${created.id}`)).json();
    expect(full).toMatchObject({ content, revision: 1, viewMode: null, type: 'markdown' });
  });

  it('nest three levels deep', async () => {
    const { section } = await notebook();
    const one = await page(section.id, 'One');
    const two = await page(section.id, 'Two', { parentPageId: one.id });
    const three = await page(section.id, 'Three', { parentPageId: two.id });
    expect(
      await refused('POST', '/api/v1/pages', { sectionId: section.id, parentPageId: three.id }),
    ).toEqual({ status: 400, code: 'too_deep' });
  });

  it('are placed before a sibling, or last', async () => {
    const { section } = await notebook();
    const a = await page(section.id, 'A');
    await page(section.id, 'C');
    await page(section.id, 'B', {
      beforeId: (await tree()).pages.find((p) => p.title === 'C')!.id,
    });
    await page(section.id, 'First', { beforeId: a.id });
    expect(outline((await tree()).pages, section.id)).toEqual(['First', 'A', 'B', 'C']);
  });

  it('move with their subpages, in the order given', async () => {
    const one = await notebook('One');
    const two = await notebook('Two');
    const a = await page(one.section.id, 'A');
    const a1 = await page(one.section.id, 'A1', { parentPageId: a.id });
    const b = await page(one.section.id, 'B');
    const target = await page(two.section.id, 'Target');
    const res = await ok('POST', '/api/v1/pages/move', {
      // A1 goes along with A; listing it too changes nothing.
      ids: [b.id, a.id, a1.id],
      sectionId: two.section.id,
      parentPageId: target.id,
    });
    expect(res.pages!.map((p) => p.title).sort()).toEqual(['A', 'A1', 'B']);
    const pages = (await tree()).pages;
    expect(outline(pages, one.section.id)).toEqual([]);
    expect(outline(pages, two.section.id)).toEqual(['Target', '  B', '  A', '    A1']);
  });

  it('can’t move inside themselves or too deep', async () => {
    const { section } = await notebook();
    const a = await page(section.id, 'A');
    const a1 = await page(section.id, 'A1', { parentPageId: a.id });
    const b = await page(section.id, 'B');
    const b1 = await page(section.id, 'B1', { parentPageId: b.id });
    const move = (ids: string[], parentPageId: string | null) =>
      refused('POST', '/api/v1/pages/move', { ids, sectionId: section.id, parentPageId });
    expect((await move([a.id], a1.id)).code).toBe('invalid_move');
    // A has two levels; under B1 (level 2) it would reach level 4.
    expect((await move([a.id], b1.id)).code).toBe('too_deep');
    await ok('POST', '/api/v1/pages/move', {
      ids: [a.id],
      sectionId: section.id,
      parentPageId: b.id,
    });
    // Outdent back to the top.
    await ok('POST', '/api/v1/pages/move', {
      ids: [a.id],
      sectionId: section.id,
      parentPageId: null,
    });
    expect(outline((await tree()).pages, section.id)).toEqual(['B', '  B1', 'A', '  A1']);
  });

  it('copy with new ids and their content; duplicate right after the original', async () => {
    const { section } = await notebook();
    const a = await page(section.id, 'A', { content: 'alpha' });
    await page(section.id, 'A1', { parentPageId: a.id, content: 'child' });
    await page(section.id, 'B');
    const dup = await ok('POST', `/api/v1/pages/${a.id}/duplicate`);
    expect(dup.pages!.map((p) => p.title)).toEqual(['A (copy)', 'A1']);
    expect(dup.pages!.every((p) => p.id !== a.id)).toBe(true);
    const copyId = dup.pages![0]!.id;
    expect((await me.get(`/api/v1/pages/${copyId}`)).json().content).toBe('alpha');
    expect(outline((await tree()).pages, section.id)).toEqual([
      'A',
      '  A1',
      'A (copy)',
      '  A1',
      'B',
    ]);

    const { inboxId } = await tree();
    await ok('POST', '/api/v1/pages/copy', { ids: [a.id], sectionId: inboxId });
    expect(outline((await tree()).pages, inboxId)).toEqual(['A', '  A1']);
  });

  it('can be renamed and remember their view mode', async () => {
    const { section } = await notebook();
    const p = await page(section.id, 'Old');
    t.clock.advance(1000);
    const view = await ok('PATCH', `/api/v1/pages/${p.id}`, { viewMode: 'split' });
    expect(view.pages![0]!.updatedAt).toBe(p.updatedAt);
    const renamed = await ok('PATCH', `/api/v1/pages/${p.id}`, { title: 'New' });
    expect(renamed.pages![0]!.title).toBe('New');
    expect(renamed.pages![0]!.updatedAt).toBeGreaterThan(p.updatedAt);
    expect((await me.get(`/api/v1/pages/${p.id}`)).json().viewMode).toBe('split');
  });
});

describe('recycle bin', () => {
  it('takes pages with their subpages, and Undo brings them back in place', async () => {
    const { section } = await notebook();
    const a = await page(section.id, 'A');
    const a1 = await page(section.id, 'A1', { parentPageId: a.id });
    const b = await page(section.id, 'B');
    const res = await ok<DeleteResponse>('POST', '/api/v1/pages/delete', {
      ids: [a1.id, a.id, b.id],
    });
    expect(res.deleted).toEqual([
      { type: 'page', id: a.id },
      { type: 'page', id: b.id },
    ]);
    expect(outline((await tree()).pages, section.id)).toEqual([]);
    await ok('POST', '/api/v1/trash/restore', { items: res.deleted });
    expect(outline((await tree()).pages, section.id)).toEqual(['A', '  A1', 'B']);
  });

  it('keeps what was deleted earlier when restoring a section', async () => {
    const { notebook: nb, section } = await notebook();
    const kept = await page(section.id, 'Kept');
    const gone = await page(section.id, 'Gone');
    await ok('POST', '/api/v1/pages/delete', { ids: [gone.id] });
    await ok('DELETE', `/api/v1/sections/${section.id}`);
    // The page can't come back while its section is in the bin.
    expect(
      await refused('POST', '/api/v1/trash/restore', { items: [{ type: 'page', id: gone.id }] }),
    ).toEqual({ status: 409, code: 'conflict' });
    await ok('POST', '/api/v1/trash/restore', { items: [{ type: 'section', id: section.id }] });
    expect((await tree()).pages.map((p) => p.id)).toEqual([kept.id]);
    // Something that isn't in the bin (or not as itself) can't be restored.
    expect(
      (await refused('POST', '/api/v1/trash/restore', { items: [{ type: 'notebook', id: nb.id }] }))
        .status,
    ).toBe(404);
  });

  it('gives a restored item a new place when its old one was taken', async () => {
    const { section } = await notebook();
    const a = await page(section.id, 'A');
    await ok('POST', '/api/v1/pages/delete', { ids: [a.id] });
    const b = await page(section.id, 'B'); // takes A's old sort key
    expect(b.sortKey).toBe(a.sortKey);
    await ok('POST', '/api/v1/trash/restore', { items: [{ type: 'page', id: a.id }] });
    expect(outline((await tree()).pages, section.id)).toEqual(['B', 'A']);
  });

  it('keeps subpages deleted earlier with their parent when it moves', async () => {
    const one = await notebook('One');
    const two = await notebook('Two');
    const a = await page(one.section.id, 'A');
    const a1 = await page(one.section.id, 'A1', { parentPageId: a.id });
    await ok('POST', '/api/v1/pages/delete', { ids: [a1.id] });
    await ok('POST', '/api/v1/pages/move', { ids: [a.id], sectionId: two.section.id });
    await ok('POST', '/api/v1/trash/restore', { items: [{ type: 'page', id: a1.id }] });
    expect(outline((await tree()).pages, two.section.id)).toEqual(['A', '  A1']);
  });
});

describe('settings', () => {
  it('keep UI state per user, merging changes', async () => {
    expect((await me.get('/api/v1/settings')).json()).toEqual({ ui: {}, editor: {} });
    const s1 = uuidv7();
    const s2 = uuidv7();
    const p1 = uuidv7();
    const p2 = uuidv7();
    await ok('PATCH', '/api/v1/settings', { ui: { lastSectionId: s1, lastPages: { [s1]: p1 } } });
    const res = await ok<{ ui: unknown }>('PATCH', '/api/v1/settings', {
      ui: { pageListSide: 'left', lastPages: { [s2]: p2 } },
    });
    expect(res.ui).toEqual({
      lastSectionId: s1,
      pageListSide: 'left',
      lastPages: { [s1]: p1, [s2]: p2 },
    });
    expect((await me.get('/api/v1/settings')).json()).toEqual(res);
    expect((await refused('PATCH', '/api/v1/settings', { ui: { pageListSide: 'up' } })).code).toBe(
      'invalid_request',
    );
  });

  it('keep each rich page’s text width, merging changes and forgetting a reset one', async () => {
    const a = uuidv7();
    const b = uuidv7();
    await ok('PATCH', '/api/v1/settings', { ui: { pageWidths: { [a]: 600 } } });
    let res = await ok<{ ui: { pageWidths?: unknown } }>('PATCH', '/api/v1/settings', {
      ui: { pageWidths: { [b]: 720 } },
    });
    expect(res.ui.pageWidths).toEqual({ [a]: 600, [b]: 720 });
    // null: the page's text fits the pane again.
    res = await ok<typeof res>('PATCH', '/api/v1/settings', { ui: { pageWidths: { [a]: null } } });
    expect(res.ui.pageWidths).toEqual({ [b]: 720 });
    for (const width of [100, 5000, 600.5]) {
      expect(
        (await refused('PATCH', '/api/v1/settings', { ui: { pageWidths: { [a]: width } } })).code,
      ).toBe('invalid_request');
    }
  });

  it('keep the look of rich text pages', async () => {
    const res = await ok<{ editor: unknown }>('PATCH', '/api/v1/settings', {
      editor: { richSpacing: 'comfortable', richFont: 'Georgia, serif', richFontSize: 12 },
    });
    expect(res.editor).toEqual({
      richSpacing: 'comfortable',
      richFont: 'Georgia, serif',
      richFontSize: 12,
    });
    for (const editor of [{ richSpacing: 'airy' }, { richFontSize: 7 }, { richFontSize: 73 }]) {
      expect((await refused('PATCH', '/api/v1/settings', { editor })).code).toBe('invalid_request');
    }
  });

  it('keep editor preferences apart from UI state', async () => {
    await ok('PATCH', '/api/v1/settings', { ui: { pageListSide: 'left' } });
    await ok('PATCH', '/api/v1/settings', { editor: { lineNumbers: true, viewMode: 'source' } });
    const res = await ok<{ ui: unknown; editor: unknown }>('PATCH', '/api/v1/settings', {
      editor: { tabSize: 2 },
    });
    expect(res.editor).toEqual({ lineNumbers: true, viewMode: 'source', tabSize: 2 });
    expect(res.ui).toMatchObject({ pageListSide: 'left' });
    expect((await refused('PATCH', '/api/v1/settings', { editor: { tabSize: 0 } })).code).toBe(
      'invalid_request',
    );
    expect((await refused('PATCH', '/api/v1/settings', {})).code).toBe('invalid_request');
  });

  it('keep workspace layouts, full-width pages and the line length (§9.12)', async () => {
    const page = uuidv7();
    const layout = {
      name: 'Planning',
      panes: [
        {
          tabs: [
            { kind: 'board', target: uuidv7() },
            { kind: 'backlinks', target: null },
          ],
          active: 1,
        },
      ],
      sizes: [60, 40],
    };
    const res = await ok<{ ui: unknown; editor: unknown }>('PATCH', '/api/v1/settings', {
      ui: { layouts: [layout], fullWidth: [page] },
      editor: { lineLength: 90 },
    });
    expect(res.ui).toEqual({ layouts: [layout], fullWidth: [page] });
    expect(res.editor).toEqual({ lineLength: 90 });
    const bad = [
      { ui: { layouts: [{ ...layout, name: '' }] } },
      {
        ui: {
          layouts: [{ ...layout, panes: [{ tabs: [{ kind: 'video', target: null }], active: 0 }] }],
        },
      },
      { ui: { layouts: [{ ...layout, panes: Array(4).fill(layout.panes[0]) }] } },
      { ui: { fullWidth: ['not-an-id'] } },
      { editor: { lineLength: 400 } },
    ];
    for (const body of bad) {
      expect((await refused('PATCH', '/api/v1/settings', body)).code, JSON.stringify(body)).toBe(
        'invalid_request',
      );
    }
  });
});
