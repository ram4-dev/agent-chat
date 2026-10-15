import { describe, expect, it } from 'vitest';
import {
  AUTH_PATHS,
  DOMAIN_ERROR_CODES,
} from '@agent-chat/contracts';
import {
  loadSession,
  loginAccount,
  logout,
  registerAccount,
  type JsonFetch,
  type JsonFetchInit,
} from '../../apps/web/src/features/auth/session';

const USER = {
  id: 'user-1',
  email: 'person@example.com',
  displayName: 'Ada Lovelace',
  createdAt: '2026-01-01T00:00:00.000Z',
};

interface Call {
  url: string;
  init: JsonFetchInit | undefined;
}

/** Records every call so the tests can assert the transport shape. */
function fakeFetch(
  responses: Array<{ status: number; body: unknown }>,
): { calls: Call[]; fetch: JsonFetch } {
  const calls: Call[] = [];
  let index = 0;

  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const response = responses[Math.min(index, responses.length - 1)]!;
      index += 1;
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body,
      };
    },
  };
}

describe('loadSession', () => {
  it('reads the session from the shared path and projects the user', async () => {
    const client = fakeFetch([{ status: 200, body: { user: USER } }]);

    await expect(loadSession(client.fetch)).resolves.toEqual({
      status: 'authenticated',
      user: USER,
    });
    expect(client.calls.map((call) => call.url)).toEqual([AUTH_PATHS.me]);
  });

  it('treats 401 as anonymous rather than as a failure', async () => {
    const client = fakeFetch([{ status: 401, body: { error: { code: 'unauthenticated' } } }]);

    await expect(loadSession(client.fetch)).resolves.toEqual({ status: 'anonymous' });
  });

  it('reports a server error as unknown instead of anonymous', async () => {
    const client = fakeFetch([{ status: 500, body: { error: { code: 'temporarily_unavailable' } } }]);

    await expect(loadSession(client.fetch)).resolves.toEqual({
      status: 'error',
      httpStatus: 500,
    });
  });

  it('reports an unreachable server without throwing', async () => {
    const fetchImpl: JsonFetch = () => Promise.reject(new Error('offline'));

    await expect(loadSession(fetchImpl)).resolves.toEqual({ status: 'error', httpStatus: 0 });
  });

  it('rejects a body that is not the shared user shape', async () => {
    const client = fakeFetch([{ status: 200, body: { user: { id: 'user-1' } } }]);

    await expect(loadSession(client.fetch)).resolves.toEqual({
      status: 'error',
      httpStatus: 200,
    });
  });
});

describe('registerAccount and loginAccount', () => {
  it('posts JSON to the shared register path and returns the session', async () => {
    const client = fakeFetch([{ status: 201, body: { user: USER } }]);

    await expect(
      registerAccount(
        { email: USER.email, displayName: USER.displayName, password: 'a-long-password' },
        client.fetch,
      ),
    ).resolves.toEqual({ status: 'authenticated', user: USER });

    expect(client.calls[0]!.url).toBe(AUTH_PATHS.register);
    expect(client.calls[0]!.init?.method).toBe('POST');
    expect(client.calls[0]!.init?.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(client.calls[0]!.init?.body ?? '{}')).toEqual({
      email: USER.email,
      displayName: USER.displayName,
      password: 'a-long-password',
    });
  });

  it('surfaces the shared rejection code instead of the raw message', async () => {
    const client = fakeFetch([
      { status: 409, body: { error: { code: DOMAIN_ERROR_CODES.conflict, message: 'internal detail' } } },
    ]);

    const state = await loginAccount({ email: USER.email, password: 'x' }, client.fetch);

    expect(state).toEqual({ status: 'rejected', code: DOMAIN_ERROR_CODES.conflict });
    expect(JSON.stringify(state)).not.toContain('internal detail');
  });

  it('never puts the password in the URL', async () => {
    const client = fakeFetch([{ status: 200, body: { user: USER } }]);

    await loginAccount({ email: USER.email, password: 'a-secret-value' }, client.fetch);

    expect(client.calls[0]!.url).toBe(AUTH_PATHS.login);
    expect(client.calls[0]!.url).not.toContain('a-secret-value');
  });

  it('reports unreachable as an error rather than a rejection', async () => {
    const fetchImpl: JsonFetch = () => Promise.reject(new Error('offline'));

    await expect(
      loginAccount({ email: USER.email, password: 'a-long-password' }, fetchImpl),
    ).resolves.toEqual({ status: 'error', httpStatus: 0 });
  });
});

describe('logout', () => {
  it('posts to the shared logout path', async () => {
    const client = fakeFetch([{ status: 200, body: { status: 'ok' } }]);

    await logout(client.fetch);

    expect(client.calls[0]!.url).toBe(AUTH_PATHS.logout);
    expect(client.calls[0]!.init?.method).toBe('POST');
  });

  it('swallows a transport failure so signing out never appears to fail', async () => {
    const fetchImpl: JsonFetch = () => Promise.reject(new Error('offline'));

    await expect(logout(fetchImpl)).resolves.toBeUndefined();
  });
});
