import {
  uuidv7,
  type BoardData,
  type Card,
  type CardDetail,
  type Projects,
  type Tree,
  type TreeChanges,
} from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanUnusedAssets } from '../assets/cleanup';
import { pngOf } from '../test/images';
import { DAY, createTestApp, type Client, type TestApp } from '../test/harness';

/* Kanban (§9.11): projects, boards, columns, lanes, cards and what cards hold. */

let t: TestApp;
let me: Client;

beforeEach(async () => {
  t = await createTestApp();
  me = await t.setupAdmin('alex');
});
afterEach(async () => {
  await t.close();
});

async function project(name = 'Website', key = 'WEB', template = 'basic') {
  const res = await me.post('/api/v1/projects', { name, key, color: 'cyan', template });
  expect(res.statusCode, res.body).toBe(201);
  const { project, board } = res.json();
  return { project, board: (await me.get(`/api/v1/boards/${board.id}`)).json() as BoardData };
}

async function card(columnId: string, title: string, extra: object = {}): Promise<Card> {
  const res = await me.post('/api/v1/cards', { columnId, title, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const boardOf = async (id: string) => (await me.get(`/api/v1/boards/${id}`)).json() as BoardData;
const detail = async (id: string) => (await me.get(`/api/v1/cards/${id}`)).json() as CardDetail;
const titlesIn = (board: BoardData, columnId: string) =>
  board.cards.filter((c) => c.columnId === columnId).map((c) => c.title);

describe('projects and boards', () => {
  it('starts a project with a board from a template, the last column being Done', async () => {
    const { project: p, board } = await project('Website', 'WEB', 'extended');
    expect(p).toMatchObject({ name: 'Website', key: 'WEB', archivedAt: null });
    expect(board.columns.map((c) => [c.name, c.isDone])).toEqual([
      ['Backlog', false],
      ['To do', false],
      ['In progress', false],
      ['Review', false],
      ['Done', true],
    ]);
    const empty = (
      await me.post('/api/v1/boards', { projectId: p.id, name: 'Ideas', template: 'empty' })
    ).json();
    expect((await boardOf(empty.id)).columns).toEqual([]);
    const list = (await me.get('/api/v1/projects')).json() as Projects;
    expect(list.boards.map((b) => b.name)).toEqual(['Board', 'Ideas']);
  });

  it('keeps project keys unique, and orders, archives and deletes projects', async () => {
    const a = await project('Website', 'WEB');
    const clash = await me.post('/api/v1/projects', { name: 'Web 2', key: 'web', color: 'blue' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('key_taken');
    const b = await project('Garden', 'GRD');
    await me.patch(`/api/v1/projects/${b.project.id}`, { beforeId: a.project.id, archived: true });
    let list = (await me.get('/api/v1/projects')).json() as Projects;
    expect(list.projects.map((p) => [p.key, !!p.archivedAt])).toEqual([
      ['GRD', true],
      ['WEB', false],
    ]);
    await card(a.board.columns[0]!.id, 'Gone with it');
    expect((await me.delete(`/api/v1/projects/${a.project.id}`)).statusCode).toBe(204);
    list = (await me.get('/api/v1/projects')).json() as Projects;
    expect(list.projects.map((p) => p.key)).toEqual(['GRD']);
    expect(list.boards).toHaveLength(1);
    expect((t.db.prepare('SELECT count(*) AS n FROM cards').get() as { n: number }).n).toBe(0);
  });
});

describe('cards', () => {
  it('numbers cards per project and places them where asked', async () => {
    const { board } = await project();
    const todo = board.columns[0]!.id;
    const one = await card(todo, 'One');
    const two = await card(todo, 'Two');
    await card(todo, 'Zero', { top: true });
    await card(todo, 'One and a half', { beforeId: two.id });
    expect(one.number).toBe(1);
    expect(two.number).toBe(2);
    expect(titlesIn(await boardOf(board.board.id), todo)).toEqual([
      'Zero',
      'One',
      'One and a half',
      'Two',
    ]);
    const found = (await me.get('/api/v1/cards/by-key/web-2')).json();
    expect(found).toEqual({ id: two.id, boardId: board.board.id });
    expect((await me.get('/api/v1/cards/by-key/WEB-99')).statusCode).toBe(404);
  });

  it('moves cards between columns, completing them in a Done column', async () => {
    const { board } = await project();
    const [todo, doing, done] = board.columns.map((c) => c.id) as [string, string, string];
    const a = await card(todo, 'A');
    const b = await card(doing, 'B');
    await me.post(`/api/v1/cards/${a.id}/move`, { columnId: doing, beforeId: b.id });
    expect(titlesIn(await boardOf(board.board.id), doing)).toEqual(['A', 'B']);
    let moved = (await me.post(`/api/v1/cards/${a.id}/move`, { columnId: done })).json();
    expect(moved.completedAt).not.toBeNull();
    moved = (await me.post(`/api/v1/cards/${a.id}/move`, { columnId: todo })).json();
    expect(moved.completedAt).toBeNull();
    const log = (await detail(a.id)).activity.map((x) => [x.type, x.payload]);
    expect(log).toContainEqual(['moved', { from: 'Doing', to: 'Done' }]);
    expect(log.at(-1)).toEqual(['created', { column: 'To do' }]);
  });

  it('keeps strict WIP limits, and only warns otherwise', async () => {
    const { board } = await project();
    const [todo, doing] = board.columns.map((c) => c.id) as [string, string];
    await me.patch(`/api/v1/columns/${doing}`, { wipLimit: 1, wipStrict: true });
    await card(doing, 'Busy');
    const refused = await me.post('/api/v1/cards', { columnId: doing, title: 'Too much' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'wip_limit',
      message: '“Doing” is full: its limit is 1 card.',
    });
    const waiting = await card(todo, 'Waiting');
    expect(
      (await me.post(`/api/v1/cards/${waiting.id}/move`, { columnId: doing })).statusCode,
    ).toBe(409);
    await me.patch(`/api/v1/columns/${doing}`, { wipStrict: false });
    expect(
      (await me.post(`/api/v1/cards/${waiting.id}/move`, { columnId: doing })).statusCode,
    ).toBe(200);
  });

  it('moves a card to another project with a new key, leaving its labels', async () => {
    const web = await project('Website', 'WEB');
    const app = await project('Garden', 'GRD');
    const label = (
      await me.post(`/api/v1/projects/${web.project.id}/labels`, { name: 'Bug', color: 'coral' })
    ).json();
    const c = await card(web.board.columns[0]!.id, 'Travels');
    await me.patch(`/api/v1/cards/${c.id}`, { labelIds: [label.id] });
    await card(app.board.columns[0]!.id, 'Already here');
    const moved = (
      await me.post(`/api/v1/cards/${c.id}/move`, { columnId: app.board.columns[1]!.id })
    ).json() as Card;
    expect(moved).toMatchObject({ boardId: app.board.board.id, number: 2, labelIds: [] });
    expect((await detail(c.id)).key).toBe('GRD-2');
    expect((await boardOf(web.board.board.id)).cards).toEqual([]);
  });

  it('edits, archives, restores and duplicates cards', async () => {
    const { project: p, board } = await project();
    const todo = board.columns[0]!.id;
    const label = (
      await me.post(`/api/v1/projects/${p.id}/labels`, { name: 'UX', color: 'violet' })
    ).json();
    const c = await card(todo, 'Draft');
    const patch = {
      title: 'Final',
      description: 'Some **bold** plans',
      priority: 'high',
      startDate: '2026-01-01',
      dueDate: '2026-01-05',
      coverColor: 'amber',
      labelIds: [label.id],
    };
    const edited = (await me.patch(`/api/v1/cards/${c.id}`, patch)).json() as Card;
    expect(edited).toMatchObject({
      title: 'Final',
      priority: 'high',
      dueDate: '2026-01-05',
      labelIds: [label.id],
    });
    const bad = await me.patch(`/api/v1/cards/${c.id}`, { dueDate: '5 Jan' });
    expect(bad.statusCode).toBe(400);
    await me.post(`/api/v1/cards/${c.id}/checklists`, { title: 'Steps' });
    const tree = (await me.get('/api/v1/tree')).json() as Tree;
    const pageId = (
      (
        await me.post('/api/v1/pages', { sectionId: tree.inboxId, title: 'Spec' })
      ).json() as TreeChanges
    ).pages![0]!.id;
    await me.put(`/api/v1/cards/${c.id}/pages/${pageId}`);

    const copy = (await me.post(`/api/v1/cards/${c.id}/duplicate`)).json() as Card;
    expect(copy).toMatchObject({
      title: 'Final (copy)',
      number: 2,
      labelIds: [label.id],
      pages: 1,
    });
    expect((await detail(copy.id)).checklists.map((l) => l.title)).toEqual(['Steps']);
    expect(titlesIn(await boardOf(board.board.id), todo)).toEqual(['Final', 'Final (copy)']);

    await me.patch(`/api/v1/cards/${c.id}`, { archived: true });
    expect(titlesIn(await boardOf(board.board.id), todo)).toEqual(['Final (copy)']);
    const archive = (
      await me.get(`/api/v1/boards/${board.board.id}?archived=1`)
    ).json() as BoardData;
    expect(archive.cards.map((x) => x.title)).toEqual(['Final']);
    await me.patch(`/api/v1/cards/${c.id}`, { archived: false });
    expect(titlesIn(await boardOf(board.board.id), todo)).toEqual(['Final (copy)', 'Final']);
    const types = (await detail(c.id)).activity.map((a) => a.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'renamed',
        'described',
        'priority_changed',
        'dates_changed',
        'labels_changed',
        'note_linked',
        'archived',
        'restored',
      ]),
    );
  });

  it('holds checklists, comments, files and linked notes, and counts them on its face', async () => {
    const { board } = await project();
    const c = await card(board.columns[0]!.id, 'Busy card');
    let d = (
      await me.post(`/api/v1/cards/${c.id}/checklists`, { title: 'Launch' })
    ).json() as CardDetail;
    const list = d.checklists[0]!.id;
    await me.post(`/api/v1/checklists/${list}/items`, { text: 'Write' });
    d = (await me.post(`/api/v1/checklists/${list}/items`, { text: 'Ship' })).json();
    const [write, ship] = d.checklists[0]!.items;
    await me.patch(`/api/v1/checklist-items/${write!.id}`, { done: true });
    d = (await me.patch(`/api/v1/checklist-items/${ship!.id}`, { beforeId: write!.id })).json();
    expect(d.checklists[0]!.items.map((i) => [i.text, i.done])).toEqual([
      ['Ship', false],
      ['Write', true],
    ]);
    d = (await me.post(`/api/v1/cards/${c.id}/comments`, { body: 'Looks good' })).json();
    expect(d.comments[0]).toMatchObject({ author: 'Admin', body: 'Looks good', editedAt: null });
    d = (await me.patch(`/api/v1/comments/${d.comments[0]!.id}`, { body: 'Looks great' })).json();
    expect(d.comments[0]!.editedAt).not.toBeNull();

    const assetId = uuidv7();
    await me.put(`/api/v1/assets/${assetId}?name=shot.png`, pngOf(2, 2), {
      headers: { 'content-type': 'image/png' },
    });
    d = (await me.post(`/api/v1/cards/${c.id}/attachments`, { assetId })).json();
    expect(d.attachments).toMatchObject([{ assetId, name: 'shot.png', mime: 'image/png' }]);

    const tree = (await me.get('/api/v1/tree')).json() as Tree;
    const pageId = (
      (
        await me.post('/api/v1/pages', { sectionId: tree.inboxId, title: 'Launch plan' })
      ).json() as TreeChanges
    ).pages![0]!.id;
    d = (await me.put(`/api/v1/cards/${c.id}/pages/${pageId}`)).json();
    expect(d.pages).toEqual([
      { pageId, title: 'Launch plan', sectionId: tree.inboxId, type: 'markdown', deleted: false },
    ]);
    const face = (await boardOf(board.board.id)).cards[0]!;
    expect(face).toMatchObject({
      checklist: { done: 1, total: 2 },
      comments: 1,
      attachments: 1,
      pages: 1,
    });

    // The note lists its cards, with where they are.
    const linked = (await me.get(`/api/v1/pages/${pageId}/cards`)).json();
    expect(linked.cards).toEqual([
      expect.objectContaining({
        id: c.id,
        key: 'WEB-1',
        title: 'Busy card',
        boardName: 'Board',
        columnName: 'To do',
      }),
    ]);
    // A deleted note shows as such, and doesn't count on the face.
    await me.post('/api/v1/pages/delete', { ids: [pageId] });
    expect((await detail(c.id)).pages[0]!.deleted).toBe(true);
    expect((await boardOf(board.board.id)).cards[0]!.pages).toBe(0);

    // Attached files are kept by the cleanup; a detached one goes.
    t.clock.advance(2 * DAY);
    expect(cleanUnusedAssets(t.db, t.clock.now())).toBe(0);
    await me.delete(`/api/v1/cards/${c.id}/attachments/${assetId}`);
    expect(cleanUnusedAssets(t.db, t.clock.now())).toBe(1);
  });
});

describe('search', () => {
  it('finds cards by title and description when asked, never archived ones', async () => {
    const { board } = await project();
    const c = await card(board.columns[0]!.id, 'Replace the hero banner');
    await me.patch(`/api/v1/cards/${c.id}`, { description: 'Use the new photograph' });
    const old = await card(board.columns[0]!.id, 'Old hero idea');
    await me.patch(`/api/v1/cards/${old.id}`, { archived: true });
    const found = (await me.get('/api/v1/search?q=photo&cards=1')).json();
    expect(found.cards).toEqual([
      expect.objectContaining({ id: c.id, key: 'WEB-1', boardName: 'Board', columnName: 'To do' }),
    ]);
    expect(found.cards[0].snippet).toContain('\u0001photo');
    const hero = (await me.get('/api/v1/search?q=hero&cards=1')).json();
    expect(hero.cards.map((x: { id: string }) => x.id)).toEqual([c.id]);
    expect((await me.get('/api/v1/search?q=hero')).json().cards).toBeUndefined();
  });
});

describe('columns and lanes', () => {
  it('reorders, completes and deletes columns; lanes hold cards until deleted', async () => {
    const { board } = await project();
    const [todo, doing, done] = board.columns.map((c) => c.id) as [string, string, string];
    await me.patch(`/api/v1/columns/${done}`, { beforeId: todo });
    let b = await boardOf(board.board.id);
    expect(b.columns.map((c) => c.name)).toEqual(['Done', 'To do', 'Doing']);
    const c = await card(doing, 'Half way');
    await me.patch(`/api/v1/columns/${doing}`, { isDone: true });
    b = await boardOf(board.board.id);
    expect(b.cards[0]!.completedAt).not.toBeNull();
    const lane = (
      await me.post(`/api/v1/boards/${board.board.id}/lanes`, { name: 'Urgent' })
    ).json();
    await me.post(`/api/v1/cards/${c.id}/move`, { columnId: doing, swimlaneId: lane.id });
    expect((await boardOf(board.board.id)).cards[0]!.swimlaneId).toBe(lane.id);
    await me.patch(`/api/v1/boards/${board.board.id}`, { lanes: 'custom' });
    expect((await boardOf(board.board.id)).board.settings.lanes).toBe('custom');
    await me.delete(`/api/v1/lanes/${lane.id}`);
    expect((await boardOf(board.board.id)).cards[0]!.swimlaneId).toBeNull();
    await me.delete(`/api/v1/columns/${doing}`);
    b = await boardOf(board.board.id);
    expect(b.columns.map((x) => x.name)).toEqual(['Done', 'To do']);
    expect(b.cards).toEqual([]);
  });

  it('tells the user’s other browsers what changed', async () => {
    const { board } = await project();
    const socket = await me.events();
    const seen: unknown[] = [];
    socket.on('message', (data: Buffer) => {
      const event = JSON.parse(data.toString());
      if (event.type === 'board.changed' || event.type === 'projects.changed') seen.push(event);
    });
    const c = await card(board.columns[0]!.id, 'Live');
    await me.post('/api/v1/boards', { projectId: board.project.id, name: 'Second' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.terminate();
    expect(seen).toEqual([
      { type: 'board.changed', boardId: board.board.id, cardId: c.id, origin: null },
      { type: 'projects.changed', origin: null },
    ]);
  });
});
