import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/*
 * Stand-ins for a WebDAV server and for Google's OAuth and Drive APIs, on 127.0.0.1, for the
 * sync tests (ADR 0006). Just what Memora uses, with the rules that matter for it.
 */

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export interface FakeDav {
  url: string;
  files: Map<string, Buffer>;
  dirs: Set<string>;
  /** Every request, as `METHOD path`. */
  requests: string[];
  /** Extra listing entries that point outside the folder, and redirects, when set. */
  hostile: { hrefs: string[]; redirectGets: boolean };
  close(): Promise<void>;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A WebDAV server with one account (`sam` / `secret`) whose files start at `root`. */
export async function fakeDav(root = '/dav/files/sam/'): Promise<FakeDav> {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>(['/', '/dav/', '/dav/files/', root]);
  const requests: string[] = [];
  const hostile = { hrefs: [] as string[], redirectGets: false };
  const auth = `Basic ${Buffer.from('sam:secret').toString('base64')}`;
  const server = createServer((request, response) => void handle(request, response));

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://x');
    const path = decodeURIComponent(url.pathname);
    requests.push(`${method} ${path}`);
    const data = await body(request);
    if (request.headers.authorization !== auth) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dav"' }).end();
      return;
    }
    const parent = (p: string) => p.replace(/[^/]+\/?$/, '');
    if (method === 'PROPFIND') {
      const dir = path.endsWith('/') ? path : `${path}/`;
      if (!dirs.has(dir)) {
        if (files.has(path)) {
          response.writeHead(207).end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>');
        } else response.writeHead(404).end();
        return;
      }
      const entries = [
        `<d:response><d:href>${encodeURI(dir)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      ];
      if (request.headers.depth !== '0') {
        for (const [file, content] of files) {
          if (parent(file) !== dir) continue;
          entries.push(
            `<d:response><d:href>${encodeURI(file)}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${content.length}</d:getcontentlength><d:getlastmodified>Thu, 01 Jan 2026 00:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          );
        }
        for (const sub of dirs) {
          if (sub !== dir && parent(sub) === dir) {
            entries.push(
              `<d:response><d:href>${encodeURI(sub)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`,
            );
          }
        }
        for (const href of hostile.hrefs) {
          entries.push(
            `<D:response xmlns:D="DAV:"><D:href>${xmlEscape(href)}</D:href><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response>`,
          );
        }
      }
      response
        .writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
        .end(
          `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`,
        );
      return;
    }
    if (method === 'MKCOL') {
      const dir = path.endsWith('/') ? path : `${path}/`;
      if (dirs.has(dir)) return void response.writeHead(405).end();
      if (!dirs.has(parent(dir))) return void response.writeHead(409).end();
      dirs.add(dir);
      return void response.writeHead(201).end();
    }
    if (method === 'HEAD') {
      const file = files.get(path);
      if (!file) return void response.writeHead(404).end();
      return void response.writeHead(200, { 'Content-Length': file.length }).end();
    }
    if (method === 'PUT') {
      if (!dirs.has(parent(path))) return void response.writeHead(409).end();
      const existed = files.has(path);
      if (existed && request.headers['if-none-match'] === '*') {
        return void response.writeHead(412).end();
      }
      files.set(path, data);
      return void response.writeHead(existed ? 204 : 201).end();
    }
    if (method === 'GET') {
      if (hostile.redirectGets) {
        return void response.writeHead(302, { Location: 'http://127.0.0.1:1/elsewhere' }).end();
      }
      const file = files.get(path);
      if (!file) return void response.writeHead(404).end();
      return void response.writeHead(200, { 'Content-Length': file.length }).end(file);
    }
    if (method === 'DELETE') {
      return void response.writeHead(files.delete(path) ? 204 : 404).end();
    }
    response.writeHead(405).end();
  }

  const url = await listen(server);
  return {
    url,
    files,
    dirs,
    requests,
    hostile,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

interface DriveFile {
  id: string;
  name: string;
  parents: string[];
  mimeType: string;
  content: Buffer;
  trashed: boolean;
  /** Made by Memora: the only files `drive.file` lets it see. */
  byApp: boolean;
  modifiedTime: string;
}

export interface FakeGoogle {
  url: string;
  endpoints: { auth: string; token: string; api: string; upload: string; revoke: string };
  files: Map<string, DriveFile>;
  /** Scopes asked for at the token endpoint, and the access tokens handed out. */
  granted: string[];
  requests: string[];
  /** Codes the "browser" was given, by state: what Google would redirect with. */
  authorize(authUrl: string): { code: string; state: string; redirectUri: string };
  close(): Promise<void>;
}

/** Google's OAuth and Drive v3, as far as Memora uses them, with one user's Drive. */
export async function fakeGoogle(): Promise<FakeGoogle> {
  const files = new Map<string, DriveFile>();
  const granted: string[] = [];
  const requests: string[] = [];
  const codes = new Map<string, { challenge: string; scope: string; redirectUri: string }>();
  const tokens = new Set<string>();
  let next = 1;
  const newId = () => `f${next++}`;
  // A file of the person's own: Memora must never see it.
  files.set('mine', {
    id: 'mine',
    name: 'Memora',
    parents: ['root'],
    mimeType: 'application/vnd.google-apps.folder',
    content: Buffer.alloc(0),
    trashed: false,
    byApp: false,
    modifiedTime: new Date(0).toISOString(),
  });

  const server = createServer((request, response) => void handle(request, response));
  const json = (response: ServerResponse, status: number, value: unknown) =>
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));

  function matches(file: DriveFile, q: string): boolean {
    for (const part of q.split(' and ')) {
      let m: RegExpExecArray | null;
      if ((m = /^name = '((?:[^'\\]|\\.)*)'$/.exec(part))) {
        if (file.name !== m[1]!.replace(/\\(.)/g, '$1')) return false;
      } else if ((m = /^mimeType = '([^']*)'$/.exec(part))) {
        if (file.mimeType !== m[1]) return false;
      } else if ((m = /^'([^']*)' in parents$/.exec(part))) {
        if (!file.parents.includes(m[1]!)) return false;
      } else if (part === 'trashed = false') {
        if (file.trashed) return false;
      } else {
        throw new Error(`fake Drive: unknown query part ${part}`);
      }
    }
    return true;
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://x');
    requests.push(`${request.method} ${url.pathname}`);
    const data = await body(request);
    if (url.pathname === '/token') {
      const form = new URLSearchParams(data.toString());
      if (form.get('client_id') !== 'memora-test.apps.googleusercontent.com') {
        return json(response, 401, { error: 'invalid_client' });
      }
      if (form.get('grant_type') === 'authorization_code') {
        const code = codes.get(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (
          !code ||
          code.challenge !== challenge ||
          code.redirectUri !== form.get('redirect_uri')
        ) {
          return json(response, 400, { error: 'invalid_grant' });
        }
        codes.delete(form.get('code')!);
        granted.push(code.scope);
        const access = `access-${next++}`;
        tokens.add(access);
        return json(response, 200, {
          access_token: access,
          refresh_token: `refresh-${next++}`,
          expires_in: 3600,
          scope: code.scope,
        });
      }
      if (
        form.get('grant_type') === 'refresh_token' &&
        form.get('refresh_token')?.startsWith('refresh-')
      ) {
        const access = `access-${next++}`;
        tokens.add(access);
        return json(response, 200, { access_token: access, expires_in: 3600 });
      }
      return json(response, 400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/revoke') return json(response, 200, {});
    const bearer = (request.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!tokens.has(bearer)) return json(response, 401, { error: { code: 401 } });

    const visible = (file: DriveFile | undefined) => (file && file.byApp ? file : undefined);
    let m: RegExpExecArray | null;
    if (url.pathname === '/drive/v3/files' && request.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const found = [...files.values()].filter((f) => f.byApp && matches(f, q));
      return json(response, 200, {
        files: found.map((f) => ({
          id: f.id,
          name: f.name,
          size: String(f.content.length),
          modifiedTime: f.modifiedTime,
        })),
      });
    }
    if (url.pathname === '/drive/v3/files' && request.method === 'POST') {
      const meta = JSON.parse(data.toString()) as {
        name: string;
        mimeType: string;
        parents: string[];
      };
      const id = newId();
      files.set(id, {
        id,
        name: meta.name,
        parents: meta.parents,
        mimeType: meta.mimeType,
        content: Buffer.alloc(0),
        trashed: false,
        byApp: true,
        modifiedTime: new Date().toISOString(),
      });
      return json(response, 200, { id });
    }
    if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname))) {
      const file = visible(files.get(decodeURIComponent(m[1]!)));
      if (!file) return json(response, 404, { error: { code: 404 } });
      if (request.method === 'DELETE') {
        files.delete(file.id);
        return void response.writeHead(204).end();
      }
      if (url.searchParams.get('alt') === 'media') {
        return void response.writeHead(200).end(file.content);
      }
      return json(response, 200, { id: file.id, trashed: file.trashed });
    }
    if (url.pathname === '/upload/drive/v3/files' && request.method === 'POST') {
      const boundary = /boundary=(.+)$/.exec(request.headers['content-type'] ?? '')?.[1];
      if (!boundary) return json(response, 400, {});
      const text = data.toString('latin1');
      const parts = text.split(`--${boundary}`);
      const metaPart = parts[1]!;
      const meta = JSON.parse(metaPart.slice(metaPart.indexOf('\r\n\r\n') + 4).trim()) as {
        name: string;
        parents: string[];
      };
      const filePart = parts[2]!;
      const content = Buffer.from(filePart.slice(filePart.indexOf('\r\n\r\n') + 4, -2), 'latin1');
      const parent = visible(files.get(meta.parents[0]!));
      if (!parent && meta.parents[0] !== 'root') return json(response, 404, {});
      const id = newId();
      files.set(id, {
        id,
        name: meta.name,
        parents: meta.parents,
        mimeType: 'application/octet-stream',
        content,
        trashed: false,
        byApp: true,
        modifiedTime: new Date().toISOString(),
      });
      return json(response, 200, { id });
    }
    if (
      (m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)) &&
      request.method === 'PATCH'
    ) {
      const file = visible(files.get(decodeURIComponent(m[1]!)));
      if (!file) return json(response, 404, { error: { code: 404 } });
      file.content = data;
      return json(response, 200, { id: file.id });
    }
    json(response, 404, {});
  }

  const url = await listen(server);
  return {
    url,
    endpoints: {
      auth: `${url}/auth`,
      token: `${url}/token`,
      api: `${url}/drive/v3`,
      upload: `${url}/upload/drive/v3`,
      revoke: `${url}/revoke`,
    },
    files,
    granted,
    requests,
    authorize(authUrl) {
      const params = new URL(authUrl).searchParams;
      const code = `code-${next++}`;
      codes.set(code, {
        challenge: params.get('code_challenge') ?? '',
        scope: params.get('scope') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
      });
      return {
        code,
        state: params.get('state') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
      };
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
