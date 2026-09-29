import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AssetMeta } from '@memora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FETCH_POLICY, isPublicAddress } from '../assets/fetch';
import { pngOf } from '../test/images';
import { createTestApp, type Client, type TestApp } from '../test/harness';

/*
 * `POST /assets/fetch` (§9.5): images in pasted HTML are downloaded by the server. The test
 * server runs on this machine, so the app under test allows its address and nothing else
 * local; the rules themselves are tested in assets/fetch.test.ts.
 */

let web: Server;
let port: number;
let t: TestApp;
let me: Client;

beforeAll(async () => {
  web = createServer((req, res) => {
    if (req.url === '/cat.png')
      res.writeHead(200, { 'content-type': 'image/png' }).end(pngOf(30, 20));
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
  port = (web.address() as AddressInfo).port;
  t = await createTestApp(
    {},
    {
      fetchPolicy: {
        ...DEFAULT_FETCH_POLICY,
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        allowed: (address, family) =>
          (address === '127.0.0.1' && family === 4) || isPublicAddress(address, family),
      },
    },
  );
  me = await t.setupAdmin('alex');
});

afterAll(async () => {
  await t.close();
  await new Promise((resolve) => web.close(resolve));
});

describe('downloading images', () => {
  it('keeps a web image as a file of the page', async () => {
    const res = await me.post('/api/v1/assets/fetch', {
      url: `http://images.test:${port}/cat.png`,
    });
    expect(res.statusCode).toBe(201);
    const meta = res.json() as AssetMeta;
    expect(meta).toMatchObject({ mime: 'image/png', width: 30, height: 20, name: 'cat.png' });
    const got = await me.get(`/api/v1/assets/${meta.id}`);
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(pngOf(30, 20))).toBe(true);
  });

  it('says why an image couldn’t be downloaded', async () => {
    const missing = await me.post('/api/v1/assets/fetch', {
      url: `http://images.test:${port}/nope.png`,
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error).toMatchObject({
      code: 'fetch_failed',
      details: { reason: 'status' },
    });
    const internal = await me.post('/api/v1/assets/fetch', {
      url: 'http://192.168.1.1/router.png', // privacy-check: allow
    });
    expect(internal.json().error).toMatchObject({
      code: 'fetch_failed',
      details: { reason: 'blocked' },
    });
    const bad = await me.post('/api/v1/assets/fetch', { url: '' });
    expect(bad.statusCode).toBe(400);
  });

  it('needs a session', async () => {
    const res = await t
      .client()
      .post('/api/v1/assets/fetch', { url: `http://images.test:${port}/cat.png` });
    expect([401, 403]).toContain(res.statusCode);
  });
});
