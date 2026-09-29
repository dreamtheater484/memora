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
}

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
  w = { t, alice, bob, aliceSessionId: sessions[0].id };
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
    return { method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE', url, rule };
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
