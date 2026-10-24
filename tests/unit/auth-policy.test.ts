import { describe, expect, it } from 'vitest';
import {
  AUTH_LIMITS,
  normalizeEmail,
  parseLoginRequest,
  parseRegisterRequest,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '@agent-chat/contracts';

describe('normalizeEmail', () => {
  it('lowercases and trims so one person maps to one stored address', () => {
    expect(normalizeEmail('  Person@Example.COM ')).toBe('person@example.com');
  });
});

describe('validateEmail', () => {
  it('accepts an address and returns its normalized form', () => {
    expect(validateEmail('Person@Example.com')).toEqual({
      ok: true,
      value: 'person@example.com',
    });
  });

  it.each([
    ['', 'email:required'],
    ['   ', 'email:required'],
    ['person', 'email:invalid_format'],
    ['person@example', 'email:invalid_format'],
    ['person @example.com', 'email:invalid_format'],
    ['@example.com', 'email:invalid_format'],
  ])('rejects %j with the reason %s', (raw, reason) => {
    expect(validateEmail(raw)).toEqual({ ok: false, reason });
  });

  it('rejects a non-string body value', () => {
    expect(validateEmail(42)).toEqual({ ok: false, reason: 'email:not_text' });
  });

  it('rejects an address longer than the shared bound', () => {
    const tooLong = `${'a'.repeat(AUTH_LIMITS.EMAIL_MAX_LENGTH)}@example.com`;

    expect(validateEmail(tooLong)).toEqual({ ok: false, reason: 'email:too_long' });
  });
});

describe('validateDisplayName', () => {
  it('accepts a name and trims the surrounding whitespace', () => {
    expect(validateDisplayName('  Ada Lovelace  ')).toEqual({
      ok: true,
      value: 'Ada Lovelace',
    });
  });

  it.each([
    ['', 'displayName:required'],
    ['   ', 'displayName:required'],
  ])('rejects %j because the database requires a non-empty name', (raw, reason) => {
    expect(validateDisplayName(raw)).toEqual({ ok: false, reason });
  });

  it('rejects a name longer than the shared bound', () => {
    const tooLong = 'n'.repeat(AUTH_LIMITS.DISPLAY_NAME_MAX_LENGTH + 1);

    expect(validateDisplayName(tooLong)).toEqual({
      ok: false,
      reason: 'displayName:too_long',
    });
  });

  it('accepts a name exactly at the shared bound', () => {
    const atBound = 'n'.repeat(AUTH_LIMITS.DISPLAY_NAME_MAX_LENGTH);

    expect(validateDisplayName(atBound)).toEqual({ ok: true, value: atBound });
  });

  it('rejects a non-string body value', () => {
    expect(validateDisplayName(null)).toEqual({ ok: false, reason: 'displayName:not_text' });
  });
});

describe('validatePassword', () => {
  it('accepts a password at the minimum length and keeps it verbatim', () => {
    const password = 'p'.repeat(AUTH_LIMITS.PASSWORD_MIN_LENGTH);

    expect(validatePassword(password)).toEqual({ ok: true, value: password });
  });

  it('keeps leading and trailing spaces inside a password', () => {
    const password = `  ${'p'.repeat(AUTH_LIMITS.PASSWORD_MIN_LENGTH)}  `;

    expect(validatePassword(password)).toEqual({ ok: true, value: password });
  });

  it('rejects a password below the minimum length', () => {
    const short = 'p'.repeat(AUTH_LIMITS.PASSWORD_MIN_LENGTH - 1);

    expect(validatePassword(short)).toEqual({ ok: false, reason: 'password:too_short' });
  });

  it('reports an empty password as required', () => {
    expect(validatePassword('')).toEqual({ ok: false, reason: 'password:required' });
  });

  it('rejects a password above the maximum length', () => {
    const tooLong = 'p'.repeat(AUTH_LIMITS.PASSWORD_MAX_LENGTH + 1);

    expect(validatePassword(tooLong)).toEqual({ ok: false, reason: 'password:too_long' });
  });
});

describe('parseRegisterRequest', () => {
  it('returns the normalized registration the modules accept', () => {
    const parsed = parseRegisterRequest({
      email: ' Person@Example.com ',
      displayName: ' Ada ',
      password: 'correct horse battery staple',
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        email: 'person@example.com',
        displayName: 'Ada',
        password: 'correct horse battery staple',
      },
    });
  });

  it('reports the first offending field', () => {
    expect(parseRegisterRequest({ email: 'nope', displayName: 'Ada', password: 'short' })).toEqual({
      ok: false,
      reason: 'email:invalid_format',
    });
  });

  it.each([
    [undefined],
    [null],
    ['not an object'],
    [[]],
    [{}],
  ])('rejects the body %j', (body) => {
    expect(parseRegisterRequest(body).ok).toBe(false);
  });
});

describe('parseLoginRequest', () => {
  it('returns the normalized credentials', () => {
    expect(parseLoginRequest({ email: 'Person@Example.com', password: 'a'.repeat(9) })).toEqual({
      ok: true,
      value: { email: 'person@example.com', password: 'a'.repeat(9) },
    });
  });

  it('accepts a short password because the policy belongs to registration only', () => {
    expect(parseLoginRequest({ email: 'person@example.com', password: 'short' })).toEqual({
      ok: true,
      value: { email: 'person@example.com', password: 'short' },
    });
  });

  it('rejects a missing password', () => {
    expect(parseLoginRequest({ email: 'person@example.com' })).toEqual({
      ok: false,
      reason: 'password:not_text',
    });
  });

  it('rejects a body that is not an object', () => {
    expect(parseLoginRequest('nope')).toEqual({ ok: false, reason: 'body:not_object' });
  });
});
