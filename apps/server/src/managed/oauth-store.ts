import { createHash } from 'node:crypto';
import { errors } from 'oidc-provider';
import { LIMITS } from '@agent-chat/contracts';
import type { OAuthStore } from '../persistence/oauth-store.js';
import type { OidcArtifactRecord } from '../persistence/oidc-adapter.js';
import type { ManagedDatabase } from './database.js';

interface Row { payload: string; expires_at: string | null; consumed_at: string | null; grant_id: string | null }

export function createManagedOAuthStore(db: ManagedDatabase): OAuthStore {
  const get = (model: string, id: string) => db.one<Row>('SELECT * FROM oidc_artifacts WHERE model=$1 AND id=$2', [model, id]);
  return {
    adapterFactory: (onRefreshReuse) => (model) => {
      const storageId = (id: string) => model === 'RefreshToken' ? createHash('sha256').update(id).digest('hex') : id;
      const readable = (row: Row | undefined): OidcArtifactRecord | undefined => {
        if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now()) || (row.consumed_at && model !== 'RefreshToken')) return undefined;
        return { ...JSON.parse(row.payload), ...(row.consumed_at ? { consumed: Math.floor(Date.parse(row.consumed_at) / 1000) } : {}) };
      };
      return {
        async upsert(id: string, payload: OidcArtifactRecord, expiresIn?: number) {
          const copy = { ...payload };
          let end = expiresIn === undefined ? undefined : Date.now() + expiresIn * 1000;
          if (model === 'RefreshToken') {
            delete copy['jti'];
            const initial = typeof payload['iiat'] === 'number' ? payload['iiat'] : payload['iat'];
            if (typeof initial === 'number') {
              end = Math.min(end ?? Infinity, (initial + LIMITS.REFRESH_TOKEN_FAMILY_MAX_LIFETIME_DAYS * 86400) * 1000);
              copy['exp'] = Math.floor(end / 1000);
            }
          }
          await db.rows(`INSERT INTO oidc_artifacts(model,id,payload,expires_at,user_code,uid,grant_id)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(model,id) DO UPDATE SET payload=excluded.payload,
            expires_at=excluded.expires_at,user_code=excluded.user_code,uid=excluded.uid,grant_id=excluded.grant_id`,
          [model, storageId(id), JSON.stringify(copy), end === undefined ? null : new Date(end).toISOString(), payload['userCode'] ?? null, payload['uid'] ?? null, payload['grantId'] ?? null]);
        },
        async find(id: string) {
          const payload = readable(await get(model, storageId(id)));
          return payload && model === 'RefreshToken' ? { ...payload, jti: id } : payload;
        },
        async findByUid(uid: string) { return readable(await db.one<Row>('SELECT * FROM oidc_artifacts WHERE model=$1 AND uid=$2', [model, uid])); },
        async findByUserCode(code: string) { return readable(await db.one<Row>('SELECT * FROM oidc_artifacts WHERE model=$1 AND user_code=$2', [model, code])); },
        async consume(id: string) {
          const won = await db.one(`UPDATE oidc_artifacts SET consumed_at=$3 WHERE model=$1 AND id=$2 AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at>$3) RETURNING id`, [model, storageId(id), new Date().toISOString()]);
          if (won) return;
          const row = await get(model, storageId(id));
          if (model === 'RefreshToken' && row?.grant_id) await onRefreshReuse(row.grant_id);
          throw new errors.InvalidGrant('credential already consumed');
        },
        async destroy(id: string) { await db.rows('DELETE FROM oidc_artifacts WHERE model=$1 AND id=$2', [model, storageId(id)]); },
        async revokeByGrantId(grantId: string) {
          if (model === 'RefreshToken') await onRefreshReuse(grantId);
          await db.rows('DELETE FROM oidc_artifacts WHERE model=$1 AND grant_id=$2', [model, grantId]);
        },
      };
    },
    async hasUser(id) { return !!await db.one('SELECT id FROM users WHERE id=$1', [id]); },
    async claims(id, agents) {
      if (!id) return undefined;
      const row = await get('Grant', id);
      if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return undefined;
      const payload = JSON.parse(row.payload) as { details?: { connectionId?: string } };
      if (!payload.details?.connectionId) return undefined;
      try {
        const { agent, connection } = await agents.resolveActiveConnection(payload.details.connectionId);
        return { agentId: agent.id, connectionId: connection.id };
      } catch { return undefined; }
    },
    async bindGrant(grantId, connectionId) {
      const row = await db.one(`UPDATE oidc_artifacts SET payload=jsonb_set(payload::jsonb,'{details}',COALESCE(payload::jsonb->'details','{}'::jsonb)||jsonb_build_object('connectionId',$2::text))::text WHERE model='Grant' AND id=$1 RETURNING id`, [grantId, connectionId]);
      if (!row) throw new Error('Consent grant missing');
    },
    async ensureClient(clientId) {
      const row = await get('Client', clientId);
      if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) throw new Error('OAuth client missing');
      const p = JSON.parse(row.payload) as { client_name?: string; redirect_uris?: string[]; token_endpoint_auth_method?: string };
      const method = p.token_endpoint_auth_method ?? 'none';
      await db.rows(`INSERT INTO oauth_clients(client_id,client_name,redirect_uris,token_endpoint_auth_method,is_public)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [clientId, p.client_name ?? 'MCP client', JSON.stringify(p.redirect_uris ?? []), method, method === 'none' ? 1 : 0]);
    },
  };
}
