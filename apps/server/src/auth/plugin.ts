import { CSRF_HEADER } from '@memora/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { ApiError } from '../errors';
import { parseCookies, serializeCookie } from '../http/cookies';
import type { AuthContext, AuthService, RequestMeta } from './service';
import { RateLimit } from './throttle';
import { csrfTokenFor, safeEqual } from './tokens';

/**
 * Who may call a route. Every `/api/` route must declare one; the server refuses to start
 * otherwise, so nothing is ever public by accident.
 * - `public`: anyone (health, login, setup, the session check).
 * - `user`: a signed-in user, with a CSRF token on requests that change data.
 * - `admin`: a signed-in admin, likewise.
 */
export type Access = 'public' | 'user' | 'admin';

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
    /** Reachable while the user still has to replace a temporary password. */
    allowPendingPasswordChange?: boolean;
    /** Reachable while two-step verification is required and not set up yet. */
    allowPendingTwoFactor?: boolean;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

/** `__Host-` binds the cookie to this exact origin; browsers require `Secure` for it (§11). */
const SECURE_COOKIE = '__Host-memora_session';
/** Fallback on plain-HTTP origins (before HTTPS is set up), where `Secure` cookies are refused. */
const PLAIN_COOKIE = 'memora_session';
const LOCALHOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The API-wide limit (§11): generous enough for autosave from several tabs and devices. */
const API_REQUESTS_PER_MINUTE = 1200;

export function requestMeta(request: FastifyRequest): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

export function registerAuth(
  app: FastifyInstance,
  auth: AuthService,
  config: Config,
  now: () => number,
): void {
  const baseOrigin = config.baseUrl ? new URL(config.baseUrl).origin : undefined;
  const apiLimit = new RateLimit(API_REQUESTS_PER_MINUTE, 60_000, now);
  let warnedPlainHttp = false;

  // Browsers keep Secure cookies on http://127.0.0.1 and http://localhost; Android's WebView
  // doesn't, so the Android app gets the plain one there.
  const isSecure = (request: FastifyRequest) =>
    request.protocol === 'https' ||
    baseOrigin?.startsWith('https:') === true ||
    (LOCALHOSTS.has(request.hostname) && config.desktop?.shell !== 'android');

  function sessionToken(request: FastifyRequest): string | undefined {
    const cookies = parseCookies(request.headers.cookie);
    return cookies.get(SECURE_COOKIE) ?? cookies.get(PLAIN_COOKIE);
  }

  app.decorateRequest('auth', null);

  const apiRoutes: ApiRoute[] = [];
  app.decorate('apiRoutes', apiRoutes);
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/')) return;
    const access = route.config?.access;
    if (!access) {
      throw new Error(`${String(route.method)} ${route.url} must declare config.access`);
    }
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') apiRoutes.push({ method, url: route.url, access });
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const { access, allowPendingPasswordChange, allowPendingTwoFactor } =
      request.routeOptions.config;
    const unsafe = !SAFE_METHODS.has(request.method);

    if (access && request.url !== '/api/health') {
      const wait = apiLimit.hit(request.ip);
      if (wait > 0) {
        throw new ApiError(429, 'too_many_requests', 'Too many requests. Slow down a little.', {
          retryAfter: Math.ceil(wait / 1000),
        });
      }
    }

    if (unsafe) checkOrigin(request, baseOrigin);

    const token = sessionToken(request);
    if (token) {
      const context = auth.resolve(token);
      if (context) {
        request.auth = context;
        if (context.renewed && context.session.remember) {
          setSessionCookie(request, reply, context);
        }
      } else {
        clearSessionCookie(reply);
      }
    }

    if (!access || access === 'public') return;
    const current = request.auth;
    if (!current) throw new ApiError(401, 'unauthenticated', 'Please log in.');
    if (unsafe) {
      const sent = request.headers[CSRF_HEADER];
      if (typeof sent !== 'string' || !safeEqual(sent, csrfTokenFor(current.token))) {
        throw new ApiError(403, 'csrf_failed', 'Your session changed. Reload the page.');
      }
    }
    if (current.user.mustChangePassword && !allowPendingPasswordChange) {
      throw new ApiError(
        403,
        'password_change_required',
        'Choose a new password before you continue.',
      );
    }
    if (!allowPendingTwoFactor && auth.twoFactor.mustSetUp(current.user)) {
      throw new ApiError(
        403,
        'two_factor_required',
        'Set up two-step verification before you continue.',
      );
    }
    if (access === 'admin' && current.user.role !== 'admin') {
      throw new ApiError(403, 'forbidden', 'Only administrators can do this.');
    }
  });

  // Responses about accounts and sessions must never be cached by the browser or a proxy.
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) {
      reply.header('Cache-Control', 'no-store');
    }
  });

  function setSessionCookie(
    request: FastifyRequest,
    reply: FastifyReply,
    context: Pick<AuthContext, 'session' | 'token'>,
  ): void {
    const secure = isSecure(request);
    if (!secure && !warnedPlainHttp) {
      warnedPlainHttp = true;
      request.log.warn(
        'signing in over plain HTTP: the session cookie can be read on the network. Set up HTTPS (see docs/SETUP.md).',
      );
    }
    const { session, token } = context;
    const maxAge = session.remember ? (session.expiresAt - now()) / 1000 : undefined;
    reply.header('set-cookie', [
      serializeCookie(secure ? SECURE_COOKIE : PLAIN_COOKIE, token, {
        secure,
        ...(maxAge === undefined ? {} : { maxAge }),
      }),
      // Drop a leftover cookie of the other kind (for example from before HTTPS was set up).
      serializeCookie(secure ? PLAIN_COOKIE : SECURE_COOKIE, '', { secure: !secure, maxAge: 0 }),
    ]);
  }

  function clearSessionCookie(reply: FastifyReply): void {
    reply.header('set-cookie', [
      serializeCookie(SECURE_COOKIE, '', { secure: true, maxAge: 0 }),
      serializeCookie(PLAIN_COOKIE, '', { secure: false, maxAge: 0 }),
    ]);
  }

  app.decorate('sessionCookies', { set: setSessionCookie, clear: clearSessionCookie });
}

export interface ApiRoute {
  method: string;
  url: string;
  access: Access;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Every API route with its access policy; the cross-user tests walk this list. */
    apiRoutes: readonly ApiRoute[];
    sessionCookies: {
      set(
        request: FastifyRequest,
        reply: FastifyReply,
        context: Pick<AuthContext, 'session' | 'token'>,
      ): void;
      clear(reply: FastifyReply): void;
    };
  }
}

/**
 * CSRF defence in depth (§11): a request that changes data must come from Memora's own origin.
 * Browsers always send `Origin` on such requests; tools like curl send none (and no cookies of
 * yours), so a missing header is judged by `Sec-Fetch-Site` when present. `required` refuses a
 * missing header too: browsers always send one when opening a WebSocket.
 */
export function checkOrigin(
  request: FastifyRequest,
  baseOrigin: string | undefined,
  required = false,
): void {
  const origin = request.headers.origin;
  if (!origin && required) {
    throw new ApiError(403, 'forbidden', 'Requests from other sites are not allowed.');
  }
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      host = '';
    }
    if (origin === baseOrigin || (host !== '' && host === request.headers.host)) return;
    throw new ApiError(403, 'forbidden', 'Requests from other sites are not allowed.');
  }
  const site = request.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new ApiError(403, 'forbidden', 'Requests from other sites are not allowed.');
  }
}
