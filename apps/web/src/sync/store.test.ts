import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { fromServer, settle } from './records';
import { MemoryStore, openStore, type LocalStore } from './store';

let users = 0;
const server = (content: string) => ({ revision: 1, content, type: 'markdown' }) as const;

const stores: [string, () => Promise<LocalStore>][] = [
  ['IndexedDB', () => openStore(`user-${++users}`)],
  ['memory', async () => new MemoryStore()],
];

describe.each(stores)('the %s store', (_name, open) => {
  it('updates a record and knows which ones wait to be sent', async () => {
    const store = await open();
    await store.update('a', () => fromServer('a', server('A'), 1));
    await store.update('b', () => fromServer('b', server('B'), 2));
    const after = await store.update('b', (r) => r && { ...r, content: 'B!' });
    expect(after).toMatchObject({ content: 'B!', dirty: 1 });
    expect((await store.dirty()).map((r) => r.id)).toEqual(['b']);
    expect(await store.counts()).toEqual({ dirty: 1, ops: 0 });
    // Undefined leaves it, null deletes it.
    expect(await store.update('a', () => undefined)).toMatchObject({ content: 'A' });
    await store.update('a', () => null);
    expect(await store.get('a')).toBeUndefined();
  });

  it('keeps ops in order until they are removed', async () => {
    const store = await open();
    await store.addOp({ kind: 'keepVersion', pageId: 'a', content: 'one', baseRevision: 1 });
    await store.addOp({ kind: 'keepVersion', pageId: 'a', content: 'two', baseRevision: 1 });
    const ops = await store.ops();
    expect(ops.map((op) => op.kind === 'keepVersion' && op.content)).toEqual(['one', 'two']);
    await store.removeOp(ops[0]!.seq!);
    expect((await store.ops()).length).toBe(1);
    expect(await store.counts()).toEqual({ dirty: 0, ops: 1 });
  });

  it('keeps values for starting offline', async () => {
    const store = await open();
    await store.write('tree', { inboxId: 'x' });
    expect(await store.read('tree')).toEqual({ inboxId: 'x' });
    expect(await store.read('settings')).toBeUndefined();
  });

  it('drops the oldest unchanged pages, never changed ones', async () => {
    const store = await open();
    for (let i = 1; i <= 5; i++)
      await store.update(`p${i}`, () => fromServer(`p${i}`, server('x'), i));
    await store.update('p1', (r) => r && settle({ ...r, content: 'edited' }));
    await store.trim(2);
    const left = await Promise.all([1, 2, 3, 4, 5].map((i) => store.get(`p${i}`)));
    expect(left.map((r) => r?.id)).toEqual(['p1', undefined, undefined, 'p4', 'p5']);
  });

  it('forgets everything already on the server when logging out', async () => {
    const store = await open();
    await store.update('a', () => fromServer('a', server('A'), 1));
    await store.update('b', () => settle({ ...fromServer('b', server('B'), 1), content: 'B!' }));
    await store.write('tree', {});
    await store.forgetClean();
    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('b')).toMatchObject({ content: 'B!' });
    expect(await store.read('tree')).toBeUndefined();
  });
});

it('is durable in IndexedDB and shared by everything that opens it', async () => {
  const id = `user-${++users}`;
  const first = await openStore(id);
  expect(first.durable).toBe(true);
  await first.update('a', () => fromServer('a', server('A'), 1));
  const second = await openStore(id);
  expect(await second.get('a')).toMatchObject({ content: 'A' });
});
