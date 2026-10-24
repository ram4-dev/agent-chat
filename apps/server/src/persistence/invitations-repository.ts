import type Database from 'better-sqlite3';
import type { InvitationRecord, InvitationRepository } from '../modules/groups/index.js';

interface InvitationRow {
  id: string;
  token_hash: string;
  group_id: string;
  inviter_user_id: string;
  expires_at: string;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  created_at: string;
}

/**
 * The `invitations` table behind the groups module's port.
 *
 * `markAccepted` only moves the row forward, so re-accepting the same link
 * cannot reopen it or reset its expiry.
 */
export function createSqliteInvitationRepository(
  sqlite: Database.Database,
): InvitationRepository {
  const insert = sqlite.prepare(
    `INSERT INTO invitations
       (id, token_hash, group_id, inviter_user_id, expires_at, accepted_by_user_id, accepted_at, created_at)
     VALUES
       (@id, @tokenHash, @groupId, @inviterUserId, @expiresAt, @acceptedByUserId, @acceptedAt, @createdAt)`,
  );
  const byTokenHash = sqlite.prepare('SELECT * FROM invitations WHERE token_hash = ?');
  const accept = sqlite.prepare(
    `UPDATE invitations
        SET accepted_by_user_id = ?, accepted_at = ?
      WHERE id = ? AND accepted_at IS NULL`,
  );

  return {
    insert(invitation) {
      insert.run(invitation);
    },
    findByTokenHash: (tokenHash) =>
      toInvitation(byTokenHash.get(tokenHash) as InvitationRow | undefined),
    markAccepted(invitationId, userId, acceptedAt) {
      accept.run(userId, acceptedAt, invitationId);
    },
  };
}

function toInvitation(row: InvitationRow | undefined): InvitationRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    tokenHash: row.token_hash,
    groupId: row.group_id,
    inviterUserId: row.inviter_user_id,
    expiresAt: row.expires_at,
    acceptedByUserId: row.accepted_by_user_id,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  };
}
