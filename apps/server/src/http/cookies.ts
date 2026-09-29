/** Minimal cookie parsing and serialising: all Memora needs is its one session cookie. */

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

export interface CookieOptions {
  /** Seconds; omit for a browser-session cookie, 0 to delete. */
  maxAge?: number;
  secure: boolean;
}

/** `Path=/`, `HttpOnly` and `SameSite=Lax` always (§11). Values must be cookie-safe already. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) parts.push('Secure');
  if (options.maxAge !== undefined)
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  return parts.join('; ');
}
