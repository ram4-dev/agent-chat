import type { AsyncPort } from "../../services.js";
import type Database from 'better-sqlite3';
import type { AgentsModule } from '../../modules/agents/index.js';

/** The grant detail that binds a human-approved consent to an agent connection. */
export const CONNECTION_GRANT_DETAIL = 'connectionId';

export interface ConnectionClaims {
  agentId: string;
  connectionId: string;
}

interface GrantRow {
  payload: string;
  consumed_at: string | null;
  expires_at: string | null;
}

/**
 * Reads the agent connection a grant was approved for.
 *
 * The connection is recorded on the grant during consent, so this is the single
 * place token issuance learns which agent a credential speaks for. It runs on
 * every token request, and it resolves the connection through the agents module,
 * which means a revoked connection or a revoked agent cannot obtain a fresh
 * access token even though its refresh token still exists in storage.
 *
 * Returning nothing is the correct outcome for a human-only authorization: the
 * token is then an ordinary user token with no agent claims.
 */
export async function readConnectionClaims(
  sqlite: Database.Database,
  agents: AsyncPort<AgentsModule>,
  grantId: string | undefined,
): Promise<ConnectionClaims | undefined> {
  if (grantId === undefined) {
    return undefined;
  }

  const row = sqlite
    .prepare(
      `SELECT payload, consumed_at, expires_at
         FROM oidc_artifacts
        WHERE model = 'Grant' AND id = ?`,
    )
    .get(grantId) as GrantRow | undefined;

  if (row === undefined) {
    return undefined;
  }
  if (row.expires_at !== null && Date.parse(row.expires_at) <= Date.now()) {
    return undefined;
  }

  const payload = JSON.parse(row.payload) as { details?: Record<string, unknown> };
  const connectionId = payload.details?.[CONNECTION_GRANT_DETAIL];
  if (typeof connectionId !== 'string') {
    return undefined;
  }

  try {
    const { agent, connection } = await agents.resolveActiveConnection(connectionId);
    return { agentId: agent.id, connectionId: connection.id };
  } catch {
    // A revoked or missing connection yields no agent claims, and the caller
    // decides whether a token without agent claims is acceptable.
    return undefined;
  }
}

/** Stores the connection on the grant so token issuance can find it later. */
export function writeConnectionGrantDetail(
  sqlite: Database.Database,
  grantId: string,
  connectionId: string,
): void {
  const row = sqlite
    .prepare(`SELECT payload FROM oidc_artifacts WHERE model = 'Grant' AND id = ?`)
    .get(grantId) as { payload: string } | undefined;

  if (row === undefined) {
    throw new Error(`Grant ${grantId} was not stored before consent was recorded`);
  }

  const payload = JSON.parse(row.payload) as { details?: Record<string, unknown> };
  payload.details = { ...(payload.details ?? {}), [CONNECTION_GRANT_DETAIL]: connectionId };

  sqlite
    .prepare(`UPDATE oidc_artifacts SET payload = ? WHERE model = 'Grant' AND id = ?`)
    .run(JSON.stringify(payload), grantId);
}
