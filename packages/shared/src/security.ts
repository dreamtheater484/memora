/*
 * Security headers (§11, Phase 12), in one place: the server sends them, and the web app's
 * test server sends the same, so every end-to-end test runs under the real policy. No imports:
 * the web app's build configuration reads this file directly.
 */

/**
 * What a Memora page may load. Scripts only from Memora itself (no inline scripts, no eval):
 * even if some note content got past the sanitiser, it could not run. Styles may be inline
 * (the editors and KaTeX set them on elements). Images may come from HTTPS sites: an image
 * pasted from a website stays linked when the server couldn't download it.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  // The print preview is a frame of Memora's own.
  "frame-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** API answers are data, never pages: nothing in them may load or run anything. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/** Sent with every answer. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  // Links to other sites don't tell them which page of Memora they came from.
  'Referrer-Policy': 'no-referrer',
  // For browsers from before `frame-ancestors`.
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
};

/** Over HTTPS: browsers keep to HTTPS for this host for a year. */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000';
