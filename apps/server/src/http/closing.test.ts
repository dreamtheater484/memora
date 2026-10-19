import { randomBytes } from 'node:crypto';
import net from 'node:net';
import type { Tree } from '@memora/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type Client, type TestApp } from '../test/harness';

/*
 * Closing Memora while browsers still hold connections (closing.ts). The desktop app ends a
 * server that hasn't stopped after 10 s, leaving memora.db-wal behind: closing must not wait
 * on a browser.
 */

let t: TestApp;
const sockets: net.Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await t.close();
});

async function listening(closeGraceMs: number) {
  t = await createTestApp({}, { closeGraceMs });
  const me = await t.setupAdmin();
  await t.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = t.app.server.address() as net.AddressInfo;
  return { me, port };
}

/** A connection to Memora that sends nothing, and keeps what it receives. */
async function connect(port: number) {
  const socket = net.connect(port, '127.0.0.1');
  sockets.push(socket);
  await new Promise((resolve) => socket.once('connect', resolve));
  let received = '';
  socket.on('data', (data) => (received += String(data)));
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  return { socket, closed, received: () => received };
}

/** The start of a request as a browser on this computer sends it. */
const head = (port: number, me: Client, line: string, headers: string[] = []) =>
  [
    line,
    `Host: 127.0.0.1:${port}`,
    `Origin: http://127.0.0.1:${port}`,
    `Cookie: ${me.cookieHeader}`,
    ...headers,
    '',
    '',
  ].join('\r\n');

/** How long app.close() takes. */
async function closing() {
  const started = performance.now();
  await t.app.close();
  return performance.now() - started;
}

describe('closing Memora', () => {
  it('does not wait for connections a browser opened and never used', async () => {
    const { port } = await listening(10_000);
    // Browsers keep spare connections like this one.
    const unused = await connect(port);
    const idle = await connect(port);
    idle.socket.write(`GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
    await expect.poll(idle.received).toContain('200 OK');

    expect(await closing()).toBeLessThan(1_000);
    await unused.closed;
    await idle.closed;
  });

  it('answers a change still arriving, keeps it, and then closes', async () => {
    const { me, port } = await listening(10_000);
    const { inboxId } = (await me.get('/api/v1/tree')).json() as Tree;
    const { id } = (await me.post('/api/v1/pages', { sectionId: inboxId })).json().pages[0];
    const body = JSON.stringify({ baseRevision: 1, content: 'The last words' });

    // The window's last change: its request has begun when Memora is asked to close.
    const window = await connect(port);
    window.socket.write(
      head(port, me, `PUT /api/v1/pages/${id}/content HTTP/1.1`, [
        `X-CSRF-Token: ${me.csrfToken}`,
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(body)}`,
      ]),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    setTimeout(() => window.socket.write(body), 200);

    expect(await closing()).toBeLessThan(1_500);
    await window.closed;
    expect(window.received()).toMatch(/^HTTP\/1\.1 200 /);
    expect(t.db.prepare('SELECT content FROM pages WHERE id = ?').get(id)).toEqual({
      content: 'The last words',
    });
  });

  it('cuts an event channel whose browser does not answer, after the grace period', async () => {
    const { me, port } = await listening(300);
    const channel = await connect(port);
    channel.socket.write(
      head(port, me, 'GET /api/v1/events HTTP/1.1', [
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
      ]),
    );
    await expect.poll(channel.received).toContain('101 Switching Protocols');

    // ws itself would wait 30 s for the browser's half of the closing handshake.
    const took = await closing();
    expect(took).toBeGreaterThanOrEqual(250);
    expect(took).toBeLessThan(2_000);
    await channel.closed;
  });
});
