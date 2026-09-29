/**
 * Where to go after logging in, from `?redirect=`: only a path in this app. Never a full
 * URL, `//other.site` or `/\other.site` (browsers read both as another site): no open
 * redirects.
 */
export const safeRedirect = (value: unknown): string | undefined =>
  typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : undefined;
