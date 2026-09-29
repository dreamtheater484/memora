import { CSRF_HEADER, isApiErrorBody, type ApiErrorCode } from '@memora/shared';

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

export type ApiErrorKind = ApiErrorCode | 'network';

export class ApiRequestError extends Error {
  override name = 'ApiRequestError';

  constructor(
    readonly status: number,
    readonly code: ApiErrorKind,
    message: string,
    /** Messages per form field, keyed by field name. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
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

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
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
  const error = new ApiRequestError(response.status, code, message, fields);

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
