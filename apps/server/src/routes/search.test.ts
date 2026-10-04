import {
  MARK_END,
  MARK_START,
  type ContentSaved,
  type SearchResponse,
  type Template,
  type Tree,
  type TreeChanges,
} from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexAllLinksOnce } from '../notes/links';
import { DAY, createTestApp, type Client, type TestApp } from '../test/harness';

/* Search, tags, links between pages and templates (§9.8, §9.9). */

let t: TestApp;
let me: Client;
let inboxId: string;

beforeEach(async () => {
  t = await createTestApp();
  me = await t.setupAdmin('alex');
  inboxId = ((await me.get('/api/v1/tree')).json() as Tree).inboxId;
});
afterEach(async () => {
  await t.close();
});

async function page(title: string, content = '', sectionId = inboxId, type = 'markdown') {
  const created = (
    await me.post('/api/v1/pages', { sectionId, title, type, content })
  ).json() as TreeChanges;
  return created.pages![0]!.id;
}

async function save(id: string, content: string) {
  const current = (await me.get(`/api/v1/pages/${id}`)).json() as { revision: number };
  const res = await me.put(`/api/v1/pages/${id}/content`, {
    baseRevision: current.revision,
    content,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as ContentSaved;
}

const search = async (query: string) =>
  (await me.get(`/api/v1/search?${query}`)).json() as SearchResponse;
const find = async (q: string) =>
  (await search(`q=${encodeURIComponent(q)}`)).hits.map((h) =>
    h.title.replaceAll(MARK_START, '').replaceAll(MARK_END, ''),
  );

const content = async (id: string) =>
  ((await me.get(`/api/v1/pages/${id}`)).json() as { content: string }).content;

describe('search', () => {
  it('finds words as they are typed, marks them, and weighs titles more', async () => {
    await page('Garden plans', 'Tomatoes along the south fence, basil in pots.');
    await page('Kitchen', 'Plant basil near the window; the garden gets too much sun.');
    const { hits, total } = await search('q=gard');
    expect(total).toBe(2);
    // The title match ranks first.
    expect(hits.map((h) => h.title)).toEqual([`${MARK_START}Garden${MARK_END} plans`, 'Kitchen']);
    expect(hits[1]!.snippet).toContain(`${MARK_START}garden${MARK_END}`);
    // Only the title matched: the snippet is the page's start.
    expect(hits[0]!.snippet).toBe('Tomatoes along the south fence, basil in pots.');
    // Accents and case don't matter.
    await page('Café notes', 'Crème brûlée.');
    expect(await find('creme cafe')).toEqual(['Café notes']);
  });

  it('understands phrases, exclusions, tags and places', async () => {
    const nb = (await me.post('/api/v1/notebooks', { name: 'Work', color: 'blue' })).json();
    const work = nb.sections[0].id as string;
    const a = await page('Launch', 'The quick brown fox.', work);
    await page('Draft', 'A brown quick fox.');
    await page('Old', 'The quick brown fox, archived.');
    await me.put(`/api/v1/pages/${a}/tags`, { names: ['Urgent'] });
    expect(await find('"quick brown"')).toEqual(expect.arrayContaining(['Launch', 'Old']));
    expect(await find('"quick brown"')).toHaveLength(2);
    expect(await find('fox -archived')).toEqual(expect.arrayContaining(['Launch', 'Draft']));
    expect(await find('fox -archived')).toHaveLength(2);
    expect(await find('fox tag:urgent')).toEqual(['Launch']);
    expect(await find('tag:urgent')).toEqual(['Launch']);
    expect(await find('fox in:work')).toEqual(['Launch']);
    expect(await find('fox in:"new section"')).toEqual(['Launch']);
    expect(await find('fox in:inbox')).toHaveLength(2);
    // Tag names are searched as words too.
    expect(await find('urgent')).toEqual(['Launch']);
  });

  it('filters by place, tag, type and date, and leaves deleted pages out', async () => {
    const old = await page('Old idea', 'An idea from long ago.');
    // Edited long ago (moving the clock would end the session).
    t.db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').run(t.clock.now() - 40 * DAY, old);
    const recent = await page('New idea', 'An idea from today.');
    await page(
      'Rich idea',
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A rich idea.' }] }],
      }),
      inboxId,
      'rich',
    );
    expect((await search('q=idea&modified=month')).hits.map((h) => h.id)).not.toContain(old);
    expect((await search('q=idea&type=rich')).hits.map((h) => h.title)).toEqual([
      `Rich ${MARK_START}idea${MARK_END}`,
    ]);
    expect((await search(`q=idea&sectionId=${inboxId}`)).total).toBe(3);
    await me.post('/api/v1/pages/delete', { ids: [recent] });
    expect(await find('idea')).not.toContain('New idea');
    // Nothing to search for: nothing found.
    expect(await search('q=')).toEqual({ hits: [], total: 0 });
  });

  it('follows edits, renames and tags, and boosts pages opened lately', async () => {
    const a = await page('Alpha', 'Nothing yet.');
    const b = await page('Beta', 'Nothing yet.');
    await save(a, 'Meeting about the roadmap.');
    await save(b, 'Meeting about the roadmap.');
    expect((await find('roadmap')).length).toBe(2);
    await me.patch(`/api/v1/settings`, { ui: { recent: [{ type: 'page', id: b, at: 1 }] } });
    expect((await find('roadmap'))[0]).toBe('Beta');
    await me.patch(`/api/v1/pages/${a}`, { title: 'Gamma' });
    expect(await find('gamma')).toEqual(['Gamma']);
    await save(a, 'Something else entirely.');
    expect(await find('roadmap')).toEqual(['Beta']);
  });
  // Its speed with 10,000 pages: search.perf.test.ts.
});

