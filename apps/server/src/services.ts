import { createAuthModule, createArgon2PasswordHasher } from './modules/auth/index.js';
import { createIdentityModule, generateUuidV7 } from './modules/identity/index.js';
import { createSqliteUserRepository } from './persistence/identity-repository.js';
import { createSqliteSessionRepository } from './persistence/session-repository.js';
import type { DatabaseHandle } from './persistence/index.js';
import type { AuthModule } from './modules/auth/index.js';
import type { IdentityModule } from './modules/identity/index.js';

export interface ApplicationServices {
  identity: IdentityModule;
  auth: AuthModule;
}

/**
 * Composition root.
 *
 * Adapters receive modules that already hold their ports; nothing below this
 * function decides which SQLite statement or which hash function is used. That
 * keeps a use case testable with fakes and keeps the driver choice out of the
 * modules.
 */
export function createServices(database: DatabaseHandle): ApplicationServices {
  const identity = createIdentityModule({
    users: createSqliteUserRepository(database.sqlite),
    clock: SYSTEM_CLOCK,
    generateId: () => generateUuidV7(),
  });

  const auth = createAuthModule({
    identity,
    sessions: createSqliteSessionRepository(database.sqlite),
    passwords: createArgon2PasswordHasher(),
    clock: SYSTEM_CLOCK,
  });

  return { identity, auth };
}

const SYSTEM_CLOCK = { now: (): Date => new Date() };
