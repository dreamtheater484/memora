import { createHash, randomBytes } from 'node:crypto';
import {
  NAME,
  networkError,
  pathParts,
  readLimited,
  RemoteError,
  VAULT_DIRS,
  type RemoteEntry,
  type RemoteStore,
  type VaultDir,
} from '../store';

/*
 * A folder in Google Drive (ADR 0006), reached with the `drive.file` scope only: Google lets
 * Memora see the files it created itself and nothing else in the Drive. Memora makes its folder
 * in My Drive (or finds the one it made before, on another computer) and works inside it.
 *
 * Signing in is OAuth for installed apps: the computer's own browser, PKCE, and a redirect to
 * Memora on this computer's loopback address. Memora never sees the Google password.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';

export interface GoogleClient {
  clientId: string;
  /** Google's desktop clients have one, though it can't be kept secret in an app. */
  clientSecret?: string;
}

/** Google's addresses; tests point them at a local stand-in. */
export interface GoogleEndpoints {
  auth: string;
  token: string;
  api: string;
  upload: string;
  revoke: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
  revoke: 'https://oauth2.googleapis.com/revoke',
};

const TIMEOUT_MS = 60_000;

/** A PKCE verifier and its challenge (RFC 7636, S256). */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** The address of Google's sign-in page, for the computer's browser. */
export function authorizationUrl(
  client: GoogleClient,
  redirectUri: string,
  state: string,
  challenge: string,
  endpoints = GOOGLE_ENDPOINTS,
): string {
  const url = new URL(endpoints.auth);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  }).toString();
  return url.toString();
}

