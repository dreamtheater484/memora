import { lookup } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { sniffImage, type Sniffed } from './image';

/*
 * Downloading an image from the web into a page (§9.5), safe against server-side request
 * forgery (§11): only http and https; the host name is resolved and every address it has is
 * checked against private, loopback, link-local, multicast and other special ranges; the
 * connection then goes to the address that was checked (so the name can't be re-pointed in
 * between); redirects are followed at most 3 times, each checked again; 10 s in all, at most
 * 20 MB, and only real images (checked from their bytes) are kept.
 */

export type FetchFailure =
  | 'invalid_url'
  | 'blocked'
  | 'unresolved'
  | 'redirects'
  | 'status'
  | 'not_image'
  | 'too_large'
  | 'timeout'
  | 'network';

export class FetchError extends Error {
  override name = 'FetchError';
  constructor(
    readonly reason: FetchFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface FetchedImage {
  data: Buffer;
  image: Sniffed;
  /** A file name from the address, with the right extension. */
  name: string;
}

export interface Address {
  address: string;
  family: 4 | 6;
}

export interface FetchPolicy {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  /** Resolves a host name to its addresses (tests use a fake). */
  resolve: (host: string) => Promise<Address[]>;
  /** Whether an address may be connected to. */
  allowed: (address: string, family: 4 | 6) => boolean;
}

/** Ranges never fetched from: this host, the local network, and addresses with special uses. */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private (privacy-check: allow)
  ['100.64.0.0', 10], // carrier-grade NAT, also Tailscale
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata services
  ['172.16.0.0', 12], // private (privacy-check: allow)
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private (privacy-check: allow)
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // IPv4/IPv6 translation
  ['64:ff9b:1::', 48], // local translation
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

export function isPublicAddress(address: string, family: 4 | 6): boolean {
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is never a real web address. It isn't in the list
  // because the list compares every IPv4 address in its mapped form, so it would match all.
  if (family === 6 && /^(0{0,4}:){0,5}:?ffff:/i.test(address)) return false;
  return !BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export const DEFAULT_FETCH_POLICY: FetchPolicy = {
  maxBytes: 20 * 1024 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 3,
  resolve: async (host) =>
    (await lookup(host, { all: true, verbatim: true })).map((a) => ({
      address: a.address,
      family: a.family === 6 ? 6 : 4,
    })),
  allowed: isPublicAddress,
};

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Downloads one image by the rules above; throws FetchError with the reason otherwise. */
export async function fetchImage(
  address: string,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY,
): Promise<FetchedImage> {
  const deadline = Date.now() + policy.timeoutMs;
  let url = parseUrl(address);
  for (let hop = 0; ; hop++) {
    const target = await checkedAddress(url, policy);
    const response = await request(url, target, deadline);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      if (hop >= policy.maxRedirects) {
        throw new FetchError('redirects', 'The image address redirects too often.');
      }
      url = parseUrl(response.headers.location, url);
      continue;
    }
    if (status !== 200) {
      response.resume();
      throw new FetchError('status', `The website answered ${status}.`);
    }
    const type = String(response.headers['content-type'] ?? '').toLowerCase();
    if (type && !type.startsWith('image/') && !type.startsWith('application/octet-stream')) {
      response.resume();
      throw new FetchError('not_image', 'That address isn’t an image.');
    }
    const data = await readBody(response, policy.maxBytes, deadline);
    const image = sniffImage(data);
    if (!image) throw new FetchError('not_image', 'That address isn’t an image.');
    return { data, image, name: nameFrom(url, image.mime) };
  }
}

function parseUrl(value: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new FetchError('invalid_url', 'That isn’t a web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError('invalid_url', 'Only http and https addresses can be downloaded.');
  }
  if (url.username || url.password) {
    throw new FetchError('invalid_url', 'Addresses with a user name can’t be downloaded.');
  }
  return url;
}

/** The address to connect to: every address of the host must be allowed. */
async function checkedAddress(url: URL, policy: FetchPolicy): Promise<Address> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host);
  let addresses: Address[];
  if (literal) addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  else {
    try {
      addresses = await policy.resolve(host);
    } catch {
      addresses = [];
    }
    if (!addresses.length) throw new FetchError('unresolved', 'That website couldn’t be found.');
  }
  // All of them, so a name with one public and one internal address can't slip through.
  if (addresses.some((a) => !policy.allowed(a.address, a.family))) {
    throw new FetchError('blocked', 'Images can only be downloaded from public websites.');
  }
  return addresses[0]!;
}

function request(url: URL, target: Address, deadline: number): Promise<IncomingMessage> {
  // Connect to the checked address; the host name still goes in the Host header and to TLS.
  const pinned: LookupFunction = (_host, options, callback) => {
    if ((options as { all?: boolean }).all) {
      (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address: target.address, family: target.family },
      ]);
    } else callback(null, target.address, target.family);
  };
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new FetchError('timeout', 'The website took too long to answer.'));
      return;
    }
    const req = client.request(
      url,
      {
        method: 'GET',
        lookup: pinned,
        headers: {
          accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
          'user-agent': 'Memora (image download)',
        },
        timeout: remaining,
      },
      resolve,
    );
    req.on('timeout', () =>
      req.destroy(new FetchError('timeout', 'The website took too long to answer.')),
    );
    req.on('error', (error) =>
      reject(
        error instanceof FetchError
          ? error
          : new FetchError('network', 'The website couldn’t be reached.'),
      ),
    );
    req.end();
  });
}

function readBody(response: IncomingMessage, maxBytes: number, deadline: number): Promise<Buffer> {
  const tooLarge = () =>
    new FetchError('too_large', `Images can be up to ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const declared = Number(response.headers['content-length'] ?? 0);
  if (declared > maxBytes) {
    response.destroy();
    return Promise.reject(tooLarge());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(
      () => response.destroy(new FetchError('timeout', 'The website took too long to answer.')),
      Math.max(0, deadline - Date.now()),
    );
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    response.on('error', (error) => {
      clearTimeout(timer);
      reject(
        error instanceof FetchError
          ? error
          : new FetchError('network', 'The download was interrupted.'),
      );
    });
    response.on('close', () => {
      clearTimeout(timer);
      if (!response.complete) {
        reject(
          (response.errored as Error | null) instanceof FetchError
            ? response.errored
            : new FetchError('network', 'The download was interrupted.'),
        );
      }
    });
  });
}

/** `photo.jpg` from `…/photo.jpg?w=800`; the extension follows the real type. */
function nameFrom(url: URL, mime: string): string {
  let last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    // Keep it as it is.
  }
  const base =
    last
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .replace(/[^\p{L}\p{N} ._-]/gu, '')
      .trim()
      .slice(0, 100) || 'image';
  return `${base}.${EXTENSIONS[mime] ?? 'img'}`;
}

/** At most a few downloads at once, so pasting a long web page can't flood the server's memory. */
export class Limiter {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    // A finished task hands its place straight to the next one waiting.
    if (this.running >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    else this.running++;
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}
