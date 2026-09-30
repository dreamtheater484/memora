import { uuidv7 } from '@memora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STRONG_PASSWORD, createTestApp, type Client, type TestApp } from '../test/harness';
import type { Access } from './plugin';

/*
 * The authorisation gate (§11): every API route is listed here with who may call it and, for
 * routes that act on one user's data, how another user's id must be refused. A route missing
 * from this table fails the build, so no endpoint ships without its access rules being tested.
 */

interface World {
  t: TestApp;
  /** Admin, created by first-run setup. */
  alice: Client;
  /** Regular user. */
  bob: Client;
  aliceSessionId: string;
  /** Alice's notes, which Bob must not reach; and a section of Bob's own to aim at. */
  notes: {
    notebookId: string;
    groupId: string;
    sectionId: string;
    pageId: string;
    deletedPageId: string;
    assetId: string;
    tagId: string;
    templateId: string;
    jobId: string;
    kanban: {
      projectId: string;
      boardId: string;
      columnId: string;
      laneId: string;
      cardId: string;
      labelId: string;
      checklistId: string;
      itemId: string;
      commentId: string;
    };
    /** Alice's projects, board and card before Bob's attempts. */
    kanbanState: unknown;
    bobSectionId: string;
    /** Alice's tree before Bob's attempts: it must stay exactly like this. */
    tree: unknown;
  };
}

/** Bob aims at one of Alice's notes; her tree must be unchanged afterwards. */
const probe =
  (url: (n: World['notes']) => string, body?: (n: World['notes']) => unknown) => (w: World) => ({
    url: url(w.notes),
    body: body?.(w.notes),
    async intact() {
      expect((await w.alice.get('/api/v1/tree')).json()).toEqual(w.notes.tree);
    },
  });

/** Alice's projects, board and card as they are. */
async function kanbanState(w: World) {
  const k = w.notes.kanban;
  return {
    projects: (await w.alice.get('/api/v1/projects')).json(),
    board: (await w.alice.get(`/api/v1/boards/${k.boardId}`)).json(),
    card: (await w.alice.get(`/api/v1/cards/${k.cardId}`)).json(),
  };
}

/** Bob aims at Alice's Kanban; her projects, board and card must be unchanged afterwards. */
const kprobe =
  (url: (k: World['notes']['kanban'], n: World['notes']) => string, body?: unknown) =>
  (w: World) => ({
    url: url(w.notes.kanban, w.notes),
    body,
    async intact() {
      expect(await kanbanState(w)).toEqual(w.notes.kanbanState);
    },
  });

interface RouteRule {
  access: Access;
  /**
   * Owner-scoped routes: Bob calls this with Alice's ids; it must answer 404 and leave her data
   * untouched (`intact` checks that).
   */
  foreign?: (w: World) => { url: string; body?: unknown; intact: () => Promise<void> };
  /** List routes: Bob's answer must not contain any of Alice's items. */
  ownListOnly?: (w: World) => Promise<void>;
}

