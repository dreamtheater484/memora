import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { openDatabase, type SqliteDatabase } from './db/client';

let tempDir: string;
let db: SqliteDatabase;
let app: FastifyInstance;

async function setup({
  withWebApp,
  env = {},
}: {
  withWebApp: boolean;
  env?: Record<string, string>;
}) {
  tempDir = mkdtempSync(join(tmpdir(), 'memora-app-'));
  const webDir = join(tempDir, 'web');
  if (withWebApp) {
    mkdirSync(join(webDir, 'assets'), { recursive: true });
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(webDir, 'assets', 'app-1234.js'), 'console.log("hi")');
  }
  const config = loadConfig({ MEMORA_DATA_DIR: tempDir, MEMORA_WEB_DIR: webDir, ...env });
  db = openDatabase(config.databaseFile);
  app = await buildApp({ config, db, version: '1.2.3', logger: false });
}

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('reports status and version only', async () => {
    await setup({ withWebApp: false });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 when the database is unavailable', async () => {
    await setup({ withWebApp: false });
    db.close();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'error', version: '1.2.3' });
    db = openDatabase(join(tempDir, 'memora.db')); // reopen so afterEach can close it
  });
});

describe('web app serving', () => {
  it('serves index.html for client-side routes', async () => {
    await setup({ withWebApp: true });
    const response = await app.inject({ method: 'GET', url: '/p/some-page' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<div id="root">');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('caches hashed assets forever', async () => {
    await setup({ withWebApp: true });
    const response = await app.inject({ method: 'GET', url: '/assets/app-1234.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('answers unknown API routes with JSON 404, never the web app', async () => {
    await setup({ withWebApp: true });
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });

  it('serves the API alone when the web app is not built', async () => {
    await setup({ withWebApp: false });
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
  });
});

describe('security headers', () => {
  it('lets pages run only Memora’s own scripts, and never be framed', async () => {
    await setup({ withWebApp: true });
    const page = await app.inject({ method: 'GET', url: '/p/some-page' });
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(page.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
    });
    expect(page.headers['permissions-policy']).toContain('camera=()');
    // Plain HTTP: no HSTS (browsers ignore it there, and it could strand a LAN setup).
    expect(page.headers['strict-transport-security']).toBeUndefined();

    const asset = await app.inject({ method: 'GET', url: '/assets/app-1234.js' });
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
  });

  it('gives API answers a policy that loads nothing', async () => {
    await setup({ withWebApp: true });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('asks browsers to keep to HTTPS when Memora is reached over HTTPS', async () => {
    await setup({ withWebApp: true, env: { MEMORA_TRUST_PROXY: '1' } });
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000');
  });
});
