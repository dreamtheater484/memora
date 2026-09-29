/**
 * UUIDv7 identifiers (RFC 9562): a 48-bit millisecond timestamp followed by random bits.
 *
 * They sort by creation time and can be generated on any device, which lets the web app
 * create pages while offline. Only `crypto.getRandomValues` is used, because
 * `crypto.randomUUID` is unavailable on plain-HTTP origins.
 */

interface RandomSource {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

const randomSource = (globalThis as unknown as { crypto: RandomSource }).crypto;

let lastTimestamp = -1;
let sequence = 0;

/**
 * Returns a new UUIDv7. IDs created by the same process are strictly increasing: within one
 * millisecond the 12-bit `rand_a` field acts as a counter (RFC 9562, method 1).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomSource.getRandomValues(new Uint8Array(16));

  let timestamp = now;
  if (timestamp <= lastTimestamp) {
    timestamp = lastTimestamp;
    sequence += 1;
    if (sequence > 0xfff) {
      // Counter exhausted: borrow the next millisecond to stay monotonic.
      timestamp += 1;
      sequence = (bytes[6]! & 0x07) << 8;
    }
  } else {
    // Start each millisecond low in the counter range so there is room to increment.
    sequence = ((bytes[6]! & 0x07) << 8) | bytes[7]!;
  }
  lastTimestamp = timestamp;

  // 48-bit big-endian timestamp.
  let t = timestamp;
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
  bytes[6] = 0x70 | (sequence >> 8); // version 7 + high 4 bits of the counter
  bytes[7] = sequence & 0xff;
  bytes[8] = 0x80 | (bytes[8]! & 0x3f); // RFC 9562 variant (10xx)

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isUuidV7 = (value: string): boolean => UUID_V7_PATTERN.test(value);

/** Extracts the creation time (ms since epoch) encoded in a UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  return Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