async function tokenRequest(
  endpoints: GoogleEndpoints,
  params: Record<string, string>,
): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }> {
  let response: Response;
  try {
    response = await fetch(endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw networkError(error, 'Google');
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (response.ok) return body;
  if (body.error === 'invalid_grant') {
    throw new RemoteError(
      'Google no longer accepts Memora’s sign-in. Sign in to Google Drive again.',
      'auth',
      response.status,
    );
  }
  if (body.error === 'invalid_client' || body.error === 'unauthorized_client') {
    throw new RemoteError('Google doesn’t accept this Memora build’s sign-in client.', 'auth');
  }
  throw new RemoteError(
    `Google refused the sign-in (${body.error ?? response.status}).`,
    response.status >= 500 ? 'network' : 'other',
    response.status,
  );
}

const clientParams = (client: GoogleClient) => ({
  client_id: client.clientId,
  ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
});

/** Trades the code from the sign-in for a refresh token, checking the access granted. */
export async function exchangeCode(
  client: GoogleClient,
  code: string,
  verifier: string,
  redirectUri: string,
  endpoints = GOOGLE_ENDPOINTS,
): Promise<string> {
  const body = await tokenRequest(endpoints, {
    ...clientParams(client),
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const scopes = (body.scope ?? '').split(/\s+/);
  if (!scopes.includes(DRIVE_SCOPE)) {
    throw new RemoteError(
      'Google didn’t give Memora access to its files. When Google asks, allow Memora to see and change the files it makes.',
      'denied',
    );
  }
  if (!body.refresh_token) {
    throw new RemoteError('Google didn’t give Memora a lasting sign-in. Try again.', 'other');
  }
  return body.refresh_token;
}

/** Short-lived access tokens, from the refresh token. */
export class GoogleTokens {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly client: GoogleClient,
    private readonly refreshToken: string,
    private readonly endpoints = GOOGLE_ENDPOINTS,
  ) {}

  async access(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const body = await tokenRequest(this.endpoints, {
      ...clientParams(this.client),
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    });
    if (!body.access_token) throw new RemoteError('Google sent no access token.', 'other');
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  /** The token was refused: get a new one next time. */
  forget(): void {
    this.token = null;
  }

  /** Signs Memora out of Google (best effort): the refresh token stops working. */
  async revoke(): Promise<void> {
    await fetch(this.endpoints.revoke, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: this.refreshToken }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
}

interface DriveFile {
  id: string;
  name: string;
  size?: string;
  modifiedTime?: string;
}

/** A Drive query string: single quotes and backslashes escaped. */
const quoted = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export class GoogleDriveStore implements RemoteStore {
  private rootId: string | null;
  private readonly dirIds = new Map<VaultDir, string>();
  /** Ids of files by path, as listed or written. */
  private readonly fileIds = new Map<string, string>();

  constructor(
    private readonly tokens: GoogleTokens,
    /** The folder's path in My Drive: `Memora`, or `Apps/Memora`. */
    private readonly folder: string,
    rootId: string | null = null,
    private readonly endpoints = GOOGLE_ENDPOINTS,
  ) {
    this.rootId = rootId;
  }

  get location(): string {
    return `Google Drive › ${this.folder.split('/').join(' › ')}`;
  }

  private async request(
    method: string,
    url: string,
    init: { body?: Buffer | string; headers?: Record<string, string> } = {},
    retried = false,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${await this.tokens.access()}`, ...init.headers },
        body: init.body,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw networkError(error, 'Google Drive');
    }
    if (response.status === 401 && !retried) {
      await response.body?.cancel().catch(() => undefined);
      this.tokens.forget();
      return this.request(method, url, init, true);
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      throw new RemoteError('Google Drive no longer accepts Memora’s sign-in.', 'auth', 401);
    }
    return response;
  }

  private async failed(response: Response, what: string): Promise<RemoteError> {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { errors?: { reason?: string }[] };
    };
    const reason = body.error?.errors?.[0]?.reason;
    if (reason === 'storageQuotaExceeded') {
      return new RemoteError('Your Google Drive is full.', 'other', response.status);
    }
    if (
      response.status === 429 ||
      response.status >= 500 ||
      reason === 'rateLimitExceeded' ||
      reason === 'userRateLimitExceeded'
    ) {
      return new RemoteError('Google Drive is busy. Memora tries again soon.', 'network');
    }
    if (response.status === 403) {
      return new RemoteError(
        `Google Drive doesn’t let Memora ${what}${reason ? ` (${reason})` : ''}.`,
        'denied',
        403,
      );
    }
    return new RemoteError(
      `Google Drive couldn’t ${what} (${response.status}).`,
      'other',
      response.status,
    );
  }

  /** Files matching a query, all pages of them. */
  private async query(q: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name,size,modifiedTime)',
        pageSize: '1000',
        spaces: 'drive',
        orderBy: 'createdTime',
        ...(pageToken ? { pageToken } : {}),
      });
      const response = await this.request('GET', `${this.endpoints.api}/files?${params}`);
      if (!response.ok) throw await this.failed(response, 'list files');
      const body = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
      files.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return files;
  }

  private async findFolder(name: string, parent: string): Promise<string | null> {
    const found = await this.query(
      `name = ${quoted(name)} and mimeType = '${FOLDER_TYPE}' and ${quoted(parent)} in parents and trashed = false`,
    );
    return found[0]?.id ?? null;
  }

  private async makeFolder(name: string, parent: string): Promise<string> {
    const response = await this.request('POST', `${this.endpoints.api}/files?fields=id`, {
      body: JSON.stringify({ name, mimeType: FOLDER_TYPE, parents: [parent] }),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    if (!response.ok) throw await this.failed(response, 'make a folder');
    return ((await response.json()) as { id: string }).id;
  }

  /**
   * Finds Memora's folder in My Drive, or makes it; answers its id. Only folders Memora made
   * can be found: Google shows it nothing else.
   */
  async prepare(): Promise<string> {
    if (this.rootId) {
      const response = await this.request(
        'GET',
        `${this.endpoints.api}/files/${encodeURIComponent(this.rootId)}?fields=id,trashed`,
      );
      if (response.ok) {
        const body = (await response.json()) as { trashed?: boolean };
        if (!body.trashed) return this.rootId;
      } else if (response.status !== 404) {
        throw await this.failed(response, 'open the folder');
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      this.rootId = null;
    }
    let parent = 'root';
    for (const name of this.folder.split('/')) {
      parent = (await this.findFolder(name, parent)) ?? (await this.makeFolder(name, parent));
    }
    this.rootId = parent;
    return parent;
  }

  private async root(): Promise<string> {
    return this.rootId ?? this.prepare();
  }

  private async dir(dir: VaultDir, create: boolean): Promise<string | null> {
    const known = this.dirIds.get(dir);
    if (known) return known;
    const root = await this.root();
    const id =
      (await this.findFolder(dir, root)) ?? (create ? await this.makeFolder(dir, root) : null);
    if (id) this.dirIds.set(dir, id);
    return id;
  }

  private async parentOf(parts: [string] | [VaultDir, string], create: boolean) {
    return parts.length === 2 ? this.dir(parts[0], create) : this.root();
  }

  private async fileId(path: string): Promise<string | null> {
    const known = this.fileIds.get(path);
    if (known) return known;
    const parts = pathParts(path);
    const parent = await this.parentOf(parts, false);
    if (!parent) return null;
    const found = await this.query(
      `name = ${quoted(parts.at(-1)!)} and ${quoted(parent)} in parents and trashed = false`,
    );
    const id = found.at(-1)?.id ?? null;
    if (id) this.fileIds.set(path, id);
    return id;
  }

  async read(path: string, maxBytes: number): Promise<Buffer | null> {
    const id = await this.fileId(path);
    if (!id) return null;
    const response = await this.request(
      'GET',
      `${this.endpoints.api}/files/${encodeURIComponent(id)}?alt=media`,
    );
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      this.fileIds.delete(path);
      return null;
    }
    if (!response.ok) throw await this.failed(response, 'read a file');
    return readLimited(response, maxBytes);
  }

  async create(path: string, data: Buffer): Promise<boolean> {
    if (await this.fileId(path)) return false;
    await this.write(path, data);
    return true;
  }

  async write(path: string, data: Buffer): Promise<void> {
    const parts = pathParts(path);
    const existing = await this.fileId(path);
    if (existing) {
      const response = await this.request(
        'PATCH',
        `${this.endpoints.upload}/files/${encodeURIComponent(existing)}?uploadType=media&fields=id`,
        { body: data, headers: { 'Content-Type': 'application/octet-stream' } },
      );
      if (response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      if (response.status !== 404) throw await this.failed(response, 'write a file');
      await response.body?.cancel().catch(() => undefined);
      this.fileIds.delete(path);
    }
    const parent = (await this.parentOf(parts, true))!;
    const boundary = `memora-${randomBytes(12).toString('hex')}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
          name: parts.at(-1),
          parents: [parent],
        })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
        'utf8',
      ),
      data,
      Buffer.from(`\r\n--${boundary}--`, 'utf8'),
    ]);
    const response = await this.request(
      'POST',
      `${this.endpoints.upload}/files?uploadType=multipart&fields=id`,
      { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } },
    );
    if (!response.ok) throw await this.failed(response, 'write a file');
    this.fileIds.set(path, ((await response.json()) as { id: string }).id);
  }

  async list(dir: VaultDir): Promise<RemoteEntry[]> {
    if (!(VAULT_DIRS as readonly string[]).includes(dir))
      throw new Error(`Not a vault folder: ${dir}`);
    const id = await this.dir(dir, false);
    if (!id) return [];
    const files = await this.query(`${quoted(id)} in parents and trashed = false`);
    return files
      .filter((file) => NAME.test(file.name))
      .map((file) => {
        this.fileIds.set(`${dir}/${file.name}`, file.id);
        const modifiedAt = file.modifiedTime ? Date.parse(file.modifiedTime) : NaN;
        return {
          name: file.name,
          ...(file.size ? { size: Number(file.size) } : {}),
          ...(Number.isFinite(modifiedAt) ? { modifiedAt } : {}),
        };
      });
  }

  async remove(path: string): Promise<void> {
    const id = await this.fileId(path);
    if (!id) return;
    const response = await this.request(
      'DELETE',
      `${this.endpoints.api}/files/${encodeURIComponent(id)}`,
    );
    await response.body?.cancel().catch(() => undefined);
    this.fileIds.delete(path);
    if (!response.ok && response.status !== 404) throw await this.failed(response, 'remove a file');
  }
}