describe('tags', () => {
  it('sets tags by name, once whatever the case, and keeps them in the tree', async () => {
    const id = await page('Plans');
    const res = (
      await me.put(`/api/v1/pages/${id}/tags`, { names: ['Work', 'work ', 'Q4'] })
    ).json() as TreeChanges;
    expect(res.tags!.map((x) => x.name)).toEqual(['Work', 'Q4']);
    const tree = (await me.get('/api/v1/tree')).json() as Tree;
    expect(tree.tags!.map((x) => x.name)).toEqual(['Q4', 'Work']);
    expect(tree.pages.find((p) => p.id === id)!.tags).toEqual(res.tags!.map((x) => x.id).sort());
    // An existing tag is reused.
    const other = await page('Other');
    const again = (await me.put(`/api/v1/pages/${other}/tags`, { names: ['WORK'] })).json();
    expect(again.tags).toEqual([]);
    // Saving content keeps the tags on the page.
    const saved = await save(id, 'Text');
    expect(saved.pages[0]!.tags).toHaveLength(2);
    // Taking one off.
    const off = (await me.put(`/api/v1/pages/${id}/tags`, { names: ['q4'] })).json();
    expect(off.pages[0].tags).toHaveLength(1);
    expect((await me.put(`/api/v1/pages/${id}/tags`, { names: ['a,b'] })).statusCode).toBe(400);
  });

  it('renames, colours and deletes tags', async () => {
    const id = await page('Plans', 'Some text.');
    const tag = (await me.put(`/api/v1/pages/${id}/tags`, { names: ['work'] })).json().tags[0];
    await page('Other');
    const other = (await me.put(`/api/v1/pages/${id}/tags`, { names: ['work', 'home'] })).json()
      .tags[0];
    const renamed = await me.patch(`/api/v1/tags/${tag.id}`, { name: 'Office', color: 'teal' });
    expect(renamed.json().tags[0]).toMatchObject({ name: 'Office', color: 'teal' });
    expect(await find('office')).toEqual(['Plans']);
    expect((await me.patch(`/api/v1/tags/${tag.id}`, { name: 'HOME' })).statusCode).toBe(409);
    const gone = (await me.delete(`/api/v1/tags/${other.id}`)).json() as TreeChanges;
    expect(gone.pages![0]!.tags).toEqual([tag.id]);
    expect(await find('home')).toEqual([]);
  });

  it('copies tags with a page', async () => {
    const id = await page('Plans');
    await me.put(`/api/v1/pages/${id}/tags`, { names: ['work'] });
    const copy = (await me.post(`/api/v1/pages/${id}/duplicate`)).json() as TreeChanges;
    expect(copy.pages![0]!.tags).toHaveLength(1);
  });
});

