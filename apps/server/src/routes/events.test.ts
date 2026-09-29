import type { ServerEvent, Tree } from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { STRONG_PASSWORD, createTestApp, type Client, type TestApp } from '../test/harness';

let t: TestApp;
let me: Client;
let inboxId: string;
const open: WebSocket[] = [];

beforeEach(async () => {
  t = await createTestApp();
  me = await t.setupAdmin('alex');
  inboxId = ((await me.get('/api/v1/tree')).json() as Tree).inboxId;
});
afterEach(async () => {
  for (const socket of open.splice(0)) socket.terminate();
  await t.close();
  vi.useRealTimers();
});

const LAPTOP = 'laptop-0001';
const PHONE = 'phone-0002';

/** A browser's event channel that remembers what it was sent. */
async function listen(client: Client, device: string) {
  const socket = await client.events(`?device=${device}`);
  open.push(socket);
  const received: ServerEvent[] = [];
  socket.on('message', (data) => received.push(JSON.parse(String(data)) as ServerEvent));
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  return {
    socket,
    received,
    closed,
    of: <T extends ServerEvent['type']>(type: T) =>
      received.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type),
    send: (message: unknown) => socket.send(JSON.stringify(message)),
  };
}

/** Lets the in-process socket deliver what was sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('the event channel', () => {
  it('needs a session and Memora’s own origin', async () => {
    await expect(t.client().events()).rejects.toThrow(/401/);
    await expect(me.events('', { origin: 'https://evil.example' })).rejects.toThrow(/403/);
    await expect(me.events('', { origin: '' })).rejects.toThrow(/403/);
  });

  it('tells the other browsers about tree changes, but not the one that made them', async () => {
    const laptop = await listen(me, LAPTOP);
    const phone = await listen(me, PHONE);
    await me.post(
      '/api/v1/notebooks',
      { name: 'Work', color: 'blue' },
      { headers: { 'x-memora-device': LAPTOP } },
    );
    await settle();
    expect(phone.of('tree.changed')).toEqual([{ type: 'tree.changed', origin: LAPTOP }]);
    expect(laptop.of('tree.changed')).toEqual([]);
    // A refused change announces nothing.
    await me.post('/api/v1/notebooks', { name: '', color: 'blue' });
    await settle();
    expect(phone.of('tree.changed')).toHaveLength(1);
  });

  it('announces content saves with the page’s new row', async () => {
    const phone = await listen(me, PHONE);
    const { id } = (await me.post('/api/v1/pages', { sectionId: inboxId })).json().pages[0];
    await me.put(
      `/api/v1/pages/${id}/content`,
      { baseRevision: 1, content: 'Hello' },
      { headers: { 'x-memora-device': LAPTOP } },
    );
    await settle();
    expect(phone.of('page.updated')).toEqual([
      expect.objectContaining({
        type: 'page.updated',
        revision: 2,
        origin: LAPTOP,
        page: expect.objectContaining({ id, revision: 2, snippet: 'Hello' }),
      }),
    ]);
  });

  it('only ever sends a user their own events', async () => {
    const created = await me.post('/api/v1/admin/users', { username: 'sam', displayName: 'Sam' });
    const sam = t.client();
    await sam.login('sam', created.json().temporaryPassword);
    await sam.post('/api/v1/auth/password', {
      currentPassword: created.json().temporaryPassword,
      newPassword: STRONG_PASSWORD,
    });
    const samsPhone = await listen(sam, PHONE);
    const mine = await listen(me, LAPTOP);
    mine.send({ type: 'presence', pages: [] });
    const { id } = (await me.post('/api/v1/pages', { sectionId: inboxId })).json().pages[0];
    await me.put(`/api/v1/pages/${id}/content`, { baseRevision: 1, content: 'Private' });
    await settle();
    expect(samsPhone.received.filter((e) => e.type !== 'presence')).toEqual([]);
    expect(JSON.stringify(samsPhone.received)).not.toContain(id);
  });

  it('tells each browser which pages the user’s other devices have open', async () => {
    const phoneUser = t.client({
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/605.1',
    });
    await phoneUser.login('alex', STRONG_PASSWORD);
    const laptop = await listen(me, LAPTOP);
    const phone = await listen(phoneUser, PHONE);
    const { id } = (await me.post('/api/v1/pages', { sectionId: inboxId })).json().pages[0];
    phone.send({ type: 'presence', pages: [id] });
    await settle();
    expect(laptop.of('presence').at(-1)).toEqual({
      type: 'presence',
      devices: [{ label: 'Safari on iPhone', pages: [id] }],
    });
    expect(phone.of('presence').at(-1)).toEqual({ type: 'presence', devices: [] });

    // Closing: injected sockets never report it to the server; hub.test.ts covers it.
    phone.send({ type: 'presence', pages: [] });
    await settle();
    expect(laptop.of('presence').at(-1)).toEqual({ type: 'presence', devices: [] });
    expect(t.app.events.size).toBe(2);
  });

  it('ignores malformed messages, and closes on a flood', async () => {
    const laptop = await listen(me, LAPTOP);
    laptop.socket.send('not json');
    laptop.send({ type: 'presence', pages: ['not-an-id'] });
    await settle();
    expect(laptop.socket.readyState).toBe(laptop.socket.OPEN);
    for (let i = 0; i < 70; i++) laptop.send({ type: 'presence', pages: [] });
    expect(await laptop.closed).toBe(1008);
  });

  it('closes when the session ends, without keeping it alive', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const laptop = await listen(me, LAPTOP);
    await me.post('/api/v1/auth/logout');
    vi.advanceTimersByTime(30_000);
    expect(await laptop.closed).toBe(4401);
  });
});
