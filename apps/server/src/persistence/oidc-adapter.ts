import type Database from 'better-sqlite3';

interface ArtifactRow {
  payload: string;
  expires_at: string | null;
  consumed_at: string | null;
}

/** Session-scoped alias: the provider reads a payload it wrote itself. */
export interface OidcArtifactRecord {
  [key: string]: unknown;
}

/**
 * SQLite-backed storage for the authorization server's own artifacts.
 *
 * The provider treats this as opaque key-value storage: it writes a JSON payload
 * and asks for it back by model and id. Two rules are enforced here rather than
 * trusted to the caller:
 *
 * - an artifact past its expiry is never returned, so a stale authorization code
 *   or access token cannot be replayed even if a cleanup sweep has not run; and
 * - `consume` marks the row once and reports whether it won, which is what makes
 *   an authorization code single-use under concurrency instead of only in
 *   sequential use.
 */
export function createOidcAdapterFactory(
  sqlite: Database.Database,
): (model: string) => OidcAdapter {
  return (model: string) => new OidcAdapter(sqlite, model);
}

export class OidcAdapter {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly model: string,
  ) {}

  upsert(id: string, payload: OidcArtifactRecord, expiresInSeconds?: number): void {
    const expiresAt =
      expiresInSeconds === undefined
        ? null
        : new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    this.sqlite
      .prepare(
        `INSERT INTO oidc_artifacts (model, id, payload, expires_at, consumed_at, user_code, uid, grant_id)
         VALUES (@model, @id, @payload, @expiresAt, NULL, @userCode, @uid, @grantId)
         ON CONFLICT (model, id) DO UPDATE SET
           payload = excluded.payload,
           expires_at = excluded.expires_at,
           user_code = excluded.user_code,
           uid = excluded.uid,
           grant_id = excluded.grant_id`,
      )
      .run({
        model: this.model,
        id,
        payload: JSON.stringify(payload),
        expiresAt,
        // better-sqlite3 requires every named parameter to be present, so the
        // optional bookkeeping columns are always supplied, as null when absent.
        userCode: optionalText(payload, 'userCode'),
        uid: optionalText(payload, 'uid'),
        grantId: optionalText(payload, 'grantId'),
      });
  }

  async find(id: string): Promise<OidcArtifactRecord | undefined> {
    const row = this.sqlite
      .prepare(
        `SELECT payload, expires_at, consumed_at
           FROM oidc_artifacts
          WHERE model = ? AND id = ?`,
      )
      .get(this.model, id) as ArtifactRow | undefined;

    return this.readable(row);
  }

  async findByUserCode(userCode: string): Promise<OidcArtifactRecord | undefined> {
    const row = this.sqlite
      .prepare(
        `SELECT payload, expires_at, consumed_at
           FROM oidc_artifacts
          WHERE model = ? AND user_code = ?`,
      )
      .get(this.model, userCode) as ArtifactRow | undefined;

    return this.readable(row);
  }

  async findByUid(uid: string): Promise<OidcArtifactRecord | undefined> {
    const row = this.sqlite
      .prepare(
        `SELECT payload, expires_at, consumed_at
           FROM oidc_artifacts
          WHERE model = ? AND uid = ?`,
      )
      .get(this.model, uid) as ArtifactRow | undefined;

    return this.readable(row);
  }

  /**
   * Marks an artifact used exactly once.
   *
   * The conditional update is the concurrency guarantee: two simultaneous
   * redemptions of one authorization code both attempt the same statement, and
   * only the first sees a changed row.
   */
  async consume(id: string): Promise<void> {
    this.sqlite
      .prepare(
        `UPDATE oidc_artifacts
            SET consumed_at = ?
          WHERE model = ? AND id = ? AND consumed_at IS NULL`,
      )
      .run(new Date().toISOString(), this.model, id);
  }

  async destroy(id: string): Promise<void> {
    this.sqlite
      .prepare('DELETE FROM oidc_artifacts WHERE model = ? AND id = ?')
      .run(this.model, id);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    this.sqlite
      .prepare('DELETE FROM oidc_artifacts WHERE model = ? AND grant_id = ?')
      .run(this.model, grantId);
  }

  /** Removes artifacts whose expiry has passed. Bounded by the expiry index. */
  static pruneExpired(sqlite: Database.Database, now: Date = new Date()): number {
    const result = sqlite
      .prepare('DELETE FROM oidc_artifacts WHERE expires_at IS NOT NULL AND expires_at <= ?')
      .run(now.toISOString());
    return result.changes;
  }

  private readable(row: ArtifactRow | undefined): OidcArtifactRecord | undefined {
    if (row === undefined || row.consumed_at !== null) {
      return undefined;
    }
    if (row.expires_at !== null && Date.parse(row.expires_at) <= Date.now()) {
      return undefined;
    }
    return JSON.parse(row.payload) as OidcArtifactRecord;
  }
}

/** Surfaces the provider's own bookkeeping columns for indexed lookups. */
function optionalText(payload: OidcArtifactRecord, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}
