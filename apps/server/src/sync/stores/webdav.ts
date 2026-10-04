import {
  NAME,
  networkError,
  pathParts,
  readLimited,
  RemoteError,
  type RemoteEntry,
  type RemoteStore,
  type VaultDir,
} from '../store';

/*
 * A folder on a WebDAV server (ADR 0006): kDrive, Nextcloud, ownCloud and others. A WebDAV
 * login opens the whole account, so Memora keeps itself to the folder:
 *
 * - one base address, fixed at setup, over HTTPS only;
 * - every request's address is built from that base and names Memora made itself;
 * - redirects are never followed (a server sending Memora elsewhere is an error);
 * - in a folder listing, entries outside the folder are ignored.
 */

export interface WebDavOptions {
  /** The folder's address; it becomes the base of every request. */
  url: string;
  username: string;
  password: string;
  /** Tests run a WebDAV server on http://127.0.0.1. */
  allowHttp?: boolean;
  timeoutMs?: number;
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';

/** A folder listing larger than this is refused. */
const MAX_LISTING = 32 * 1024 * 1024;

/** The kDrive WebDAV address of a folder: `https://<id>.connect.kdrive.infomaniak.com/<folder>/`. */
export function kdriveUrl(driveId: string, folder: string): string {
  if (!/^\d{1,12}$/.test(driveId)) throw new RemoteError('The kDrive ID is a number.', 'other');
  const path = folder
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `https://${driveId}.connect.kdrive.infomaniak.com/${path}/`;
}

export class WebDavStore implements RemoteStore {
  private readonly base: URL;
  /** The base's path, decoded, ending in `/`. */
  private readonly basePath: string;
  private readonly authorization: string;
  private readonly timeoutMs: number;
  private readonly folders = new Set<string>();

  constructor(options: WebDavOptions) {
    let base: URL;
    try {
      base = new URL(options.url);
    } catch {
      throw new RemoteError('That isn’t a web address.', 'other');
    }
    const local = base.hostname === '127.0.0.1' || base.hostname === 'localhost';
    if (base.protocol !== 'https:' && !(options.allowHttp && local && base.protocol === 'http:')) {
      throw new RemoteError('Memora only connects to WebDAV over HTTPS.', 'other');
    }
    if (base.username || base.password || base.search || base.hash) {
      throw new RemoteError('Enter the address without a name, password or “?”.', 'other');
    }
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    this.base = base;
    this.basePath = decodePath(base.pathname);
    this.authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`, 'utf8').toString('base64')}`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /** Where the folder is, for people: the address without its scheme. */
  get location(): string {
    return `${this.base.host}${this.basePath}`;
  }

  private url(...names: string[]): URL {
    // Only names checked by pathParts reach here; encoding keeps them one segment each.
    return new URL(names.map(encodeURIComponent).join('/'), this.base);
  }

  private async request(
    method: string,
    url: URL,
    init: { body?: Buffer | string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: this.authorization, ...init.headers },
        body: init.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw networkError(error, 'the WebDAV server');
    }
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      await response.body?.cancel().catch(() => undefined);
      throw new RemoteError(
        'The WebDAV server sent Memora to another address. Check the folder’s address.',
        'denied',
        response.status,
      );
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      throw new RemoteError(
        'The WebDAV server didn’t accept the user name and password.',
        'auth',
        401,
      );
    }
    if (response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new RemoteError('The WebDAV server doesn’t allow this.', 'denied', 403);
    }
    return response;
  }

  private failed(response: Response, what: string): RemoteError {
    void response.body?.cancel().catch(() => undefined);
    if (response.status === 507) {
      return new RemoteError('The cloud storage is full.', 'other', 507);
    }
    return new RemoteError(
      `The WebDAV server couldn’t ${what} (${response.status}).`,
      response.status >= 500 ? 'network' : 'other',
      response.status,
    );
  }

  /**
   * Checks the folder can be reached, making it (and, for kDrive, the folders above it) when
   * it isn't there. `createParents` is only for addresses whose root Memora knows.
   */
  async prepare(createParents = false): Promise<void> {
    const response = await this.request('PROPFIND', this.base, {
      body: PROPFIND_BODY,
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 207 || response.status === 200) return;
    if (response.status !== 404) throw this.failed(response, 'open the folder');
    const parts = this.basePath.split('/').filter(Boolean);
    const levels = createParents ? parts.map((_, i) => i + 1) : [parts.length];
    for (const level of levels) {
      const path = `/${parts
        .slice(0, level)
        .map((p) => encodeURIComponent(p))
        .join('/')}/`;
      const made = await this.request('MKCOL', new URL(path, this.base));
      await made.body?.cancel().catch(() => undefined);
      if (made.status === 409) {
        throw new RemoteError(
          'The folder above the sync folder doesn’t exist on the WebDAV server.',
          'other',
          409,
        );
      }
      if (made.status !== 201 && made.status !== 405) throw this.failed(made, 'make the folder');
    }
  }

  async read(path: string, maxBytes: number): Promise<Buffer | null> {
    const response = await this.request('GET', this.url(...pathParts(path)));
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (response.status !== 200) throw this.failed(response, 'read a file');
    return readLimited(response, maxBytes);
  }

  async write(path: string, data: Buffer): Promise<void> {
    await this.put(path, data, false);
  }

  async create(path: string, data: Buffer): Promise<boolean> {
    // Asked first, as not every server honours If-None-Match on a PUT; then the PUT says it too.
    const head = await this.request('HEAD', this.url(...pathParts(path)));
    await head.body?.cancel().catch(() => undefined);
    if (head.status === 200) return false;
    return this.put(path, data, true);
  }

  private async put(path: string, data: Buffer, mustBeNew: boolean): Promise<boolean> {
    const parts = pathParts(path);
    if (parts.length === 2) await this.folder(parts[0]);
    const send = async () => {
      const response = await this.request('PUT', this.url(...parts), {
        body: data,
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(mustBeNew ? { 'If-None-Match': '*' } : {}),
        },
      });
      await response.body?.cancel().catch(() => undefined);
      return response;
    };
    let response = await send();
    if (response.status === 409 && parts.length === 2) {
      // The folder went away since: make it again, once.
      this.folders.delete(parts[0]);
      await this.folder(parts[0]);
      response = await send();
    }
    if (mustBeNew && response.status === 412) return false;
    if (![200, 201, 204].includes(response.status)) throw this.failed(response, 'write a file');
    return true;
  }

