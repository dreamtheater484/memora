import AxeBuilder from '@axe-core/playwright';
import type {
  AdminUser,
  AuditEntry,
  CurrentUser,
  MeResponse,
  SessionInfo,
  SessionResponse,
} from '@memora/shared';
import { expect, type Page, type Route } from '@playwright/test';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Fixed "now" for screens that show times, so screenshots don't drift. */
export const NOW = Date.parse('2026-09-29T14:30:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ADMIN: CurrentUser = {
  id: 'u-alex',
  username: 'alex',
  displayName: 'Alex Morgan',
  role: 'admin',
  mustChangePassword: false,
};

export const MEMBER: CurrentUser = {
  id: 'u-sam',
  username: 'sam',
  displayName: 'Sam Lake',
  role: 'user',
  mustChangePassword: false,
};

/** What the fake server accepts. */
export const PASSWORD = 'violet-harbour-lantern';
export const SETUP_CODE = 'QYN0-6352-XMM2';
export const TEMPORARY_PASSWORD = 'k7wq-3mzp-x9rd-v2hn';

const adminView = (user: CurrentUser, extra: Partial<AdminUser> = {}): AdminUser => ({
  ...user,
  disabled: false,
  createdAt: NOW - 30 * DAY,
  lastSeenAt: NOW - HOUR,
  sessionCount: 1,
  ...extra,
});

// Documentation addresses (RFC 5737), never real ones.
const SESSIONS: SessionInfo[] = [
  {
    id: 's1',
    deviceLabel: 'Chrome on Linux',
    ip: '198.51.100.7',
    remember: true,
    createdAt: NOW - 3 * DAY,
    lastSeenAt: NOW,
    current: true,
  },
  {
    id: 's2',
    deviceLabel: 'Safari on iPhone',
    ip: '203.0.113.24',
    remember: true,
    createdAt: NOW - 12 * DAY,
    lastSeenAt: NOW - 2 * HOUR,
    current: false,
  },
  {
    id: 's3',
    deviceLabel: 'Firefox on Windows',
    ip: '192.0.2.51',
    remember: false,
    createdAt: NOW - 40 * DAY,
    lastSeenAt: NOW - 5 * DAY,
    current: false,
  },
];

const USERS: AdminUser[] = [
  adminView(ADMIN, { lastSeenAt: NOW, sessionCount: 3 }),
  adminView(MEMBER),
  adminView(
    {
      id: 'u-priya',
      username: 'priya',
      displayName: 'Priya Nair',
      role: 'user',
      mustChangePassword: true,
    },
    { lastSeenAt: null, sessionCount: 0, createdAt: NOW - 20 * MINUTE },
  ),
  adminView(
    {
      id: 'u-jamie',
      username: 'jamie',
      displayName: 'Jamie Chen',
      role: 'user',
      mustChangePassword: false,
    },
    { disabled: true, lastSeenAt: NOW - 9 * DAY, sessionCount: 0 },
  ),
];

const entry = (
  id: number,
  event: AuditEntry['event'],
  username: string | null,
  ago: number,
  meta: Record<string, unknown> = {},
): AuditEntry => ({
  id: String(id),
  event,
  username,
  meta,
  ip: '198.51.100.7',
  createdAt: NOW - ago,
});

const AUDIT: AuditEntry[] = [
  entry(8, 'login', 'alex', 5 * MINUTE, { device: 'Chrome on Linux' }),
  entry(7, 'user_created', 'alex', 20 * MINUTE, { target: 'priya' }),
  entry(6, 'login_failed', 'jamie', 3 * HOUR, { reason: 'disabled' }),
  entry(5, 'user_disabled', 'alex', DAY, { target: 'jamie' }),
  entry(4, 'login_failed', 'root', DAY + HOUR, { reason: 'unknown_user' }),
  entry(3, 'password_changed', 'sam', 6 * DAY),
  entry(2, 'user_created', 'alex', 7 * DAY, { target: 'sam' }),
  entry(1, 'setup_completed', 'alex', 30 * DAY),
];

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

const error = (status: number, code: string, message: string, fields?: Record<string, string>) => ({
  status,
  json: { error: { code, message, ...(fields ? { details: { fields } } : {}) } },
});

