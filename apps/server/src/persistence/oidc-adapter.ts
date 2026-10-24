import { LIMITS } from '@agent-chat/contracts';
import { errors } from 'oidc-provider';
import { createHash } from 'node:crypto';
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
  onRefreshReuse?: (grantId: string) => void | Promise<void>,
): (model: string) => OidcAdapter {
  // Upgrade provider-owned refresh rows written before S8 without retaining replayable values.
  const legacy = sqlite.prepare("SELECT id, payload FROM oidc_artifacts WHERE model = 'RefreshToken' AND json_type(payload, '$.jti') = 'text'").all() as { id: string; payload: string }[];
  sqlite.transaction(() => {
    const update = sqlite.prepare("UPDATE oidc_artifacts SET id = ?, payload = ? WHERE model = 'RefreshToken' AND id = ?");
    for (const row of legacy) {
      const payload = JSON.parse(row.payload) as OidcArtifactRecord;
      delete payload['jti'];
      update.run(createHash('sha256').update(row.id).digest('hex'), JSON.stringify(payload), row.id);
    }
  })();
  return (model: string) => new OidcAdapter(sqlite, model, onRefreshReuse);
}

export class OidcAdapter {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly model: string,
    private readonly onRefreshReuse?: (grantId: string) => void | Promise<void>,
  ) {}

  upsert(id: string, payload: OidcArtifactRecord, expiresInSeconds?: number): void {
    const storedPayload = { ...payload };
    let expiry = expiresInSeconds === undefined ? undefined : Date.now() + expiresInSeconds * 1000;
    if (this.model === 'RefreshToken') {
      delete storedPayload['jti'];
      const initial = typeof payload['iiat'] === 'number' ? payload['iiat'] : payload['iat'];
      if (typeof initial === 'number') {
        const familyEnd = (initial + LIMITS.REFRESH_TOKEN_FAMILY_MAX_LIFETIME_DAYS * 24 * 60 * 60) * 1000;
        expiry = Math.min(expiry ?? familyEnd, familyEnd);
        storedPayload['exp'] = Math.floor(expiry / 1000);
      }
    }
    const expiresAt = expiry === undefined ? null : new Date(expiry).toISOString();

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
        id: this.storageId(id),
        payload: JSON.stringify(storedPayload),
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
      .get(this.model, this.storageId(id)) as ArtifactRow | undefined;

    const payload = this.readable(row);
    if (payload !== undefined && this.model === 'RefreshToken') {
      // The provider detects reuse from this consumed marker and revokes the family.
      return { ...payload, jti: id, ...(row?.consumed_at ? { consumed: Math.floor(Date.parse(row.consumed_at) / 1000) } : {}) };
    }
    return payload;
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
    const result = this.sqlite
      .prepare(
        `UPDATE oidc_artifacts
            SET consumed_at = ?
          WHERE model = ? AND id = ? AND consumed_at IS NULL`,
      )
      .run(new Date().toISOString(), this.model, this.storageId(id));
    if (result.changes !== 1) {
      if (this.model === 'RefreshToken') {
        const row = this.sqlite.prepare('SELECT grant_id FROM oidc_artifacts WHERE model = ? AND id = ?')
          .get(this.model, this.storageId(id)) as { grant_id: string | null } | undefined;
        if (row?.grant_id) await this.onRefreshReuse?.(row.grant_id);
      }
      throw new errors.InvalidGrant('credential already consumed');
    }
  }

  async destroy(id: string): Promise<void> {
    this.sqlite
      .prepare('DELETE FROM oidc_artifacts WHERE model = ? AND id = ?')
      .run(this.model, this.storageId(id));
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    if (this.model === 'RefreshToken') await this.onRefreshReuse?.(grantId);
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

  private storageId(id: string): string {
    return this.model === 'RefreshToken' ? createHash('sha256').update(id).digest('hex') : id;
  }

  private readable(row: ArtifactRow | undefined): OidcArtifactRecord | undefined {
    if (row === undefined || (row.consumed_at !== null && this.model !== 'RefreshToken')) {
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