const RULES: Record<string, RouteRule> = {
  'GET /api/health': { access: 'public' },
  'GET /api/v1/auth/me': { access: 'public' },
  'POST /api/v1/auth/setup': { access: 'public' },
  'POST /api/v1/auth/login': { access: 'public' },
  'POST /api/v1/auth/logout': { access: 'user' },
  'POST /api/v1/auth/password': { access: 'user' },
  'PATCH /api/v1/auth/me': { access: 'user' },
  'GET /api/v1/auth/sessions': {
    access: 'user',
    async ownListOnly(w) {
      const ids = (await w.bob.get('/api/v1/auth/sessions'))
        .json()
        .map((s: { id: string }) => s.id);
      expect(ids).not.toContain(w.aliceSessionId);
      expect(ids.length).toBeGreaterThan(0);
    },
  },
  'DELETE /api/v1/auth/sessions/:id': {
    access: 'user',
    foreign: (w) => ({
      url: `/api/v1/auth/sessions/${w.aliceSessionId}`,
      async intact() {
        expect((await w.alice.get('/api/v1/auth/me')).json().user?.username).toBe('alice');
      },
    }),
  },
  'GET /api/v1/admin/users': { access: 'admin' },
  'POST /api/v1/admin/users': { access: 'admin' },
  'PATCH /api/v1/admin/users/:id': { access: 'admin' },
  'POST /api/v1/admin/users/:id/reset-password': { access: 'admin' },
  'DELETE /api/v1/admin/users/:id': { access: 'admin' },
  'GET /api/v1/admin/audit': { access: 'admin' },
  'GET /api/v1/tree': {
    access: 'user',
    async ownListOnly(w) {
      const tree = (await w.bob.get('/api/v1/tree')).json();
      const ids = [...tree.notebooks, ...tree.groups, ...tree.sections, ...tree.pages].map(
        (x: { id: string }) => x.id,
      );
      const { notebookId, groupId, sectionId, pageId } = w.notes;
      for (const id of [notebookId, groupId, sectionId, pageId]) expect(ids).not.toContain(id);
      expect(tree.inboxId).toBe(w.notes.bobSectionId);
    },
  },
  'POST /api/v1/notebooks': { access: 'user' },
  'PATCH /api/v1/notebooks/:id': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/notebooks/${n.notebookId}`,
      () => ({ name: 'Mine now' }),
    ),
  },
  'POST /api/v1/notebooks/:id/move': {
    access: 'user',
    foreign: probe((n) => `/api/v1/notebooks/${n.notebookId}/move`),
  },
  'DELETE /api/v1/notebooks/:id': {
    access: 'user',
    foreign: probe((n) => `/api/v1/notebooks/${n.notebookId}`),
  },
  'POST /api/v1/groups': {
    access: 'user',
    foreign: probe(
      () => '/api/v1/groups',
      (n) => ({ notebookId: n.notebookId, name: 'Planted' }),
    ),
  },
  'PATCH /api/v1/groups/:id': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/groups/${n.groupId}`,
      () => ({ name: 'Mine now' }),
    ),
  },
  'POST /api/v1/groups/:id/move': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/groups/${n.groupId}/move`,
      (n) => ({ notebookId: n.notebookId }),
    ),
  },
  'DELETE /api/v1/groups/:id': {
    access: 'user',
    foreign: probe((n) => `/api/v1/groups/${n.groupId}`),
  },
  'POST /api/v1/sections': {
    access: 'user',
    foreign: probe(
      () => '/api/v1/sections',
      (n) => ({ notebookId: n.notebookId, name: 'Planted', color: 'blue' }),
    ),
  },
  'PATCH /api/v1/sections/:id': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/sections/${n.sectionId}`,
      () => ({ name: 'Mine now' }),
    ),
  },
  'POST /api/v1/sections/:id/move': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/sections/${n.sectionId}/move`,
      (n) => ({ notebookId: n.notebookId }),
    ),
  },
  'DELETE /api/v1/sections/:id': {
    access: 'user',
    foreign: probe((n) => `/api/v1/sections/${n.sectionId}`),
  },
  'POST /api/v1/pages': {
    access: 'user',
    foreign: probe(
      () => '/api/v1/pages',
      (n) => ({ sectionId: n.sectionId, title: 'Planted' }),
    ),
  },
  'GET /api/v1/pages/:id': {
    access: 'user',
    foreign: probe((n) => `/api/v1/pages/${n.pageId}`),
  },
  'PATCH /api/v1/pages/:id': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/pages/${n.pageId}`,
      () => ({ title: 'Mine now' }),
    ),
  },
  'PUT /api/v1/pages/:id/content': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/pages/${n.pageId}/content`,
      () => ({ baseRevision: 1, content: 'Mine now' }),
    ),
  },
  'POST /api/v1/pages/:id/convert': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/pages/${n.pageId}/convert`,
      () => ({ type: 'rich', content: '', baseRevision: 1 }),
    ),
  },
  'GET /api/v1/pages/:id/versions': {
    access: 'user',
    foreign: probe((n) => `/api/v1/pages/${n.pageId}/versions`),
  },
  'GET /api/v1/pages/:id/versions/:vid': {
    access: 'user',
    foreign: probe((n) => `/api/v1/pages/${n.pageId}/versions/${uuidv7()}`),
  },
  'PATCH /api/v1/pages/:id/versions/:vid': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/pages/${n.pageId}/versions/${uuidv7()}`,
      () => ({ name: 'Mine now' }),
    ),
  },
  'POST /api/v1/pages/:id/versions/:vid/restore': {
    access: 'user',
    foreign: probe((n) => `/api/v1/pages/${n.pageId}/versions/${uuidv7()}/restore`),
  },
  'POST /api/v1/pages/:id/versions/:vid/copy': {
    access: 'user',
    foreign: probe((n) => `/api/v1/pages/${n.pageId}/versions/${uuidv7()}/copy`),
  },
  'POST /api/v1/pages/:id/versions': {
    access: 'user',
    foreign: (w) => ({
      ...probe(
        (n) => `/api/v1/pages/${n.pageId}/versions`,
        () => ({ reason: 'conflict', content: 'Planted', baseRevision: 1 }),
      )(w),
      async intact() {
        const count = w.t.db.prepare('SELECT count(*) AS n FROM page_versions').get() as {
          n: number;
        };
        expect(count.n).toBe(0);
      },
    }),
  },
  'POST /api/v1/pages/move': {
    access: 'user',
    // Alice's page into Bob's own section.
    foreign: probe(
      () => '/api/v1/pages/move',
      (n) => ({ ids: [n.pageId], sectionId: n.bobSectionId }),
    ),
  },
  'POST /api/v1/pages/copy': {
    access: 'user',
    foreign: probe(
      () => '/api/v1/pages/copy',
      (n) => ({ ids: [n.pageId], sectionId: n.bobSectionId }),
    ),
  },
  'POST /api/v1/pages/:id/duplicate': {
    access: 'user',
    foreign: probe((n) => `/api/v1/pages/${n.pageId}/duplicate`),
  },
  'POST /api/v1/pages/delete': {
    access: 'user',
    foreign: probe(
      () => '/api/v1/pages/delete',
      (n) => ({ ids: [n.pageId] }),
    ),
  },
  'POST /api/v1/trash/restore': {
    access: 'user',
    foreign: probe(
      () => '/api/v1/trash/restore',
      (n) => ({ items: [{ type: 'page', id: n.deletedPageId }] }),
    ),
  },
  'GET /api/v1/trash': {
    access: 'user',
    async ownListOnly(w) {
      expect((await w.bob.get('/api/v1/trash')).json().entries).toEqual([]);
    },
  },
  'POST /api/v1/trash/restore-to': {
    access: 'user',
    foreign: probe(
      () => '/api/v1/trash/restore-to',
      (n) => ({ item: { type: 'page', id: n.deletedPageId }, to: { sectionId: n.bobSectionId } }),
    ),
  },
  'POST /api/v1/trash/delete': {
    access: 'user',
    foreign: probe(
      () => '/api/v1/trash/delete',
      (n) => ({ items: [{ type: 'page', id: n.deletedPageId }] }),
    ),
  },
  // Bob's own bin only: Alice's deleted page is still there afterwards (checked below).
  'POST /api/v1/trash/empty': {
    access: 'user',
    async ownListOnly(w) {
      await w.bob.post('/api/v1/trash/empty');
      const entries = (await w.alice.get('/api/v1/trash')).json().entries as { id: string }[];
      expect(entries.map((e) => e.id)).toContain(w.notes.deletedPageId);
    },
  },
  'GET /api/v1/settings': {
    access: 'user',
    async ownListOnly(w) {
      expect((await w.bob.get('/api/v1/settings')).json()).toEqual({ ui: {}, editor: {} });
    },
  },
  'PATCH /api/v1/settings': { access: 'user' },
  // assets.test.ts checks that an id taken by another user is refused and left unchanged.
  'PUT /api/v1/assets/:id': { access: 'user' },
  // Makes a new file of the caller's own; the address is checked by assets-fetch.test.ts.
  'POST /api/v1/assets/fetch': { access: 'user' },
  'GET /api/v1/assets/:id': {
    access: 'user',
    foreign: probe((n) => `/api/v1/assets/${n.assetId}`),
  },
  'GET /api/v1/admin/backups': { access: 'admin' },
  'POST /api/v1/admin/backups': { access: 'admin' },
  'GET /api/v1/admin/backups/:name': { access: 'admin' },
  'DELETE /api/v1/admin/backups/:name': { access: 'admin' },
  'POST /api/v1/admin/backups/:name/restore': { access: 'admin' },
  'GET /api/v1/search': {
    access: 'user',
    async ownListOnly(w) {
      const found = (await w.bob.get('/api/v1/search?q=Diary')).json();
      expect(found).toEqual({ hits: [], total: 0 });
      expect((await w.bob.get('/api/v1/search?q=tag:secret')).json().hits).toEqual([]);
    },
  },
  'GET /api/v1/pages/:id/backlinks': {
    access: 'user',
    foreign: probe((n) => `/api/v1/pages/${n.pageId}/backlinks`),
  },
  'PUT /api/v1/pages/:id/tags': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/pages/${n.pageId}/tags`,
      () => ({ names: ['planted'] }),
    ),
  },
  'PATCH /api/v1/tags/:id': {
    access: 'user',
    foreign: probe(
      (n) => `/api/v1/tags/${n.tagId}`,
      () => ({ name: 'Mine now' }),
    ),
  },
  'DELETE /api/v1/tags/:id': {
    access: 'user',
    foreign: probe((n) => `/api/v1/tags/${n.tagId}`),
  },
  'GET /api/v1/templates': {
    access: 'user',
    async ownListOnly(w) {
      const list = (await w.bob.get('/api/v1/templates')).json() as { id: string }[];
      expect(list.map((t) => t.id)).not.toContain(w.notes.templateId);
    },
  },
  'POST /api/v1/templates': { access: 'user' },
  'PATCH /api/v1/templates/:id': {
    access: 'user',
    foreign: (w) => ({
      url: `/api/v1/templates/${w.notes.templateId}`,
      body: { name: 'Mine now' },
      async intact() {
        const list = (await w.alice.get('/api/v1/templates')).json() as {
          id: string;
          name: string;
        }[];
        expect(list.find((t) => t.id === w.notes.templateId)?.name).toBe('Private');
      },
    }),
  },
  'DELETE /api/v1/templates/:id': {
    access: 'user',
    foreign: (w) => ({
      url: `/api/v1/templates/${w.notes.templateId}`,
      async intact() {
        const list = (await w.alice.get('/api/v1/templates')).json() as { id: string }[];
        expect(list.map((t) => t.id)).toContain(w.notes.templateId);
      },
    }),
  },
  'GET /api/v1/exports/options': { access: 'user' },
  'POST /api/v1/exports': {
    access: 'user',
    foreign: probe(
      () => '/api/v1/exports',
      (n) => ({ format: 'memora', scope: 'notebook', id: n.notebookId }),
    ),
  },
  'POST /api/v1/exports/pdf': { access: 'user' },
  'POST /api/v1/imports': {
    access: 'user',
    foreign: probe((n) => `/api/v1/imports?name=notes.zip&notebookId=${n.notebookId}`),
  },
  'GET /api/v1/jobs': {
    access: 'user',
    async ownListOnly(w) {
      const list = (await w.bob.get('/api/v1/jobs')).json() as { id: string }[];
      expect(list.map((j) => j.id)).not.toContain(w.notes.jobId);
    },
  },
  'GET /api/v1/jobs/:id': {
    access: 'user',
    foreign: probe((n) => `/api/v1/jobs/${n.jobId}`),
  },
  'GET /api/v1/jobs/:id/download': {
    access: 'user',
    foreign: probe((n) => `/api/v1/jobs/${n.jobId}/download`),
  },
  'GET /api/v1/projects': {
    access: 'user',
    async ownListOnly(w) {
      const list = (await w.bob.get('/api/v1/projects')).json();
      expect(list.projects).toEqual([]);
      expect(list.boards).toEqual([]);
    },
  },
  'POST /api/v1/projects': { access: 'user' },
  'PATCH /api/v1/projects/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/projects/${k.projectId}`, { name: 'Mine now' }),
  },
  'DELETE /api/v1/projects/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/projects/${k.projectId}`),
  },
  'POST /api/v1/projects/:id/labels': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/projects/${k.projectId}/labels`, { name: 'x', color: 'blue' }),
  },
  'PATCH /api/v1/labels/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/labels/${k.labelId}`, { name: 'Mine now' }),
  },
  'DELETE /api/v1/labels/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/labels/${k.labelId}`),
  },
  'POST /api/v1/boards': {
    access: 'user',
    foreign: (w) =>
      kprobe(() => '/api/v1/boards', { projectId: w.notes.kanban.projectId, name: 'x' })(w),
  },
  'GET /api/v1/boards/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/boards/${k.boardId}`),
  },
  'PATCH /api/v1/boards/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/boards/${k.boardId}`, { name: 'Mine now' }),
  },
  'DELETE /api/v1/boards/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/boards/${k.boardId}`),
  },
  'POST /api/v1/boards/:id/columns': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/boards/${k.boardId}/columns`, { name: 'x' }),
  },
  'PATCH /api/v1/columns/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/columns/${k.columnId}`, { name: 'Mine now' }),
  },
  'DELETE /api/v1/columns/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/columns/${k.columnId}`),
  },
  'POST /api/v1/boards/:id/lanes': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/boards/${k.boardId}/lanes`, { name: 'x' }),
  },
  'PATCH /api/v1/lanes/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/lanes/${k.laneId}`, { name: 'Mine now' }),
  },
  'DELETE /api/v1/lanes/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/lanes/${k.laneId}`),
  },
  'POST /api/v1/cards': {
    access: 'user',
    foreign: (w) =>
      kprobe(() => '/api/v1/cards', { columnId: w.notes.kanban.columnId, title: 'x' })(w),
  },
  'GET /api/v1/cards/by-key/:key': {
    access: 'user',
    foreign: kprobe(() => '/api/v1/cards/by-key/SEC-1'),
  },
  'GET /api/v1/cards/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/cards/${k.cardId}`),
  },
  'PATCH /api/v1/cards/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/cards/${k.cardId}`, { title: 'Mine now' }),
  },
  'POST /api/v1/cards/:id/move': {
    access: 'user',
    foreign: (w) =>
      kprobe((k) => `/api/v1/cards/${k.cardId}/move`, { columnId: w.notes.kanban.columnId })(w),
  },
  'POST /api/v1/cards/:id/duplicate': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/cards/${k.cardId}/duplicate`),
  },
  'DELETE /api/v1/cards/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/cards/${k.cardId}`),
  },
  'POST /api/v1/cards/:id/checklists': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/cards/${k.cardId}/checklists`, { title: 'x' }),
  },
  'PATCH /api/v1/checklists/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/checklists/${k.checklistId}`, { title: 'Mine now' }),
  },
  'DELETE /api/v1/checklists/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/checklists/${k.checklistId}`),
  },
  'POST /api/v1/checklists/:id/items': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/checklists/${k.checklistId}/items`, { text: 'x' }),
  },
  'PATCH /api/v1/checklist-items/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/checklist-items/${k.itemId}`, { done: true }),
  },
  'DELETE /api/v1/checklist-items/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/checklist-items/${k.itemId}`),
  },
  'POST /api/v1/cards/:id/comments': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/cards/${k.cardId}/comments`, { body: 'x' }),
  },
  'PATCH /api/v1/comments/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/comments/${k.commentId}`, { body: 'Mine now' }),
  },
  'DELETE /api/v1/comments/:id': {
    access: 'user',
    foreign: kprobe((k) => `/api/v1/comments/${k.commentId}`),
  },
  'PUT /api/v1/cards/:id/pages/:other': {
    access: 'user',
    foreign: kprobe((k, n) => `/api/v1/cards/${k.cardId}/pages/${n.pageId}`),
  },
  'DELETE /api/v1/cards/:id/pages/:other': {
    access: 'user',
    foreign: kprobe((k, n) => `/api/v1/cards/${k.cardId}/pages/${n.pageId}`),
  },
  'GET /api/v1/pages/:id/cards': {
    access: 'user',
    foreign: probe((n) => `/api/v1/pages/${n.pageId}/cards`),
  },
  'POST /api/v1/cards/:id/attachments': {
    access: 'user',
    foreign: (w) =>
      kprobe((k) => `/api/v1/cards/${k.cardId}/attachments`, { assetId: w.notes.assetId })(w),
  },
  'DELETE /api/v1/cards/:id/attachments/:other': {
    access: 'user',
    foreign: kprobe((k, n) => `/api/v1/cards/${k.cardId}/attachments/${n.assetId}`),
  },
  // Scoped by the session itself: events.test.ts checks a user only hears their own events.
  'GET /api/v1/events': { access: 'user' },
};

