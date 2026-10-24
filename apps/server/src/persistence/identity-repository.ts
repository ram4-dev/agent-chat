import type Database from 'better-sqlite3';
import { EmailAlreadyRegisteredError } from '../modules/identity/errors.js';
import type { UserRecord, UserRepository } from '../modules/identity/index.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
}

/** SQLite reports a violated unique index through this code. */
const UNIQUE_VIOLATION = 'SQLITE_CONSTRAINT_UNIQUE';

/**
 * The `users` table behind the identity module's port.
 *
 * The unique index is the authority on duplicate addresses: translating its
 * violation into the domain error is the only place that decision is made, so a
 * race between two registrations cannot create two accounts or escape as a 500.
 */
export function createSqliteUserRepository(sqlite: Database.Database): UserRepository {
  const insert = sqlite.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, created_at)
     VALUES (@id, @email, @passwordHash, @displayName, @createdAt)`,
  );
  const byEmail = sqlite.prepare('SELECT * FROM users WHERE email = ?');
  const byId = sqlite.prepare('SELECT * FROM users WHERE id = ?');

  return {
    insert(user) {
      try {
        insert.run(user);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new EmailAlreadyRegisteredError();
        }
        throw error;
      }
    },
    findByEmail: (email) => toUser(byEmail.get(email) as UserRow | undefined),
    findById: (id) => toUser(byId.get(id) as UserRow | undefined),
  };
}

function toUser(row: UserRow | undefined): UserRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
