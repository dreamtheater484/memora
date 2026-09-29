import { uuidv7 } from '@memora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pngOf } from '../test/images';
import { STRONG_PASSWORD, createTestApp, type Client, type TestApp } from '../test/harness';

let t: TestApp;
let alice: Client;
let bob: Client;

beforeAll(async () => {
  t = await createTestApp({ MEMORA_MAX_UPLOAD_MB: '1' });
  alice = await t.setupAdmin('alice');
  const created = await alice.post('/api/v1/admin/users', { username: 'bob', displayName: 'Bob' });
  bob = t.client();
  await bob.login('bob', created.json().temporaryPassword);
  await bob.post('/api/v1/auth/password', {
    currentPassword: created.json().temporaryPassword,
    newPassword: STRONG_PASSWORD,
  });
});

afterAll(async () => {
  await t.close();
});

const upload = (client: Client, id: string, body: Buffer, type: string, name = 'file') =>
  client.put(`/api/v1/assets/${id}?name=${encodeURIComponent(name)}`, body, {
    headers: { 'content-type': type },
  });

describe('assets', () => {
  it('stores a pasted image and serves it back, inline', async () => {
    const id = uuidv7();
    const res = await upload(alice, id, pngOf(800, 600), 'image/png', 'Screenshot 1.png');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id,
      mime: 'image/png',
      width: 800,
      height: 600,
      name: 'Screenshot 1.png',
    });
    const got = await alice.get(`/api/v1/assets/${id}`);
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['content-disposition']).toContain('inline');
    expect(got.headers['cache-control']).toContain('immutable');
    expect(got.rawPayload.equals(pngOf(800, 600))).toBe(true);
    // A second look is answered from the browser's copy.
    const again = await alice.get(`/api/v1/assets/${id}`, {
      headers: { 'if-none-match': String(got.headers.etag) },
    });
    expect(again.statusCode).toBe(304);
  });

  it('takes a repeated upload of the same file (a lost answer) without complaint', async () => {
    const id = uuidv7();
    expect((await upload(alice, id, pngOf(2, 2), 'image/png')).statusCode).toBe(201);
    expect((await upload(alice, id, pngOf(2, 2), 'image/png')).statusCode).toBe(200);
    const other = await upload(alice, id, pngOf(3, 3), 'image/png');
    expect(other.statusCode).toBe(409);
    expect(other.json().error.code).toBe('asset_exists');
  });

  it('stores identical files once', async () => {
    const data = Buffer.from('the same bytes twice');
    await upload(alice, uuidv7(), data, 'text/plain');
    await upload(alice, uuidv7(), data, 'text/plain');
    const { n } = t.db
      .prepare('SELECT count(*) AS n FROM asset_blobs WHERE data = ?')
      .get(data) as { n: number };
    expect(n).toBe(1);
  });

  it('serves anything but images as a sandboxed download', async () => {
    const id = uuidv7();
    await upload(alice, id, Buffer.from('<script>alert(1)</script>'), 'text/html', 'page.html');
    const got = await alice.get(`/api/v1/assets/${id}`);
    expect(got.headers['content-disposition']).toMatch(/^attachment; filename="page.html"/);
    expect(got.headers['content-security-policy']).toContain('sandbox');
    expect(got.headers['x-content-type-options']).toBe('nosniff');

    const fake = uuidv7();
    await upload(alice, fake, Buffer.from('<svg onload=alert(1)>'), 'image/png', 'x.png');
    expect((await alice.get(`/api/v1/assets/${fake}`)).headers['content-type']).toBe(
      'application/octet-stream',
    );
  });

  it('keeps any file name, and JSON files as they are', async () => {
    const id = uuidv7();
    const json = Buffer.from('{"a":1}');
    await upload(alice, id, json, 'application/json', 'Überblick 東京.json');
    const got = await alice.get(`/api/v1/assets/${id}`);
    expect(got.rawPayload.equals(json)).toBe(true);
    expect(got.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('Überblick 東京.json')}`,
    );
  });

  it('refuses files over the limit, with the limit', async () => {
    const res = await upload(alice, uuidv7(), Buffer.alloc(1024 * 1024 + 1), 'image/png');
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('file_too_large');
  });

  it('keeps each user’s files to themselves', async () => {
    const id = uuidv7();
    await upload(alice, id, pngOf(5, 5), 'image/png');
    expect((await bob.get(`/api/v1/assets/${id}`)).statusCode).toBe(404);
    // Bob can't put something else under Alice's id either.
    expect((await upload(bob, id, pngOf(6, 6), 'image/png')).statusCode).toBe(409);
    expect((await alice.get(`/api/v1/assets/${id}`)).rawPayload.equals(pngOf(5, 5))).toBe(true);
  });

  it('checks the id and the name', async () => {
    expect((await upload(alice, 'not-an-id', pngOf(1, 1), 'image/png')).statusCode).toBe(400);
    const noName = await alice.put(`/api/v1/assets/${uuidv7()}`, pngOf(1, 1), {
      headers: { 'content-type': 'image/png' },
    });
    expect(noName.statusCode).toBe(400);
  });
});