  private async folder(dir: VaultDir): Promise<void> {
    if (this.folders.has(dir)) return;
    const response = await this.request('MKCOL', this.url(dir));
    await response.body?.cancel().catch(() => undefined);
    // 405: it exists already.
    if (response.status !== 201 && response.status !== 405) {
      throw this.failed(response, 'make a folder');
    }
    this.folders.add(dir);
  }

  async list(dir: VaultDir): Promise<RemoteEntry[]> {
    const response = await this.request('PROPFIND', this.url(dir), {
      body: PROPFIND_BODY,
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return [];
    }
    if (response.status !== 207) throw this.failed(response, 'list a folder');
    this.folders.add(dir);
    const xml = (await readLimited(response, MAX_LISTING)).toString('utf8');
    const folderPath = `${this.basePath}${dir}/`;
    const entries: RemoteEntry[] = [];
    for (const item of parseMultistatus(xml)) {
      let path: string;
      try {
        const url = new URL(item.href, this.base);
        // Another server, or another place on it: not part of the folder.
        if (url.origin !== this.base.origin) continue;
        path = decodePath(url.pathname);
      } catch {
        continue;
      }
      if (item.collection || !path.startsWith(folderPath)) continue;
      const name = path.slice(folderPath.length);
      if (!NAME.test(name)) continue;
      entries.push({
        name,
        ...(item.size !== undefined ? { size: item.size } : {}),
        ...(item.modifiedAt !== undefined ? { modifiedAt: item.modifiedAt } : {}),
      });
    }
    return entries;
  }

  async remove(path: string): Promise<void> {
    const response = await this.request('DELETE', this.url(...pathParts(path)));
    await response.body?.cancel().catch(() => undefined);
    if (![200, 202, 204, 404].includes(response.status))
      throw this.failed(response, 'remove a file');
  }
}

/** Decodes a path segment by segment; a segment that can't be decoded stays as it was. */
function decodePath(path: string): string {
  return path
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join('/');
}

interface DavItem {
  href: string;
  collection: boolean;
  size?: number;
  modifiedAt?: number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
      if (entity[0] === '#') {
        const code =
          entity[1] === 'x' || entity[1] === 'X'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : whole;
      }
      return ENTITIES[entity.toLowerCase()] ?? whole;
    })
    .trim();
}

/** One element's text, whatever its namespace prefix. */
function element(xml: string, name: string): string | undefined {
  const match = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>`,
  ).exec(xml);
  return match ? xmlText(match[1]!) : undefined;
}

/** Longest `<response>` Memora reads: one entry's few properties are far shorter. */
const MAX_ENTRY = 16 * 1024;

/**
 * The entries of a WebDAV multistatus answer (RFC 4918): just what Memora needs, read without
 * an XML library (no entities beyond the standard ones, no external references). The answer is
 * read once, tag by tag, so a malformed one can't make it slow.
 */
export function parseMultistatus(xml: string): DavItem[] {
  const items: DavItem[] = [];
  const tags = /<(\/?)(?:[A-Za-z_][\w.-]*:)?response(?:\s[^>]*)?>/g;
  let open = -1;
  for (const tag of xml.matchAll(tags)) {
    if (tag[1] === '') {
      open = tag.index + tag[0].length;
      continue;
    }
    if (open < 0) continue;
    const start = open;
    open = -1;
    if (tag.index - start > MAX_ENTRY) continue;
    const body = xml.slice(start, tag.index);
    const href = element(body, 'href');
    if (!href) continue;
    const collection = /<(?:[A-Za-z_][\w.-]*:)?collection\b/.test(body);
    const length = element(body, 'getcontentlength');
    const modified = element(body, 'getlastmodified');
    const size = length && /^\d+$/.test(length) ? Number(length) : undefined;
    const time = modified ? Date.parse(modified) : NaN;
    items.push({
      href,
      collection,
      ...(size !== undefined ? { size } : {}),
      ...(Number.isFinite(time) ? { modifiedAt: time } : {}),
    });
  }
  return items;
}