let w: World;

beforeAll(async () => {
  const t = await createTestApp();
  const alice = await t.setupAdmin('alice');
  const created = await alice.post('/api/v1/admin/users', { username: 'bob', displayName: 'Bob' });
  const bob = t.client();
  await bob.login('bob', created.json().temporaryPassword);
  await bob.post('/api/v1/auth/password', {
    currentPassword: created.json().temporaryPassword,
    newPassword: STRONG_PASSWORD,
  });
  const sessions = (await alice.get('/api/v1/auth/sessions')).json();

  const nb = (await alice.post('/api/v1/notebooks', { name: 'Private', color: 'blue' })).json();
  const notebookId = nb.notebooks[0].id;
  const sectionId = nb.sections[0].id;
  const group = (await alice.post('/api/v1/groups', { notebookId, name: 'Group' })).json();
  const page = (await alice.post('/api/v1/pages', { sectionId, title: 'Diary' })).json();
  const gone = (await alice.post('/api/v1/pages', { sectionId, title: 'Gone' })).json();
  await alice.post('/api/v1/pages/delete', { ids: [gone.pages[0].id] });
  await alice.patch('/api/v1/settings', { ui: { pageListSide: 'left' } });
  const tagged = (
    await alice.put(`/api/v1/pages/${page.pages[0].id}/tags`, { names: ['secret'] })
  ).json();
  const template = (
    await alice.post('/api/v1/templates', { name: 'Private', type: 'markdown', content: 'Mine' })
  ).json();
  const job = (
    await alice.post('/api/v1/exports', { format: 'memora', scope: 'notebook', id: notebookId })
  ).json();
  const assetId = uuidv7();
  await alice.put(`/api/v1/assets/${assetId}?name=note.txt`, Buffer.from('private'), {
    headers: { 'content-type': 'text/plain' },
  });
  const made = (
    await alice.post('/api/v1/projects', { name: 'Secret', key: 'SEC', color: 'blue' })
  ).json();
  const boardId = made.board.id;
  const board = (await alice.get(`/api/v1/boards/${boardId}`)).json();
  const columnId = board.columns[0].id;
  const laneId = (await alice.post(`/api/v1/boards/${boardId}/lanes`, { name: 'Lane' })).json().id;
  const labelId = (
    await alice.post(`/api/v1/projects/${made.project.id}/labels`, { name: 'Hush', color: 'coral' })
  ).json().id;
  const cardId = (await alice.post('/api/v1/cards', { columnId, title: 'Plan' })).json().id;
  await alice.patch(`/api/v1/cards/${cardId}`, { labelIds: [labelId] });
  const withList = (
    await alice.post(`/api/v1/cards/${cardId}/checklists`, { title: 'Steps' })
  ).json();
  const checklistId = withList.checklists[0].id;
  const withItem = (
    await alice.post(`/api/v1/checklists/${checklistId}/items`, { text: 'One' })
  ).json();
  const withComment = (await alice.post(`/api/v1/cards/${cardId}/comments`, { body: 'Hi' })).json();
  await alice.put(`/api/v1/cards/${cardId}/pages/${page.pages[0].id}`);
  w = {
    t,
    alice,
    bob,
    aliceSessionId: sessions[0].id,
    notes: {
      notebookId,
      groupId: group.groups[0].id,
      sectionId,
      pageId: page.pages[0].id,
      deletedPageId: gone.pages[0].id,
      assetId,
      tagId: tagged.tags[0].id,
      templateId: template.id,
      jobId: job.id,
      kanban: {
        projectId: made.project.id,
        boardId,
        columnId,
        laneId,
        cardId,
        labelId,
        checklistId,
        itemId: withItem.checklists[0].items[0].id,
        commentId: withComment.comments[0].id,
      },
      kanbanState: null,
      bobSectionId: (await bob.get('/api/v1/tree')).json().inboxId,
      tree: (await alice.get('/api/v1/tree')).json(),
    },
  };
  w.notes.kanbanState = await kanbanState(w);
});

