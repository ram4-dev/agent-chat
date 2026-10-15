import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@agent-chat/contracts';
import {
  clearedSessionCookie,
  readCookie,
  serializeSessionCookie,
} from '../../apps/server/src/adapters/http/cookie';
import { isSameOriginRequest } from '../../apps/server/src/adapters/http/origin-guard';

describe('serializeSessionCookie', () => {
  it('writes the exact attributes a browser session needs', () => {
    expect(
      serializeSessionCookie(SESSION_COOKIE_NAME, 'opaque-token', {
        secure: false,
        maxAgeSeconds: 28_800,
      }),
    ).toBe('agent_chat_session=opaque-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800');
  });

  it('adds Secure for anything that is not a local environment', () => {
    expect(
      serializeSessionCookie(SESSION_COOKIE_NAME, 'opaque-token', {
        secure: true,
        maxAgeSeconds: 28_800,
      }),
    ).toBe(
      'agent_chat_session=opaque-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure',
    );
  });

  it('defaults to Secure when the caller says nothing', () => {
    expect(serializeSessionCookie(SESSION_COOKIE_NAME, 'opaque-token')).toContain('; Secure');
  });

  it('omits Max-Age when no lifetime is given', () => {
    expect(serializeSessionCookie(SESSION_COOKIE_NAME, 'opaque-token', { secure: false })).toBe(
      'agent_chat_session=opaque-token; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  it.each([['a;b'], ['a b'], ['a\nb'], ['a,b'], ['a"b']])(
    'refuses the unsafe value %j instead of writing a broken header',
    (value) => {
      expect(() =>
        serializeSessionCookie(SESSION_COOKIE_NAME, value, { secure: false }),
      ).toThrowError(TypeError);
    },
  );

  it('refuses to write a cookie under an unsafe name', () => {
    expect(() => serializeSessionCookie('bad name', 'value')).toThrowError(TypeError);
  });
});

describe('clearedSessionCookie', () => {
  it('expires the cookie immediately so the browser drops it', () => {
    expect(clearedSessionCookie(SESSION_COOKIE_NAME, { secure: false })).toBe(
      'agent_chat_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
  });

  it('adds Secure for anything that is not a local environment', () => {
    expect(clearedSessionCookie(SESSION_COOKIE_NAME, { secure: true })).toContain('; Secure');
  });
});

describe('readCookie', () => {
  it('finds the session cookie among other cookies', () => {
    expect(
      readCookie('theme=dark; agent_chat_session=opaque-token; locale=en', SESSION_COOKIE_NAME),
    ).toBe('opaque-token');
  });

  it('returns undefined when the cookie is absent', () => {
    expect(readCookie('theme=dark; locale=en', SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('returns undefined when the request carries no cookie header', () => {
    expect(readCookie(undefined, SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('does not mistake a longer cookie name for the session cookie', () => {
    expect(readCookie('agent_chat_session_backup=other', SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('returns an empty value rather than guessing', () => {
    expect(readCookie('agent_chat_session=', SESSION_COOKIE_NAME)).toBe('');
  });
});

describe('isSameOriginRequest', () => {
  it('lets read-only requests through without an Origin header', () => {
    expect(
      isSameOriginRequest({ method: 'GET', origin: undefined, host: 'example.test' }),
    ).toBe(true);
  });

  it('accepts a state-changing request from the same origin', () => {
    expect(
      isSameOriginRequest({
        method: 'POST',
        origin: 'http://127.0.0.1:4318',
        host: '127.0.0.1:4318',
      }),
    ).toBe(true);
  });

  it('rejects a state-changing request that carries no Origin header', () => {
    expect(isSameOriginRequest({ method: 'POST', origin: undefined, host: 'example.test' })).toBe(
      false,
    );
  });

  it('rejects a state-changing request from another origin', () => {
    expect(
      isSameOriginRequest({
        method: 'POST',
        origin: 'https://evil.test',
        host: '127.0.0.1:4318',
      }),
    ).toBe(false);
  });

  it('rejects a different port on the same host', () => {
    expect(
      isSameOriginRequest({
        method: 'POST',
        origin: 'http://127.0.0.1:9999',
        host: '127.0.0.1:4318',
      }),
    ).toBe(false);
  });

  it('rejects a request the browser already labelled cross-site', () => {
    expect(
      isSameOriginRequest({
        method: 'POST',
        origin: 'http://127.0.0.1:4318',
        host: '127.0.0.1:4318',
        secFetchSite: 'cross-site',
      }),
    ).toBe(false);
  });

  it.each([['null'], ['file:///etc/passwd'], ['not a url'], ['']])(
    'rejects the unusable Origin %j',
    (origin) => {
      expect(isSameOriginRequest({ method: 'POST', origin, host: 'example.test' })).toBe(false);
    },
  );

  it('rejects a state-changing request with no host to compare against', () => {
    expect(
      isSameOriginRequest({ method: 'POST', origin: 'http://example.test', host: undefined }),
    ).toBe(false);
  });

  it('compares hosts case-insensitively', () => {
    expect(
      isSameOriginRequest({
        method: 'POST',
        origin: 'http://LOCALHOST:3000',
        host: 'localhost:3000',
      }),
    ).toBe(true);
  });

  it.each([['post'], ['DELETE'], ['patch']])('guards the method %s', (method) => {
    expect(isSameOriginRequest({ method, origin: undefined, host: 'example.test' })).toBe(false);
  });
});
