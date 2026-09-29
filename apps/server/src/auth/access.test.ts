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
  'GET /api/v1/settings': {
    access: 'user',
    async ownListOnly(w) {
      expect((await w.bob.get('/api/v1/settings')).json()).toEqual({ ui: {} });
    },
  },
  'PATCH /api/v1/settings': { access: 'user' },
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
      bobSectionId: (await bob.get('/api/v1/tree')).json().inboxId,
      tree: (await alice.get('/api/v1/tree')).json(),
    },
  };
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