/**
 * A small in-memory stand-in for the server: enough of the API for the auth and
 * settings screens, with state, so flows like "log in, then see the page" work.
 */
export class FakeApi {
  me: MeResponse;
  users = structuredClone(USERS);
  sessions = structuredClone(SESSIONS);
  audit = structuredClone(AUDIT);
  readonly requests: RecordedRequest[] = [];
  /** Who logging in with PASSWORD becomes. */
  loginAs: CurrentUser = ADMIN;

  constructor(me: Partial<MeResponse> = { user: ADMIN }) {
    const user = me.user ?? null;
    this.me = { setupRequired: false, user, csrfToken: user ? 'csrf-1' : null, ...me };
  }

  async install(page: Page) {
    await page.route('**/api/**', (route) => this.handle(route));
  }

  private signIn(user: CurrentUser): SessionResponse {
    this.me = { setupRequired: false, user, csrfToken: 'csrf-2' };
    return { user, csrfToken: 'csrf-2' };
  }

  private respond(method: string, path: string, body: Record<string, unknown>) {
    const route = `${method} ${path}`;
    switch (route) {
      case 'GET /api/health':
        return { json: { status: 'ok', version: '0.1.0' } };
      case 'GET /api/v1/auth/me':
        return { json: this.me };
      case 'POST /api/v1/auth/setup':
        if (body.setupCode !== SETUP_CODE) {
          return error(403, 'invalid_setup_code', 'That code is not right.', {
            setupCode: 'That code is not right.',
          });
        }
        return {
          json: this.signIn({
            ...ADMIN,
            username: String(body.username),
            displayName: String(body.displayName),
          }),
        };
      case 'POST /api/v1/auth/login':
        if (body.password !== PASSWORD) {
          return error(401, 'invalid_credentials', 'Wrong username or password.');
        }
        return { json: this.signIn(this.loginAs) };
      case 'POST /api/v1/auth/logout':
        this.me = { setupRequired: false, user: null, csrfToken: null };
        return { status: 204 };
      case 'POST /api/v1/auth/password':
        if (!this.me.user) return error(401, 'unauthenticated', 'Log in first.');
        return { json: this.signIn({ ...this.me.user, mustChangePassword: false }) };
      case 'GET /api/v1/auth/sessions':
        return { json: this.sessions };
      case 'GET /api/v1/admin/users':
        return { json: this.users };
      case 'POST /api/v1/admin/users': {
        const user = adminView(
          {
            id: `u-${String(body.username)}`,
            username: String(body.username),
            displayName: String(body.displayName),
            role: body.role === 'admin' ? 'admin' : 'user',
            mustChangePassword: true,
          },
          { createdAt: NOW, lastSeenAt: null, sessionCount: 0 },
        );
        this.users.push(user);
        return { status: 201, json: { user, temporaryPassword: TEMPORARY_PASSWORD } };
      }
      case 'GET /api/v1/admin/audit':
        return { json: { entries: this.audit, nextCursor: null } };
      default:
        return error(404, 'not_found', `No fake for ${route}.`);
    }
  }

  private async handle(route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    this.requests.push({ method: request.method(), path, headers: request.headers(), body });
    const { status = 200, json } = this.respond(request.method(), path, body);
    await (json === undefined ? route.fulfill({ status }) : route.fulfill({ status, json }));
  }
}

/** Waits until the self-hosted fonts are in, so text is measured and drawn final. */
export async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Answers the API with a fake server (signed in as the admin unless told otherwise). */
export async function mockApi(page: Page, api = new FakeApi()) {
  await api.install(page);
  return api;
}

/** Stores the theme like the real preference. */
export async function setTheme(page: Page, theme: Theme) {
  await page.addInitScript((t) => {
    localStorage.setItem('memora.appearance', JSON.stringify({ theme: t, glass: 'auto' }));
  }, theme);
}

/** Opens the shell with a fixed theme. */
export async function openShell(page: Page, theme: Theme) {
  await mockApi(page);
  await setTheme(page, theme);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Saved', { exact: true })).toBeAttached();
  await fontsReady(page);
}

/** Fails with a readable list when axe finds WCAG A/AA problems. */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
  );
  expect(summary, summary.join('\n\n')).toEqual([]);
}
