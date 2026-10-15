import { createHash, randomBytes } from 'node:crypto';
import { AUTH_LIMITS } from '@agent-chat/contracts';

/** A stored session row, exactly as the `human_sessions` table holds it. */
export interface SessionRecord {
  /** SHA-256 of the token handed to the browser; the token itself is never stored. */
  id: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface SessionRepository {
  insert(session: SessionRecord): void;
  findById(id: string): SessionRecord | undefined;
  /** Extends the inactivity window of an existing session. */
  touch(id: string, expiresAt: string): void;
  revoke(id: string, revokedAt: string): void;
}

/** Bytes of entropy behind a session token. */
const SESSION_TOKEN_BYTES = 32;

/** Base64url of 32 random bytes is 43 characters; anything else is not ours. */
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Mints an opaque session token.
 *
 * The token is random and meaningless: it carries no user id, no claims, and no
 * expiry, so a leaked token cannot be read and a revoked token cannot be
 * resurrected by editing it. Only its hash reaches the database.
 */
export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/**
 * Derives the stored session identifier from a presented token.
 *
 * Hashing means a database read is never a credential read: the value in
 * `human_sessions.id` cannot be replayed as a cookie.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Shape check applied before hashing.
 *
 * Rejecting a malformed token here keeps arbitrary bytes out of the lookup and
 * makes a storage-probing token impossible.
 */
export function isPlausibleSessionToken(token: string): boolean {
  return SESSION_TOKEN_PATTERN.test(token);
}

/** Expiry of a session that has just been used, from the shared inactivity window. */
export function sessionExpiryFrom(now: Date): string {
  return new Date(now.getTime() + AUTH_LIMITS.HUMAN_SESSION_INACTIVITY_SECONDS * 1000).toISOString();
}

/** Whether a stored session is currently usable. */
export function isSessionUsable(session: SessionRecord, now: Date): boolean {
  if (session.revokedAt !== null) {
    return false;
  }
  return Date.parse(session.expiresAt) > now.getTime();
}
