import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

export type DrizzleClient = ReturnType<typeof drizzle>;

export interface DatabaseHandle {
  /** Raw connection, used for pragmas, schema work, and repository queries. */
  readonly sqlite: Database.Database;
  /** Typed query layer sharing the same connection. */
  readonly db: DrizzleClient;
  close(): void;
}

export interface CreateDatabaseOptions {
  /** SQLite file path, or `:memory:` for a throwaway database. */
  path: string;
  /** Bounded wait for the write lock before a write fails closed. */
  busyTimeoutMs: number;
}

/**
 * Opens the SQLite database with the durability and safety settings the whole
 * application depends on: WAL for concurrent readers, enforced foreign keys,
 * FULL synchronization for acknowledged commits, and a bounded busy timeout
 * so a locked database fails closed instead of hanging.
 */
export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const sqlite = new Database(options.path);
  try {
    // This is connection-local: every writer must set it before any application work.
    sqlite.pragma('synchronous = FULL');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma(`busy_timeout = ${options.busyTimeoutMs}`);
    if (sqlite.pragma('synchronous', { simple: true }) !== 2) {
      throw new Error('SQLite FULL synchronization is required');
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }

  return {
    sqlite,
    db: drizzle(sqlite),
    close: () => {
      sqlite.close();
    },
  };
}

/**
 * Runs `operation` inside `BEGIN IMMEDIATE`.
 *
 * Write paths that allocate idempotency claims or inbox sequence numbers take
 * the write lock up front, so two concurrent senders serialize at the start of
 * the transaction instead of failing halfway through it.
 */
export function runImmediateTransaction<T>(
  sqlite: Database.Database,
  operation: () => T,
): T {
  return sqlite.transaction(operation).immediate();
}
