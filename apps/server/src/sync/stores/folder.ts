import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  NAME,
  pathParts,
  RemoteError,
  type RemoteEntry,
  type RemoteStore,
  type VaultDir,
} from '../store';

/*
 * A folder on this computer (ADR 0006): one the Google Drive, kDrive or Nextcloud app keeps in
 * sync, or a network drive. Memora then holds no cloud credentials at all. Files are written
 * beside their place and renamed into it, so a sync app never picks up half a file.
 */

export class FolderStore implements RemoteStore {
  private constructor(private readonly root: string) {}

  /** The store for a folder that exists; throws RemoteError otherwise. */
  static async open(path: string): Promise<FolderStore> {
    if (!isAbsolute(path)) {
      throw new RemoteError('Choose the folder with its full path.', 'other');
    }
    const root = resolve(path);
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) {
      throw new RemoteError('There’s no folder there. Choose an existing folder.', 'other');
    }
    return new FolderStore(root);
  }

  private file(path: string): string {
    return join(this.root, ...pathParts(path));
  }

  async read(path: string, maxBytes: number): Promise<Buffer | null> {
    const file = this.file(path);
    try {
      const info = await stat(file);
      if (!info.isFile()) return null;
      if (info.size > maxBytes) {
        throw new RemoteError('A file in the sync folder is too large.', 'too_large');
      }
      return await readFile(file);
    } catch (error) {
      if (missing(error)) return null;
      throw failed(error);
    }
  }

  async write(path: string, data: Buffer): Promise<void> {
    await this.put(path, data, false);
  }

  async create(path: string, data: Buffer): Promise<boolean> {
    return this.put(path, data, true);
  }

  /** Writes beside the file, then renames it into place (unless it must be new and isn't). */
  private async put(path: string, data: Buffer, mustBeNew: boolean): Promise<boolean> {
    const parts = pathParts(path);
    const target = this.file(path);
    const dir = parts.length === 2 ? join(this.root, parts[0]) : this.root;
    // A dot first: sync apps and Memora's own listing both pass over it.
    const temp = join(dir, `.${parts.at(-1)}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(temp, data, { flag: 'wx' });
      // Only this computer writes its batches, one at a time: a check before the rename is
      // enough to never replace one.
      if (mustBeNew && (await stat(target).catch(() => null))) {
        await rm(temp, { force: true });
        return false;
      }
      await rename(temp, target);
      return true;
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw failed(error);
    }
  }

  async list(dir: VaultDir): Promise<RemoteEntry[]> {
    let names: string[];
    try {
      names = (await readdir(join(this.root, dir), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && NAME.test(entry.name))
        .map((entry) => entry.name);
    } catch (error) {
      if (missing(error)) return [];
      throw failed(error);
    }
    const entries: RemoteEntry[] = [];
    for (const name of names) {
      const info = await stat(join(this.root, dir, name)).catch(() => null);
      if (info) entries.push({ name, size: info.size, modifiedAt: info.mtimeMs });
    }
    return entries;
  }

  async remove(path: string): Promise<void> {
    try {
      await rm(this.file(path), { force: true });
    } catch (error) {
      throw failed(error);
    }
  }
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

function failed(error: unknown): RemoteError {
  if (error instanceof RemoteError) return error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EACCES' || code === 'EPERM') {
    return new RemoteError('Memora may not write in the sync folder.', 'denied');
  }
  if (code === 'ENOSPC') return new RemoteError('The disk with the sync folder is full.', 'other');
  return new RemoteError(`The sync folder can’t be used (${code ?? 'error'}).`, 'other');
}