afterAll(async () => {
  await w.t.close();
});

const key = (method: string, url: string) => `${method} ${url}`;
const withIds = (url: string) => url.replace(/:[a-zA-Z]+/g, () => uuidv7());

describe('authorisation gate', () => {
  it('has a rule for every API route, matching its declared access', () => {
    const registered = Object.fromEntries(
      w.t.app.apiRoutes.map((r) => [key(r.method, r.url), r.access]),
    );
    const missing = Object.keys(registered).filter((k) => !(k in RULES));
    expect(missing, 'add these routes to RULES in access.test.ts').toEqual([]);
    const stale = Object.keys(RULES).filter((k) => !(k in registered));
    expect(stale, 'these RULES no longer match a route').toEqual([]);
    for (const [k, rule] of Object.entries(RULES)) {
      expect(registered[k], k).toBe(rule.access);
    }
  });

  const routes = Object.entries(RULES).map(([k, rule]) => {
    const [method = '', url = ''] = k.split(' ');
    return { method: method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url, rule };
  });

  it.each(routes.filter((r) => r.rule.access !== 'public'))(
    'asks anonymous callers to log in: $method $url',
    async ({ method, url }) => {
      const res = await w.t.client().request(method, withIds(url), {});
      expect(res.statusCode).toBe(401);
    },
  );

  it.each(routes.filter((r) => r.rule.access === 'admin'))(
    'refuses regular users: $method $url',
    async ({ method, url }) => {
      const res = await w.bob.request(method, withIds(url), {});
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('forbidden');
    },
  );

  it.each(routes.filter((r) => r.rule.foreign))(
    'refuses another user’s ids: $method $url',
    async ({ method, rule }) => {
      const probe = rule.foreign!(w);
      const res = await w.bob.request(method, probe.url, probe.body ?? {});
      expect(res.statusCode).toBe(404);
      await probe.intact();
    },
  );

  it.each(routes.filter((r) => r.rule.ownListOnly))(
    'lists only the caller’s own items: $method $url',
    async ({ rule }) => {
      await rule.ownListOnly!(w);
    },
  );
});
