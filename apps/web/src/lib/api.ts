import { CSRF_HEADER, DEVICE_HEADER, isApiErrorBody, type ApiErrorCode } from '@memora/shared';
import { deviceId } from './device';

/**
 * The API client. Every request goes to `/api/v1`, sends the session's CSRF token when it
 * changes data (§11), and turns error responses into an `ApiRequestError` whose `fields`
 * can be shown next to form fields.
 */

let csrfToken: string | null = null;

/** Set from every response that carries a token (the session check, login, …). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export const hasCsrfToken = (): boolean => csrfToken !== null;

let csrfSource: (() => Promise<unknown>) | null = null;

/**
 * How to get a token when a change is about to go out without one: after starting offline,
 * the session check that brings it hasn't happened yet.
 */
export function setCsrfSource(source: (() => Promise<unknown>) | null): void {
  csrfSource = source;
}

export type ApiErrorKind = ApiErrorCode | 'network';

export class ApiRequestError extends Error {
  override name = 'ApiRequestError';

  constructor(
    readonly status: number,
    readonly code: ApiErrorKind,
    message: string,
    /** Messages per form field, keyed by field name. */
    readonly fields: Record<string, string> = {},
    /** Anything else the server said about the error (a conflict's current content, …). */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The request never got an answer from Memora itself: offline, or the server is down. */
export function isUnreachable(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)
  );
}

interface SessionEvents {
  /** The server no longer knows this session (expired, revoked, signed out elsewhere). */
  onSignedOut?: () => void;
  /** The server wants a new password before anything else. */
  onPasswordChangeRequired?: () => void;
}

let events: SessionEvents = {};

export function setSessionEvents(handlers: SessionEvents): void {
  events = handlers;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Options {
  /** Let the request finish even if the tab closes (only for small bodies). */
  keepalive?: boolean;
}

export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  options: Options = {},
): Promise<T> {
  if (method !== 'GET' && !csrfToken && csrfSource) await csrfSource().catch(() => undefined);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;
  const device = deviceId();
  if (device) headers[DEVICE_HEADER] = device;

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      ...(options.keepalive ? { keepalive: true } : {}),
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'Can’t reach Memora. Check your connection.');
  }

  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data as T;

  if (!isApiErrorBody(data)) {
    throw new ApiRequestError(
      response.status,
      'internal',
      `The server answered ${response.status}.`,
    );
  }
  const { code, message, details } = data.error;
  const fields = (details as { fields?: Record<string, string> } | undefined)?.fields ?? {};
  const error = new ApiRequestError(response.status, code, message, fields, details);

  // Login failures are answered on the form; anything else means the session is gone.
  if (code === 'unauthenticated') events.onSignedOut?.();
  if (code === 'password_change_required') events.onPasswordChangeRequired?.();
  throw error;
}

/** The message to show for any error thrown while calling the API. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Something went wrong. Try again.';
}
