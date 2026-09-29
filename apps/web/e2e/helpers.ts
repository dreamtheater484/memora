import AxeBuilder from '@axe-core/playwright';
import type {
  AdminUser,
  AuditEntry,
  BackupInfo,
  CurrentUser,
  MeResponse,
  ServerEvent,
  SessionInfo,
  SessionResponse,
} from '@memora/shared';
import { expect, type Page, type Route, type WebSocketRoute } from '@playwright/test';
import { FakeNotes } from './notes';

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
export const TEMPORARY_PASSWORD = 'k7wq-3mzp-x9rd-v2hn'; // gitleaks:allow (fake)

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

const backup = (kind: BackupInfo['kind'], ago: number, encrypted = false): BackupInfo => {
  const at = NOW - ago;
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
  return {
    name: `memora-${kind}-${stamp}.db${encrypted ? '.enc' : ''}`,
    kind,
    size: 3_400_000 + Math.round(ago / 1000),
    createdAt: at,
    encrypted,
  };
};

const BACKUPS: BackupInfo[] = [
  backup('scheduled', 11 * HOUR + 30 * MINUTE),
  backup('manual', DAY + 2 * HOUR),
  backup('scheduled', DAY + 11 * HOUR + 30 * MINUTE),
  backup('pre-migration', 4 * DAY),
  backup('scheduled', 8 * DAY + 11 * HOUR + 30 * MINUTE),
];

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A browser connected to the fake event channel. */
interface Channel {
  ws: WebSocketRoute;
  device: string | null;
  label: string;
  pages: string[];
}

const error = (status: number, code: string, message: string, fields?: Record<string, string>) => ({
  status,
  json: { error: { code, message, ...(fields ? { details: { fields } } : {}) } },
});

/**
 * A small in-memory stand-in for the server: enough of the API for the auth, settings and
 * notes screens, with state, so flows like "log in, then see the page" work.
 */
export class FakeApi {
  me: MeResponse;
  users = structuredClone(USERS);
  sessions = structuredClone(SESSIONS);
  audit = structuredClone(AUDIT);
  backups = structuredClone(BACKUPS);
  /** The id of the server's data; a restore changes it. */
  dataId = 'data-1';
  readonly requests: RecordedRequest[] = [];
  /** Who logging in with PASSWORD becomes. */
  loginAs: CurrentUser = ADMIN;
  /** Notebooks, sections and pages; replace before `install` for other content. */
  notes = new FakeNotes(NOW);

  // Network control, for the resilience tests.
  /** Nothing answers: requests fail as if the server were gone, live channels close. */
  down = false;
  /** Every answer takes this long (a slow network). */
  latency = 0;
  /** Answers every request with this error, as a proxy does while the server restarts. */
  errorStatus: number | null = null;
  /** Content saves are taken, but their answers are lost (the server died right after). */
  loseAnswers = false;
  private held: Promise<void> | null = null;
  private readonly channels = new Set<Channel>();

  constructor(me: Partial<MeResponse> = { user: ADMIN }) {
    const user = me.user ?? null;
    this.me = { setupRequired: false, user, csrfToken: user ? 'csrf-1' : null, ...me };
  }

  async install(page: Page, label = 'Chrome on Linux') {
    this.notes.onChange = (changed, origin) =>
      this.publish({ type: 'page.updated', page: changed, revision: changed.revision, origin });
    await page.route('**/api/**', (route) => this.handle(route));
    await page.routeWebSocket(/\/api\/v1\/events/, (ws) => this.connect(ws, label));
  }

  /** Content saves wait (in flight) until the returned function is called. */
  holdSaves(): () => void {
    let release!: () => void;
    this.held = new Promise((resolve) => (release = resolve));
    return () => {
      this.held = null;
      release();
    };
  }

  /** The server stops answering until `comeBack`. */
  goDown() {
    this.down = true;
    for (const channel of this.channels) void channel.ws.close({ code: 1001 });
  }

