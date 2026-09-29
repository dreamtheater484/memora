import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { WebSocket } from 'ws';
import { buildApp, type AppOptions } from '../app';
import { loadConfig, type Config } from '../config';
import { openDatabase, type SqliteDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { migrationsDir } from '../paths';

/** A controllable clock: tests move time forward to reach expiry and throttle limits. */
export class Clock {
  constructor(public time = Date.UTC(2026, 0, 1)) {}
  now = () => this.time;
  advance(ms: number) {
    this.time += ms;
  }
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const STRONG_PASSWORD = 'violet-harbour-lantern';

export interface TestApp {
  app: FastifyInstance;
  db: SqliteDatabase;
  clock: Clock;
  config: Config;
  client(headers?: Record<string, string>): Client;
  /** Runs first-run setup and returns the signed-in admin's client. */
  setupAdmin(username?: string): Promise<Client>;
  close(): Promise<void>;
}

export async function createTestApp(
  env: Record<string, string> = {},
  options: Pick<AppOptions, 'fetchPolicy' | 'onRestart'> = {},
): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'memora-test-'));
  const config = loadConfig({ MEMORA_DATA_DIR: dir, MEMORA_WEB_DIR: join(dir, 'web'), ...env });
  const db = openDatabase(config.databaseFile);
  await runMigrations({ db, migrationsDir, backupDir: config.backupDir, appVersion: 'test' });
  const clock = new Clock();
  const app = await buildApp({
    config,
    db,
    version: 'test',
    logger: false,
    now: clock.now,
    // Cheap hashing keeps the tests fast; the real parameters are tested in password.test.ts.
    hashParams: { memoryCost: 256, timeCost: 1, parallelism: 1 },
    ...options,
  });
  await app.ready();

  const client = (headers: Record<string, string> = {}) => new Client(app, headers);

  return {
    app,
    db,
    clock,
    config,
    client,
    async setupAdmin(username = 'admin') {
      const code = app.authService.startSetupIfNeeded();
      const admin = client();
      const res = await admin.post('/api/v1/auth/setup', {
        setupCode: code,
        username,
        displayName: 'Admin',
        password: STRONG_PASSWORD,
      });
      if (res.statusCode !== 200) throw new Error(`setup failed: ${res.body}`);
      return admin;
    },
    async close() {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Talks to the app like a browser on the same origin: keeps the session cookie, sends
 * `Origin`, and sends the CSRF token it was given on requests that change data.
 */
export class Client {
  cookies = new Map<string, string>();
  csrfToken: string | undefined;

  constructor(
    private readonly app: FastifyInstance,
    private readonly headers: Record<string, string>,
  ) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async request(
    method: Method,
    url: string,
    body?: unknown,
    extra: { headers?: Record<string, string>; csrf?: boolean } = {},
  ): Promise<LightMyRequestResponse> {
    const unsafe = method !== 'GET';
    const headers: Record<string, string> = {
      host: 'localhost',
      ...(unsafe ? { origin: `http://${this.headers.host ?? 'localhost'}` } : {}),
      ...this.headers,
      ...(this.cookies.size > 0 ? { cookie: this.cookieHeader } : {}),
      ...(unsafe && this.csrfToken && extra.csrf !== false
        ? { 'x-csrf-token': this.csrfToken }
        : {}),
      ...extra.headers,
    };
    const options: InjectOptions = { method, url, headers };
    if (body !== undefined) options.payload = body as InjectOptions['payload'];
    const res = await this.app.inject(options);
    this.storeCookies(res);
    const json = res.headers['content-type']?.includes('json') ? tryJson(res.body) : undefined;
    if (json && typeof json === 'object' && 'csrfToken' in json) {
      this.csrfToken = (json as { csrfToken: string | null }).csrfToken ?? undefined;
    }
    return res;
  }

  get = (url: string, extra?: { headers?: Record<string, string> }) =>
    this.request('GET', url, undefined, extra);
  post = (
    url: string,
    body?: unknown,
    extra?: { headers?: Record<string, string>; csrf?: boolean },
  ) => this.request('POST', url, body, extra);
  patch = (
    url: string,
    body?: unknown,
    extra?: { headers?: Record<string, string>; csrf?: boolean },
  ) => this.request('PATCH', url, body, extra);
  put = (
    url: string,
    body?: unknown,
    extra?: { headers?: Record<string, string>; csrf?: boolean },
  ) => this.request('PUT', url, body, extra);
  delete = (url: string, extra?: { headers?: Record<string, string>; csrf?: boolean }) =>
    this.request('DELETE', url, undefined, extra);

  /** Opens the event channel like a browser's syncing tab; rejects when the upgrade is refused. */
  events(query = '', headers: Record<string, string> = {}): Promise<WebSocket> {
    return this.app.injectWS(`/api/v1/events${query}`, {
      // The injected upgrade has no network socket; the address is what `request.ip` reads.
      socket: { remoteAddress: '127.0.0.1' } as never,
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        ...this.headers,
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader } : {}),
        ...headers,
      },
    });
  }

  async login(username: string, password = STRONG_PASSWORD, remember = false) {
    const res = await this.post('/api/v1/auth/login', { username, password, remember });
    if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
    return res;
  }

  private storeCookies(res: LightMyRequestResponse) {
    const raw = res.headers['set-cookie'];
    for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      const [pair = ''] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /max-age=0\b/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

function tryJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** The Set-Cookie lines of a response, as an array. */
export function setCookies(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}
