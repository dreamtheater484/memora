/*
 * This browser's id, made once and kept in local storage. Requests carry it so the server
 * doesn't echo a browser's own changes back to it; its tabs tell each other directly.
 */

const KEY = 'memora.device';
let cached: string | null | undefined;

function make(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The id, or null where local storage is blocked (then there's no echo to avoid either). */
export function deviceId(): string | null {
  if (cached !== undefined) return cached;
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[\w-]{8,64}$/.test(id)) {
      id = make();
      localStorage.setItem(KEY, id);
    }
    cached = id;
  } catch {
    cached = null;
  }
  return cached;
}
