import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';

/*
 * Sync's secrets (ADR 0006): the cloud sign-in and the vault key. They are never in the
 * database or its backups. In the desktop app, Electron's main process seals them with the
 * operating system's own protection (DPAPI on Windows, the Keychain on macOS, the Secret
 * Service on Linux) and keeps them beside the app's data; the server asks for them over the
 * utility process's message port. Where the system offers no protection, nothing is kept.
 */

export const syncSecretsSchema = z.object({
  credentials: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('google'), refreshToken: z.string().min(1) }),
      z.object({ kind: z.literal('webdav'), username: z.string(), password: z.string() }),
      z.object({ kind: z.literal('folder') }),
    ])
    .nullable(),
  /** The vault key (base64), from the passphrase. */
  vaultKey: z.string().nullable(),
  /** A Google Cloud client of the person's own, instead of the build's. */
  googleClient: z
    .object({ clientId: z.string(), clientSecret: z.string().optional() })
    .nullable()
    .default(null),
});
export type SyncSecrets = z.infer<typeof syncSecretsSchema>;

export const NO_SECRETS: SyncSecrets = { credentials: null, vaultKey: null, googleClient: null };

export interface SecretStore {
  /** Whether secrets can be kept safely on this computer. */
  available(): Promise<boolean>;
  load(): Promise<SyncSecrets>;
  save(secrets: SyncSecrets): Promise<void>;
}

function parse(text: string | null): SyncSecrets {
  if (!text) return NO_SECRETS;
  try {
    const parsed = syncSecretsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : NO_SECRETS;
  } catch {
    return NO_SECRETS;
  }
}

/** For tests: kept in memory. */
export class MemorySecretStore implements SecretStore {
  private value: string | null = null;
  constructor(private readonly safe = true) {}
  async available() {
    return this.safe;
  }
  async load() {
    return parse(this.value);
  }
  async save(secrets: SyncSecrets) {
    this.value = JSON.stringify(secrets);
  }
}

/**
 * For the server run by hand in desktop mode (development): a file sealed with the instance
 * key, which is no stronger than the data folder's own protection. The desktop app never uses
 * it.
 */
export class SealedFileSecretStore implements SecretStore {
  constructor(
    private readonly file: string,
    private readonly key: () => Buffer,
  ) {}

  async available() {
    return true;
  }

  async load(): Promise<SyncSecrets> {
    let data: Buffer;
    try {
      data = await readFile(this.file);
    } catch {
      return NO_SECRETS;
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(data.length - 16));
      return parse(
        Buffer.concat([
          decipher.update(data.subarray(12, data.length - 16)),
          decipher.final(),
        ]).toString('utf8'),
      );
    } catch {
      return NO_SECRETS;
    }
  }

  async save(secrets: SyncSecrets): Promise<void> {
    if (!secrets.credentials && !secrets.vaultKey && !secrets.googleClient) {
      await rm(this.file, { force: true });
      return;
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), nonce);
    const data = Buffer.concat([
      nonce,
      cipher.update(JSON.stringify(secrets), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    await writeFile(`${this.file}.tmp`, data, { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
}

/** Electron's utility-process port, as the server sees it. */
export interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

export const BRIDGE = 'memora-bridge';

const replySchema = z.object({
  type: z.literal(BRIDGE),
  id: z.number(),
  ok: z.boolean(),
  value: z.unknown().optional(),
  error: z.string().optional(),
});

/**
 * Asks the desktop app's main process for what only it can do: keep secrets sealed by the
 * system, and show a folder picker.
 */
export class DesktopBridge implements SecretStore {
  private next = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly port: ParentPort) {
    port.on('message', (event) => {
      const parsed = replySchema.safeParse(event.data);
      if (!parsed.success) return;
      const call = this.waiting.get(parsed.data.id);
      if (!call) return;
      this.waiting.delete(parsed.data.id);
      if (parsed.data.ok) call.resolve(parsed.data.value);
      else call.reject(new Error(parsed.data.error ?? 'The Memora app refused.'));
    });
  }

  private call(op: string, value?: unknown, timeoutMs = 15_000): Promise<unknown> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error('The Memora app didn’t answer.'));
      }, timeoutMs);
      this.waiting.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.port.postMessage({ type: BRIDGE, id, op, value });
    });
  }

  async available(): Promise<boolean> {
    return (await this.call('secrets.available')) === true;
  }

  async load(): Promise<SyncSecrets> {
    const value = await this.call('secrets.load');
    return parse(typeof value === 'string' ? value : null);
  }

  async save(secrets: SyncSecrets): Promise<void> {
    const empty = !secrets.credentials && !secrets.vaultKey && !secrets.googleClient;
    await this.call('secrets.save', empty ? null : JSON.stringify(secrets));
  }

  /** Shows the system's folder picker; null when it was cancelled. */
  async pickFolder(): Promise<string | null> {
    const value = await this.call('pick-folder', undefined, 10 * 60_000);
    return typeof value === 'string' ? value : null;
  }
}
