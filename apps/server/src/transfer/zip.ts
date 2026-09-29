import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import yazl from 'yazl';

/*
 * Zip files for imports and exports, streamed: an entry's bytes are loaded only when the
 * writer gets to it, and read back one entry at a time, so neither holds a whole archive in
 * memory.
 */

export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

export class ZipWriter {
  private readonly zip = new yazl.ZipFile();
  private readonly done: Promise<void>;
  /** SHA-256 of every entry written so far, by path. */
  readonly hashes: Record<string, string> = {};

  constructor(path: string) {
    const out = createWriteStream(path);
    this.zip.outputStream.pipe(out);
    this.done = new Promise((resolve, reject) => {
      out.on('close', () => resolve());
      out.on('error', reject);
      this.zip.outputStream.on('error', reject);
    });
  }

  /** Adds an entry whose content is made when it is written. */
  add(path: string, load: () => Buffer | string, mtime?: number): void {
    let sent = false;
    const hashes = this.hashes;
    const stream = new Readable({
      read() {
        if (sent) return;
        sent = true;
        try {
          const data = (() => {
            const value = load();
            return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
          })();
          hashes[path] = sha256(data);
          this.push(data);
          this.push(null);
        } catch (error) {
          this.destroy(error as Error);
        }
      },
    });
    this.zip.addReadStream(stream, path, mtime ? { mtime: new Date(mtime) } : {});
  }

  async close(): Promise<void> {
    this.zip.end();
    await this.done;
  }
}

export interface ZipLimits {
  maxEntries: number;
  /** Largest entry, uncompressed. */
  maxEntryBytes: number;
  /** All entries together, uncompressed. */
  maxTotalBytes: number;
}

export class ZipLimitError extends Error {}

export interface ZipEntry {
  path: string;
  size: number;
  read(): Promise<Buffer>;
}

/** Lists a zip's entries (folders left out), each readable on its own. */
export async function readZip(
  path: string,
  limits: ZipLimits,
): Promise<{ entries: ZipEntry[]; close: () => void }> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, file) =>
      error ? reject(error) : resolve(file),
    ),
  );
  const entries: ZipEntry[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entries.length >= limits.maxEntries) {
        reject(new ZipLimitError(`The archive has more than ${limits.maxEntries} files.`));
        return;
      }
      if (!entry.fileName.endsWith('/')) {
        total += entry.uncompressedSize;
        if (total > limits.maxTotalBytes) {
          reject(new ZipLimitError('The archive is too large once unpacked.'));
          return;
        }
        entries.push({
          path: entry.fileName,
          size: entry.uncompressedSize,
          read: () => readEntry(zip, entry, limits.maxEntryBytes),
        });
      }
      zip.readEntry();
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
    zip.readEntry();
  });
  return { entries, close: () => zip.close() };
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, max: number): Promise<Buffer> {
  if (entry.uncompressedSize > max) {
    return Promise.reject(new ZipLimitError(`“${entry.fileName}” is too large.`));
  }
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        // The size in the zip's directory can lie.
        if (size > max) {
          stream.destroy(new ZipLimitError(`“${entry.fileName}” is too large.`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}
