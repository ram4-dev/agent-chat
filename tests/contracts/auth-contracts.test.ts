import { describe, expect, it } from 'vitest';
import {
  AUTH_LIMITS,
  AUTH_PATHS,
  DOMAIN_ERROR_CODES,
  SESSION_COOKIE_NAME,
} from '@agent-chat/contracts';
import { errorEnvelope } from '../../apps/server/src/adapters/http/index';
import { serializeSessionCookie } from '../../apps/server/src/adapters/http/cookie';
import { sessionExpiryFrom } from '../../apps/server/src/modules/auth/index';

describe('auth limits', () => {
  it('pins the session, password, display-name, and e-mail bounds', () => {
    expect(AUTH_LIMITS).toEqual({
      HUMAN_SESSION_INACTIVITY_SECONDS: 28_800,
      PASSWORD_MIN_LENGTH: 12,
      PASSWORD_MAX_LENGTH: 128,
      DISPLAY_NAME_MAX_LENGTH: 80,
      EMAIL_MAX_LENGTH: 254,
    });
  });

  it('keeps every auth bound in one exported object', () => {
    expect(Object.getOwnPropertyNames(AUTH_LIMITS)).toEqual([
      'HUMAN_SESSION_INACTIVITY_SECONDS',
      'PASSWORD_MIN_LENGTH',
      'PASSWORD_MAX_LENGTH',
      'DISPLAY_NAME_MAX_LENGTH',
      'EMAIL_MAX_LENGTH',
    ]);
  });
});

describe('auth paths and cookie name', () => {
  it('pins the single route table the server and the client share', () => {
    expect(AUTH_PATHS).toEqual({
      register: '/api/auth/register',
      login: '/api/auth/login',
      logout: '/api/auth/logout',
      me: '/api/auth/me',
    });
  });

  it('names exactly one session cookie', () => {
    expect(SESSION_COOKIE_NAME).toBe('agent_chat_session');
  });
});

describe('server consumption of the shared auth contracts', () => {
  it('builds the unauthenticated envelope from the shared code', () => {
    expect(errorEnvelope(DOMAIN_ERROR_CODES.unauthenticated)).toEqual({
      error: { code: 'unauthenticated' },
    });
  });

  it('takes the session deadline from the shared limit instead of a local copy', () => {
    const issuedAt = new Date('2026-01-01T00:00:00.000Z');

    expect(Date.parse(sessionExpiryFrom(issuedAt)) - issuedAt.getTime()).toBe(
      AUTH_LIMITS.HUMAN_SESSION_INACTIVITY_SECONDS * 1000,
    );
  });

  it('takes the cookie lifetime from the same shared limit', () => {
    const cookie = serializeSessionCookie(SESSION_COOKIE_NAME, 'opaque', {
      secure: false,
      maxAgeSeconds: AUTH_LIMITS.HUMAN_SESSION_INACTIVITY_SECONDS,
    });

    expect(cookie).toContain('Max-Age=28800');
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=opaque`)).toBe(true);
  });
});