  comeBack() {
    this.down = false;
  }

  /** Tells every browser the server's data changed (a backup was restored). */
  restored(dataId: string) {
    this.dataId = dataId;
    for (const channel of this.channels) {
      channel.ws.send(JSON.stringify({ type: 'hello', dataId }));
    }
  }

  /** The content saves sent, whether or not the server was there to take them. */
  saves() {
    return this.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('/content'));
  }

  private connect(ws: WebSocketRoute, label: string) {
    if (this.down) {
      void ws.close({ code: 1001 });
      return;
    }
    const channel: Channel = {
      ws,
      device: new URL(ws.url()).searchParams.get('device'),
      label,
      pages: [],
    };
    this.channels.add(channel);
    ws.send(JSON.stringify({ type: 'hello', dataId: this.dataId }));
    ws.onMessage((message) => {
      const data = JSON.parse(String(message)) as { type: string; pages?: string[] };
      if (data.type === 'presence') {
        channel.pages = data.pages ?? [];
        this.sendPresence();
      }
    });
    ws.onClose(() => {
      this.channels.delete(channel);
      this.sendPresence();
    });
    this.sendPresence();
  }

  /** Like the server's hub: to every browser but the one the change came from. */
  private publish(event: ServerEvent) {
    const origin = 'origin' in event ? event.origin : null;
    for (const channel of this.channels) {
      if (origin === null || channel.device !== origin) channel.ws.send(JSON.stringify(event));
    }
  }

  private sendPresence() {
    for (const channel of this.channels) {
      const devices = [...this.channels]
        .filter((other) => other.device !== channel.device && other.pages.length > 0)
        .map((other) => ({ label: other.label, pages: other.pages }));
      channel.ws.send(JSON.stringify({ type: 'presence', devices }));
    }
  }

  private signIn(user: CurrentUser): SessionResponse {
    this.me = { setupRequired: false, user, csrfToken: 'csrf-2' };
    return { user, csrfToken: 'csrf-2' };
  }

  private respond(
    method: string,
    path: string,
    body: Record<string, unknown>,
    origin: string | null,
  ) {
    const route = `${method} ${path}`;
    switch (route) {
      case 'GET /api/health':
        return { json: { status: 'ok', version: '0.1.0' } };
      case 'GET /api/v1/auth/me':
        return { json: this.me.user ? { ...this.me, dataId: this.dataId } : this.me };
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
      case 'GET /api/v1/admin/backups':
        return {
          json: {
            backups: this.backups,
            schedule: '0 3 * * *',
            nextRunAt: NOW + 12 * HOUR + 30 * MINUTE,
            last: { at: this.backups[0]?.createdAt ?? NOW, ok: true },
            encrypting: false,
            keep: { daily: 7, weekly: 4, monthly: 12 },
          },
        };
      case 'POST /api/v1/admin/backups': {
        const made = backup('manual', 0);
        this.backups.unshift(made);
        return { status: 201, json: made };
      }
      default: {
        const named = path.match(/^\/api\/v1\/admin\/backups\/([^/]+?)(\/restore)?$/);
        if (named) {
          const name = decodeURIComponent(named[1]!);
          const found = this.backups.find((b) => b.name === name);
          if (!found) return error(404, 'not_found', 'No such backup.');
          if (method === 'DELETE' && !named[2]) {
            this.backups = this.backups.filter((b) => b !== found);
            return { status: 204 };
          }
          if (method === 'POST' && named[2]) {
            const safety = backup('pre-restore', 0);
            this.backups.unshift(safety);
            return { json: { restarting: true, safetyBackup: safety.name } };
          }
        }
        return (
          this.notes.respond(method, path, body, origin) ??
          error(404, 'not_found', `No fake for ${route}.`)
        );
      }
    }
  }

  /** Files pasted into pages, by id. */
  readonly files = new Map<string, { data: Buffer; type: string; name: string }>();
  /** Images on "the web" that `POST /assets/fetch` can download; others fail. */
  readonly web = new Map<string, Buffer>();
  private fetched = 0;

  private async handle(route: Route) {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    const headers = request.headers();
    if (path.startsWith('/api/v1/assets/')) return this.file(route, path.split('/').pop()!, url);
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    this.requests.push({ method, path, headers, body });
    const save = method === 'PUT' && path.endsWith('/content');
    if (this.latency) await new Promise((resolve) => setTimeout(resolve, this.latency));
    if (save && this.held) await this.held;
    // The page may have closed meanwhile: nobody waits for the answer then.
    if (this.down) return route.abort('connectionrefused').catch(() => undefined);
    if (this.errorStatus) {
      const failed = error(this.errorStatus, 'unavailable', 'The server is restarting.');
      return route.fulfill({ status: failed.status, json: failed.json }).catch(() => undefined);
    }
    const origin = headers['x-memora-device'] ?? null;
    const { status = 200, json } = this.respond(method, path, body, origin);
    if (save && this.loseAnswers) return route.abort('connectionreset').catch(() => undefined);
    await (json === undefined ? route.fulfill({ status }) : route.fulfill({ status, json })).catch(
      () => undefined,
    );
  }

  /** `PUT /assets/:id` keeps the file; `GET` gives it back; `POST /assets/fetch` downloads one. */
  private async file(route: Route, id: string, url: URL) {
    const request = route.request();
    const body =
      id === 'fetch' ? ((request.postDataJSON() as Record<string, unknown> | null) ?? {}) : {};
    this.requests.push({
      method: request.method(),
      path: url.pathname,
      headers: request.headers(),
      body,
    });
    if (this.down) return route.abort('connectionrefused').catch(() => undefined);
    if (id === 'fetch' && request.method() === 'POST') {
      const data = this.web.get(String(body.url));
      if (!data) {
        return route
          .fulfill({
            status: 422,
            json: {
              error: {
                code: 'fetch_failed',
                message: 'The website answered 404.',
                details: { reason: 'status' },
              },
            },
          })
          .catch(() => undefined);
      }
      const newId = `0190e5a4-7c1d-7b3e-8a2f-${String(++this.fetched).padStart(12, '0')}`;
      this.files.set(newId, { data, type: 'image/png', name: 'image.png' });
      const meta = { id: newId, mime: 'image/png', size: data.length, width: 1, height: 1 };
      return route
        .fulfill({ status: 201, json: { ...meta, name: 'image.png', createdAt: NOW } })
        .catch(() => undefined);
    }
    if (request.method() === 'PUT') {
      const data = request.postDataBuffer() ?? Buffer.alloc(0);
      const type = request.headers()['content-type'] ?? 'application/octet-stream';
      const name = url.searchParams.get('name') ?? 'file';
      this.files.set(id, { data, type, name });
      const meta = {
        id,
        mime: type,
        size: data.length,
        width: null,
        height: null,
        name,
        createdAt: NOW,
      };
      return route.fulfill({ status: 201, json: meta }).catch(() => undefined);
    }
    const file = this.files.get(id);
    if (!file)
      return route.fulfill({
        status: 404,
        json: { error: { code: 'not_found', message: 'File not found.' } },
      });
    return route
      .fulfill({ status: 200, body: file.data, contentType: file.type })
      .catch(() => undefined);
  }
}

/** A tiny PNG, as a website would serve it. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

/** Opens the shell with a fixed theme (and the seeded notes, unless `api` has others). */
export async function openShell(page: Page, theme: Theme, api = new FakeApi()) {
  await mockApi(page, api);
  await setTheme(page, theme);
  // "Edited 2 minutes ago" is counted from the fixed now, like the seeded dates.
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await expect(page.getByRole('main')).not.toBeEmpty();
  await expect(page.getByRole('banner').getByText('Saved', { exact: true })).toBeAttached();
  // The page's editor loads on its own; nothing is still loading in the shot.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
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
