/**
 * Identity and session policy shared by the server, the web client, and the
 * tests.
 *
 * The approved limits table (`LIMITS`) covers messages, pages, sockets, and
 * OAuth tokens. Session lifetime, password length, display name, and e-mail
 * bounds come from the approved "OAuth and session details" section, so they
 * live in their own exported object instead of being folded into that table.
 * This module is the only place any of these numbers is written down.
 */
export const AUTH_LIMITS = {
  /** A human session expires after this much inactivity; every use extends it. */
  HUMAN_SESSION_INACTIVITY_SECONDS: 8 * 60 * 60,
  /** Bounded password length, checked before hashing so hashing stays cheap. */
  PASSWORD_MIN_LENGTH: 12,
  PASSWORD_MAX_LENGTH: 128,
  /** Bounded display name, matching the non-empty check constraint in SQLite. */
  DISPLAY_NAME_MAX_LENGTH: 80,
  /** RFC 5321 practical maximum for an e-mail address. */
  EMAIL_MAX_LENGTH: 254,
} as const;

export type AuthLimits = typeof AUTH_LIMITS;

/**
 * Result of validating untrusted input against the shared contracts.
 *
 * `reason` is an ASCII tag for logs and tests. It is deliberately never sent on
 * the wire: adapters answer with a stable error code only, so a rejected body
 * cannot describe why it was rejected.
 */
export interface ParseOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ParseError {
  readonly ok: false;
  readonly reason: string;
}

export type Parsed<T> = ParseOk<T> | ParseError;

/**
 * Deliberately permissive: the server lowercases and length-bounds the address,
 * and the unique index — not a regular expression — decides whether it is
 * already taken. A stricter pattern would reject valid addresses.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Lowercase normalization is part of the storage contract: `users.email` is unique. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateEmail(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'email:not_text' };
  }

  const email = normalizeEmail(raw);
  if (email === '') {
    return { ok: false, reason: 'email:required' };
  }
  if (email.length > AUTH_LIMITS.EMAIL_MAX_LENGTH) {
    return { ok: false, reason: 'email:too_long' };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, reason: 'email:invalid_format' };
  }

  return { ok: true, value: email };
}

export function validateDisplayName(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'displayName:not_text' };
  }

  const displayName = raw.trim();
  if (displayName === '') {
    return { ok: false, reason: 'displayName:required' };
  }
  if (displayName.length > AUTH_LIMITS.DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, reason: 'displayName:too_long' };
  }

  return { ok: true, value: displayName };
}

/**
 * Registration-only password policy.
 *
 * Passwords are never trimmed: surrounding spaces are legitimate characters.
 * Length is the only rule, because composition rules push people towards
 * predictable passwords.
 */
export function validatePassword(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'password:not_text' };
  }
  if (raw === '') {
    return { ok: false, reason: 'password:required' };
  }
  if (raw.length < AUTH_LIMITS.PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: 'password:too_short' };
  }
  if (raw.length > AUTH_LIMITS.PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: 'password:too_long' };
  }

  return { ok: true, value: raw };
}

/**
 * Login passwords are only bound by the maximum length.
 *
 * Tightening the registration policy must never lock out an account that
 * already exists, so login checks shape and never composition.
 */
export function validatePasswordShape(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'password:not_text' };
  }
  if (raw === '') {
    return { ok: false, reason: 'password:required' };
  }
  if (raw.length > AUTH_LIMITS.PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: 'password:too_long' };
  }

  return { ok: true, value: raw };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
