import type Database from 'better-sqlite3';
import type { AuditPort } from '../modules/audit/index.js';
import { generateUuidV7 } from '../modules/identity/index.js';

export function createSqliteAuditRepository(sqlite: Database.Database): AuditPort {
  const insert = sqlite.prepare(`INSERT INTO audit_events
    (id, actor_kind, actor_id, action, target_kind, target_id, outcome, metadata, created_at)
    VALUES (@id, @actorKind, @actorId, @action, @targetKind, @targetId, @outcome, NULL, @createdAt)`);
  return { record(event) { insert.run({ id: generateUuidV7(), ...event }); } };
}
