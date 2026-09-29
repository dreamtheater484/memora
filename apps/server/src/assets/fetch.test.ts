import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pngOf } from '../test/images';
import {
  DEFAULT_FETCH_POLICY,
  FetchError,
  Limiter,
  fetchImage,
  isPublicAddress,
  type FetchPolicy,
} from './fetch';

/*
 * The SSRF rules (§11). A local server plays the web; the policy under test allows its
 * loopback address only where a test says so, exactly as the real one would refuse it.
 */

let server: Server;
let port: number;
const seen: { url: string; host: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', host: req.headers.host });
    const url = new URL(req.url ?? '/', 'http://x');
    switch (url.pathname) {
      case '/photo.png':
        res.writeHead(200, { 'content-type': 'image/png' }).end(pngOf(64, 32));
        return;
      case '/page.html':
        res.writeHead(200, { 'content-type': 'text/html' }).end('<p>hi</p>');
        return;
      case '/fake.png':
        res.writeHead(200, { 'content-type': 'image/png' }).end('not an image at all');
        return;
      case '/big.png':
        res.writeHead(200, { 'content-type': 'image/png' });
        res.write(pngOf(10, 10));
        res.end(Buffer.alloc(4096));
        return;
      case '/slow.png':
        // Never answers.
        return;
      case '/missing.png':
        res.writeHead(404).end();
        return;
      case '/to-metadata':
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
        return;
      case '/loop': {
        const n = Number(url.searchParams.get('n') ?? 0);
        res.writeHead(302, { location: n >= 5 ? '/photo.png' : `/loop?n=${n + 1}` }).end();
        return;
      }
      case '/hop':
        res.writeHead(301, { location: '/photo.png' }).end();
        return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** The real rules, except that the test server's address is allowed. */
const local = (patch: Partial<FetchPolicy> = {}): FetchPolicy => ({
  ...DEFAULT_FETCH_POLICY,
  resolve: async () => [{ address: '127.0.0.1', family: 4 }],
  allowed: (address, family) => address === '127.0.0.1' || isPublicAddress(address, family),
  ...patch,
});

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FetchError) return error.reason;
    throw error;
  }
  throw new Error('expected the download to fail');
}

describe('isPublicAddress', () => {
  it('blocks private, loopback, link-local, multicast and other special ranges', () => {
    const blocked: [string, 4 | 6][] = [
      ['127.0.0.1', 4],
      ['10.1.2.3', 4], // privacy-check: allow
      ['172.16.5.4', 4], // privacy-check: allow
      ['172.31.255.255', 4], // privacy-check: allow
      ['192.168.1.20', 4], // privacy-check: allow
      ['169.254.169.254', 4],
      ['100.100.1.1', 4],
      ['0.0.0.0', 4],
      ['224.0.0.251', 4],
      ['255.255.255.255', 4],
      ['::1', 6],
      ['::', 6],
      ['fe80::1', 6],
      ['fd12:3456::1', 6],
      ['ff02::1', 6],
      ['::ffff:127.0.0.1', 6],
      ['::ffff:10.0.0.1', 6], // privacy-check: allow
      ['64:ff9b::a00:1', 6],
      ['2002:a00:1::', 6],
    ];
    for (const [address, family] of blocked) {
      expect(isPublicAddress(address, family), address).toBe(false);
    }
    for (const [address, family] of [
      ['93.184.216.34', 4],
      ['172.32.0.1', 4],
      ['2606:4700::6810:85e5', 6],
    ] as const) {
      expect(isPublicAddress(address, family), address).toBe(true);
    }
  });
});