describe('links between pages', () => {
  it('lists backlinks, and follows edits', async () => {
    const target = await page('Roadmap');
    const a = await page('Notes', 'See [[Roadmap]].');
    const b = await page(
      'Rich',
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Roadmap',
                marks: [{ type: 'link', attrs: { href: 'wiki:Roadmap' } }],
              },
            ],
          },
        ],
      }),
      inboxId,
      'rich',
    );
    const backlinks = async () =>
      ((await me.get(`/api/v1/pages/${target}/backlinks`)).json() as { pages: string[] }).pages;
    expect((await backlinks()).sort()).toEqual([a, b].sort());
    await save(a, 'No link any more.');
    expect(await backlinks()).toEqual([b]);
    await me.post('/api/v1/pages/delete', { ids: [b] });
    expect(await backlinks()).toEqual([]);
  });

  it('renaming a page updates every link to it', async () => {
    const target = await page('Roadmap');
    const md = await page('Notes', 'See [[Roadmap]] and [[roadmap#Q4|the plan]]; `[[Roadmap]]`.');
    const rich = await page(
      'Rich',
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Roadmap',
                marks: [{ type: 'link', attrs: { href: 'wiki:Roadmap' } }],
              },
            ],
          },
        ],
      }),
      inboxId,
      'rich',
    );
    const res = (
      await me.patch(`/api/v1/pages/${target}`, { title: 'Plan 2027' })
    ).json() as TreeChanges;
    expect(res.pages!.map((p) => p.id).sort()).toEqual([target, md, rich].sort());
    expect(await content(md)).toBe(
      'See [[Plan 2027]] and [[Plan 2027#Q4|the plan]]; `[[Roadmap]]`.',
    );
    expect(JSON.parse(await content(rich)).content[0].content[0]).toMatchObject({
      text: 'Plan 2027',
      marks: [{ type: 'link', attrs: { href: `wiki:${encodeURIComponent('Plan 2027')}` } }],
    });
    expect(
      ((await me.get(`/api/v1/pages/${target}/backlinks`)).json() as { pages: string[] }).pages,
    ).toHaveLength(2);
  });

  it('leaves links alone while another page has the old title', async () => {
    const first = await page('Roadmap');
    await page('Roadmap', 'The other one.');
    const md = await page('Notes', 'See [[Roadmap]].');
    await me.patch(`/api/v1/pages/${first}`, { title: 'Old roadmap' });
    expect(await content(md)).toBe('See [[Roadmap]].');
  });

  it('indexes the links of pages from before the update, once', async () => {
    const target = await page('Roadmap');
    const md = await page('Notes', 'See [[Roadmap]].');
    t.db.prepare('DELETE FROM page_links').run();
    t.db.prepare("DELETE FROM app_meta WHERE key = 'links_indexed'").run();
    expect(indexAllLinksOnce(t.db)).toBeGreaterThanOrEqual(2);
    expect(indexAllLinksOnce(t.db)).toBe(0);
    expect((await me.get(`/api/v1/pages/${target}/backlinks`)).json()).toEqual({ pages: [md] });
  });
});

describe('templates', () => {
  it('lists the built-in ones, and saves, renames and deletes one’s own', async () => {
    const list = async () => (await me.get('/api/v1/templates')).json() as Template[];
    expect((await list()).map((x) => x.name)).toEqual([
      'Meeting notes',
      'To-do list',
      'Project brief',
      'Daily journal',
      'Decision record',
    ]);
    const made = await me.post('/api/v1/templates', {
      name: 'Weekly review',
      type: 'markdown',
      content: '## Week of {{date}}',
    });
    expect(made.statusCode).toBe(201);
    const id = (made.json() as Template).id;
    expect((await list()).at(-1)).toMatchObject({ name: 'Weekly review', builtIn: false });
    await me.patch(`/api/v1/templates/${id}`, { name: 'Review' });
    expect((await list()).at(-1)!.name).toBe('Review');
    expect((await me.delete(`/api/v1/templates/${id}`)).statusCode).toBe(204);
    expect((await list()).map((x) => x.builtIn)).toEqual([true, true, true, true, true]);
    expect((await me.delete(`/api/v1/templates/${id}`)).statusCode).toBe(404);
  });
});
