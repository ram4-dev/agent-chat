import type Database from 'better-sqlite3';

/** Deletes provider artifacts by their immutable connection binding. */
export function createCredentialRepository(sqlite: Database.Database) {
  return {
    revokeConnection(connectionId: string): void {
      const grants = sqlite.prepare(`SELECT id FROM oidc_artifacts WHERE model = 'Grant'
        AND json_extract(payload, '$.details.connectionId') = ?`).all(connectionId) as { id: string }[];
      const remove = sqlite.prepare("DELETE FROM oidc_artifacts WHERE grant_id = ? OR (model = 'Grant' AND id = ?)");
      for (const grant of grants) remove.run(grant.id, grant.id);
    },
  };
}
