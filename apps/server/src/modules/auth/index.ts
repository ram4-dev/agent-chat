import type { PublicUser } from '@agent-chat/contracts';
import { InvalidCredentialsError, SessionInvalidError } from '../identity/errors.js';
import type { IdentityModule } from '../identity/index.js';
import type { Clock } from '../identity/index.js';
import type { PasswordHasher } from './password.js';
import {
  createSessionToken,
  hashSessionToken,
  isPlausibleSessionToken,
  isSessionUsable,
  sessionExpiryFrom,
  type SessionRecord,
  type SessionRepository,
} from './session.js';

export interface AuthenticatedUser {
  user: PublicUser;
  /** The raw token for the caller to put in a cookie. Never logged or stored. */
  sessionToken: string;
}

export class ConfirmationRequiredError extends Error {
  constructor() { super('Confirm the account email before signing in'); }
}

export interface RegisterInput {
  email: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthModule {
  register(input: RegisterInput): Promise<AuthenticatedUser>;
  login(input: LoginInput): Promise<AuthenticatedUser>;
  /** Revokes the presented session. Unknown tokens succeed, so logout is idempotent. */
  logout(sessionToken: string | undefined): void;
  /** Resolves a session and slides its inactivity window forward. */
  currentUser(sessionToken: string | undefined): PublicUser;
  /** Resolves a session for a WebSocket handshake without extending it. */
  resolveSession(sessionToken: string | undefined): PublicUser;
}

export interface AuthModuleDependencies {
  identity: IdentityModule;
  sessions: SessionRepository;
  passwords: PasswordHasher;
  clock: Clock;
  /** Injectable so a test can pin the token it presented. */
  createToken?(): string;
}

/**
 * Owns registration, login, logout, and session validation.
 *
 * Login answers every failure identically, and registration relies on the
 * unique index instead of a pre-check, so neither path reveals whether an
 * address already exists. A successful hash comparison happens for unknown
 * accounts too, which keeps the timing of both answers comparable.
 */
export function createAuthModule({
  identity,
  sessions,
  passwords,
  clock,
  createToken = createSessionToken,
}: AuthModuleDependencies): AuthModule {
  function issueSession(userId: string): string {
    const now = clock.now();
    const token = createToken();
    sessions.insert({
      id: hashSessionToken(token),
      userId,
      expiresAt: sessionExpiryFrom(now),
      revokedAt: null,
      createdAt: now.toISOString(),
    });
    return token;
  }

  function loadUsableSession(sessionToken: string | undefined): SessionRecord {
    if (sessionToken === undefined || !isPlausibleSessionToken(sessionToken)) {
      throw new SessionInvalidError();
    }

    const session = sessions.findById(hashSessionToken(sessionToken));
    if (session === undefined || !isSessionUsable(session, clock.now())) {
      throw new SessionInvalidError();
    }

    return session;
  }

  function requireUser(userId: string): PublicUser {
    const user = identity.getCurrentUser(userId);
    if (user === undefined) {
      // A session whose account disappeared is not a usable session.
      throw new SessionInvalidError();
    }
    return user;
  }

  return {
    async register(input) {
      // Hashing happens before the insert so a duplicate registration costs the
      // same as a fresh one and cannot be distinguished by timing.
      const passwordHash = await passwords.hash(input.password);
      const user = identity.createUser({
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      });

      return {
        user: { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt },
        sessionToken: issueSession(user.id),
      };
    },

    async login(input) {
      const stored = identity.findByEmail(input.email);

      if (stored === undefined) {
        // Spend the comparison anyway so an unknown address is not faster.
        await passwords.verify(DUMMY_PASSWORD_HASH, input.password);
        throw new InvalidCredentialsError();
      }

      const matches = await passwords.verify(stored.passwordHash, input.password);
      if (!matches) {
        throw new InvalidCredentialsError();
      }

      const user = requireUser(stored.id);
      return { user, sessionToken: issueSession(stored.id) };
    },

    logout(sessionToken) {
      if (sessionToken === undefined || !isPlausibleSessionToken(sessionToken)) {
        return;
      }
      sessions.revoke(hashSessionToken(sessionToken), clock.now().toISOString());
    },

    currentUser(sessionToken) {
      const session = loadUsableSession(sessionToken);
      const user = requireUser(session.userId);
      sessions.touch(session.id, sessionExpiryFrom(clock.now()));
      return user;
    },

    resolveSession(sessionToken) {
      const session = loadUsableSession(sessionToken);
      return requireUser(session.userId);
    },
  };
}

/**
 * A valid Argon2id encoding of an unused value.
 *
 * It exists only so the "unknown account" branch performs a real verification
 * instead of returning early.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000';

export { createArgon2PasswordHasher, type PasswordHasher } from './password.js';
export {
  createSessionToken,
  hashSessionToken,
  isPlausibleSessionToken,
  isSessionUsable,
  sessionExpiryFrom,
  type SessionRecord,
  type SessionRepository,
} from './session.js';
export { generateUuidV7 } from '../identity/ids.js';
