import {
  normalizeEmail,
  validateDisplayName,
  validateEmail,
  type PublicUser,
} from '@agent-chat/contracts';
import { InvalidInputError } from './errors.js';

/** A stored account row, exactly as the `users` table holds it. */
export interface UserRecord {
  id: string;
  /** Already normalized to lowercase; the unique index depends on it. */
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  /** The caller hashes before calling: identity never sees a plaintext password. */
  passwordHash: string;
}

export interface UserRepository {
  /** Throws `EmailAlreadyRegisteredError` when the e-mail is taken. */
  insert(user: UserRecord): void;
  findByEmail(email: string): UserRecord | undefined;
  findById(id: string): UserRecord | undefined;
}

export interface Clock {
  now(): Date;
}

export interface IdentityModule {
  createUser(input: CreateUserInput): UserRecord;
  findByEmail(email: string): UserRecord | undefined;
  findById(id: string): UserRecord | undefined;
  /**
   * The only user projection that leaves the server.
   *
   * It is built by naming fields instead of deleting the hash, so a later
   * column added to `users` cannot leak by default.
   */
  getCurrentUser(id: string): PublicUser | undefined;
}

export interface IdentityModuleDependencies {
  users: UserRepository;
  clock: Clock;
  generateId(): string;
}

/**
 * Owns account creation and lookup.
 *
 * Validation happens here, before the repository is touched, so an invalid
 * request never reaches the database and cannot disclose whether an address is
 * already registered.
 */
export function createIdentityModule({
  users,
  clock,
  generateId,
}: IdentityModuleDependencies): IdentityModule {
  return {
    createUser(input) {
      const email = validateEmail(input.email);
      if (!email.ok) {
        throw new InvalidInputError(`Rejected e-mail (${email.reason})`);
      }

      const displayName = validateDisplayName(input.displayName);
      if (!displayName.ok) {
        throw new InvalidInputError(`Rejected display name (${displayName.reason})`);
      }

      const user: UserRecord = {
        id: generateId(),
        email: email.value,
        passwordHash: input.passwordHash,
        displayName: displayName.value,
        createdAt: clock.now().toISOString(),
      };

      users.insert(user);
      return user;
    },

    findByEmail(email) {
      return users.findByEmail(normalizeEmail(email));
    },

    findById(id) {
      return users.findById(id);
    },

    getCurrentUser(id) {
      const user = users.findById(id);
      if (user === undefined) {
        return undefined;
      }
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
      };
    },
  };
}

export { EmailAlreadyRegisteredError, InvalidInputError, SessionInvalidError, InvalidCredentialsError } from './errors.js';
export { generateUuidV7 } from './ids.js';