describe('fetchImage', () => {
  it('downloads an image, naming it after the address', async () => {
    const got = await fetchImage(`http://127.0.0.1:${port}/photo.png?w=800`, local());
    expect(got.image).toEqual({ mime: 'image/png', width: 64, height: 32 });
    expect(got.name).toBe('photo.png');
    expect(got.data.equals(pngOf(64, 32))).toBe(true);
  });

  it('connects to the address it checked, keeping the host name', async () => {
    seen.length = 0;
    const got = await fetchImage(`http://images.example:${port}/photo.png`, local());
    expect(got.image.width).toBe(64);
    expect(seen).toEqual([{ url: '/photo.png', host: `images.example:${port}` }]);
  });

  it('refuses addresses that aren’t http or https', async () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/a.png',
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      'gopher://example.com/',
      'not a url',
      // With a user name and password in it.
      Object.assign(new URL('http://example.com/a.png'), { username: 'me', password: 'pw' }).href,
    ]) {
      expect(await failure(fetchImage(url)), url).toBe('invalid_url');
    }
  });

  it('refuses local and private addresses, however they are written', async () => {
    for (const url of [
      `http://127.0.0.1:${port}/photo.png`,
      `http://localhost:${port}/photo.png`,
      'http://2130706433/photo.png',
      'http://0x7f.1/photo.png',
      'http://[::1]/photo.png',
      'http://[::ffff:127.0.0.1]/photo.png',
      'http://10.0.0.1/photo.png', // privacy-check: allow
      'http://192.168.1.1/photo.png', // privacy-check: allow
      'http://169.254.169.254/latest/meta-data',
      'http://[fe80::1]/photo.png',
      'http://0.0.0.0/photo.png',
    ]) {
      expect(await failure(fetchImage(url)), url).toBe('blocked');
    }
  });

  it('refuses a name that resolves to a private address, even alongside a public one', async () => {
    const policy = (addresses: string[]): FetchPolicy => ({
      ...DEFAULT_FETCH_POLICY,
      resolve: async () => addresses.map((address) => ({ address, family: 4 as const })),
    });
    const intranet = '10.0.0.5'; // privacy-check: allow
    const lan = '192.168.0.10'; // privacy-check: allow
    expect(await failure(fetchImage('http://intranet.example/a.png', policy([intranet])))).toBe(
      'blocked',
    );
    expect(
      await failure(fetchImage('http://mixed.example/a.png', policy(['93.184.216.34', lan]))),
    ).toBe('blocked');
    expect(await failure(fetchImage('http://nowhere.example/a.png', policy([])))).toBe(
      'unresolved',
    );
  });

  it('follows up to three redirects, checking each', async () => {
    const got = await fetchImage(`http://127.0.0.1:${port}/hop`, local());
    expect(got.image.width).toBe(64);
    expect(await failure(fetchImage(`http://127.0.0.1:${port}/loop`, local()))).toBe('redirects');
    // A redirect to an internal address is refused, not followed.
    expect(await failure(fetchImage(`http://127.0.0.1:${port}/to-metadata`, local()))).toBe(
      'blocked',
    );
  });

  it('keeps only real images, within the size and time limits', async () => {
    expect(await failure(fetchImage(`http://127.0.0.1:${port}/page.html`, local()))).toBe(
      'not_image',
    );
    expect(await failure(fetchImage(`http://127.0.0.1:${port}/fake.png`, local()))).toBe(
      'not_image',
    );
    expect(await failure(fetchImage(`http://127.0.0.1:${port}/missing.png`, local()))).toBe(
      'status',
    );
    expect(
      await failure(fetchImage(`http://127.0.0.1:${port}/big.png`, local({ maxBytes: 1024 }))),
    ).toBe('too_large');
    expect(
      await failure(fetchImage(`http://127.0.0.1:${port}/slow.png`, local({ timeoutMs: 300 }))),
    ).toBe('timeout');
  });
});

describe('Limiter', () => {
  it('runs at most so many tasks at once', async () => {
    const limiter = new Limiter(2);
    let running = 0;
    let most = 0;
    const task = () =>
      limiter.run(async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
      });
    await Promise.all(Array.from({ length: 6 }, task));
    expect(most).toBe(2);
  });
});
