import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, api, errorMessage, setCsrfToken, setSessionEvents } from './api';

const fetchMock = vi.fn<typeof fetch>();

const reply = (status: number, body?: unknown) =>
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );

const lastRequest = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url, init: init!, headers: init!.headers as Record<string, string> };
};

describe('api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken(null);
    setSessionEvents({});
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('calls /api/v1 and returns the JSON body', async () => {
    reply(200, { ok: true });
    await expect(api('GET', '/auth/me')).resolves.toEqual({ ok: true });
    expect(lastRequest().url).toBe('/api/v1/auth/me');
    expect(lastRequest().init.credentials).toBe('same-origin');
  });

  it('sends the CSRF token on changes, never on reads', async () => {
    setCsrfToken('token-1');
    reply(200, {});
    await api('GET', '/auth/sessions');
    expect(lastRequest().headers['x-csrf-token']).toBeUndefined();

    reply(200, {});
    await api('POST', '/auth/logout');
    expect(lastRequest().headers['x-csrf-token']).toBe('token-1');
  });

  it('sends a body as JSON', async () => {
    reply(200, {});
    await api('PATCH', '/auth/me', { displayName: 'Sam' });
    expect(lastRequest().headers['Content-Type']).toBe('application/json');
    expect(lastRequest().init.body).toBe('{"displayName":"Sam"}');
  });

  it('returns nothing for 204', async () => {
    reply(204);
    await expect(api('DELETE', '/auth/sessions/s1')).resolves.toBeUndefined();
  });

  it('turns error bodies into errors with per-field messages', async () => {
    reply(400, {
      error: {
        code: 'weak_password',
        message: 'Choose a stronger password.',
        details: { fields: { newPassword: 'Too common.' } },
      },
    });
    const error = await api('POST', '/auth/password', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 400,
      code: 'weak_password',
      message: 'Choose a stronger password.',
      fields: { newPassword: 'Too common.' },
    });
  });

  it('reports a response that is not an API error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api('GET', '/auth/me')).rejects.toMatchObject({ status: 502, code: 'internal' });
  });

  it('reports a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api('GET', '/auth/me')).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('tells the app when the session is gone or needs a new password', async () => {
    const onSignedOut = vi.fn();
    const onPasswordChangeRequired = vi.fn();
    setSessionEvents({ onSignedOut, onPasswordChangeRequired });

    reply(401, { error: { code: 'unauthenticated', message: 'Log in first.' } });
    await expect(api('GET', '/auth/sessions')).rejects.toThrow();
    expect(onSignedOut).toHaveBeenCalledOnce();

    reply(403, { error: { code: 'password_change_required', message: 'Choose one.' } });
    await expect(api('GET', '/auth/sessions')).rejects.toThrow();
    expect(onPasswordChangeRequired).toHaveBeenCalledOnce();
  });

  it('answers a wrong password on the form, without signing out', async () => {
    const onSignedOut = vi.fn();
    setSessionEvents({ onSignedOut });
    reply(401, { error: { code: 'invalid_credentials', message: 'Wrong username or password.' } });
    await expect(api('POST', '/auth/login', {})).rejects.toThrow('Wrong username or password.');
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});

describe('errorMessage', () => {
  it('shows API messages, and a generic one for anything else', () => {
    expect(errorMessage(new ApiRequestError(409, 'conflict', 'Taken.'))).toBe('Taken.');
    expect(errorMessage(new Error('internal detail'))).toBe('Something went wrong. Try again.');
  });
});
