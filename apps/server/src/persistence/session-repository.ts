import type Database from 'better-sqlite3';
import type { SessionRecord, SessionRepository } from '../modules/auth/session.js';

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

/**
 * The `human_sessions` table behind the auth module's port.
 *
 * `touch` slides the inactivity window on every successful use; `revoke` only
 * ever sets a timestamp, so logout and revocation are idempotent and a repeated
 * call cannot resurrect a session.
 */
export function createSqliteSessionRepository(sqlite: Database.Database): SessionRepository {
  const insert = sqlite.prepare(
    `INSERT INTO human_sessions (id, user_id, expires_at, revoked_at, created_at)
     VALUES (@id, @userId, @expiresAt, @revokedAt, @createdAt)`,
  );
  const findById = sqlite.prepare('SELECT * FROM human_sessions WHERE id = ?');
  const touch = sqlite.prepare(
    'UPDATE human_sessions SET expires_at = ? WHERE id = ? AND revoked_at IS NULL',
  );
  const revoke = sqlite.prepare(
    'UPDATE human_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  );

  return {
    insert(session) {
      insert.run(session);
    },
    findById(id) {
      return toSession(findById.get(id) as SessionRow | undefined);
    },
    touch(id, expiresAt) {
      touch.run(expiresAt, id);
    },
    revoke(id, revokedAt) {
      revoke.run(revokedAt, id);
    },
  };
}

function toSession(row: SessionRow | undefined): SessionRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}
