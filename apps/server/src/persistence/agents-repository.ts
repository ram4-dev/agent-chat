import type Database from 'better-sqlite3';
import type {
  AgentRecord,
  AgentRepository,
  ConnectionRecord,
  ConnectionRepository,
} from '../modules/agents/index.js';

interface AgentRow {
  id: string;
  owner_user_id: string;
  name: string;
  avatar_url: string | null;
  description: string;
  status: 'active' | 'revoked';
  revoked_at: string | null;
  created_at: string;
}

interface ConnectionRow {
  id: string;
  agent_id: string;
  oauth_client_id: string;
  scopes: string;
  revoked_at: string | null;
  created_at: string;
}

/**
 * The `agents` table behind the agents module's port.
 *
 * The update statement deliberately names only profile columns. Ownership is not
 * merely validated in the module; it is not addressable from here, so no future
 * caller can reassign an agent by passing a different owner.
 */
export function createSqliteAgentRepository(sqlite: Database.Database): AgentRepository {
  const insert = sqlite.prepare(
    `INSERT INTO agents
       (id, owner_user_id, name, avatar_url, description, status, revoked_at, created_at)
     VALUES
       (@id, @ownerUserId, @name, @avatarUrl, @description, @status, @revokedAt, @createdAt)`,
  );
  const byId = sqlite.prepare('SELECT * FROM agents WHERE id = ?');
  const byOwner = sqlite.prepare(
    'SELECT * FROM agents WHERE owner_user_id = ? ORDER BY created_at, id',
  );
  const updateProfile = sqlite.prepare(
    `UPDATE agents
        SET name = @name, avatar_url = @avatarUrl, description = @description
      WHERE id = @agentId`,
  );
  const revoke = sqlite.prepare(
    'UPDATE agents SET status = ?, revoked_at = ? WHERE id = ?',
  );

  return {
    insertAgent(agent) {
      insert.run(agent);
    },
    findAgentById: (agentId) => toAgent(byId.get(agentId) as AgentRow | undefined),
    listAgentsByOwner: (ownerUserId) =>
      (byOwner.all(ownerUserId) as AgentRow[]).map((row) => toAgent(row)!),
    updateAgentProfile(input) {
      updateProfile.run(input);
    },
    revokeAgent(agentId, revokedAt) {
      revoke.run('revoked', revokedAt, agentId);
    },
  };
}

/**
 * The `agent_connections` table behind the agents module's port.
 *
 * `revoked_at` is only ever set, never cleared: a revocation is final for that
 * client, which is what makes reconnecting require a fresh authorization rather
 * than reviving a revoked credential.
 */
export function createSqliteConnectionRepository(
  sqlite: Database.Database,
): ConnectionRepository {
  const insert = sqlite.prepare(
    `INSERT INTO agent_connections
       (id, agent_id, oauth_client_id, scopes, revoked_at, created_at)
     VALUES
       (@id, @agentId, @oauthClientId, @scopes, @revokedAt, @createdAt)`,
  );
  const byId = sqlite.prepare('SELECT * FROM agent_connections WHERE id = ?');
  const byAgent = sqlite.prepare(
    'SELECT * FROM agent_connections WHERE agent_id = ? ORDER BY created_at, id',
  );
  const activeByClient = sqlite.prepare(
    `SELECT * FROM agent_connections
      WHERE agent_id = ? AND oauth_client_id = ? AND revoked_at IS NULL
      ORDER BY created_at DESC`,
  );
  const updateScopes = sqlite.prepare(
    'UPDATE agent_connections SET scopes = ? WHERE id = ?',
  );
  const revokeOne = sqlite.prepare(
    'UPDATE agent_connections SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  );
  const revokeAll = sqlite.prepare(
    'UPDATE agent_connections SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL',
  );

  return {
    insertConnection(connection) {
      insert.run({ ...connection, scopes: connection.scopes.join(' ') });
    },
    findConnectionById: (connectionId) =>
      toConnection(byId.get(connectionId) as ConnectionRow | undefined),
    listConnectionsByAgent: (agentId) =>
      (byAgent.all(agentId) as ConnectionRow[]).map((row) => toConnection(row)!),
    findActiveConnection: (agentId, oauthClientId) =>
      toConnection(activeByClient.get(agentId, oauthClientId) as ConnectionRow | undefined),
    updateConnectionScopes(connectionId, scopes) {
      updateScopes.run(scopes, connectionId);
    },
    revokeConnection(connectionId, revokedAt) {
      revokeOne.run(revokedAt, connectionId);
    },
    revokeConnectionsByAgent(agentId, revokedAt) {
      return revokeAll.run(revokedAt, agentId).changes;
    },
  };
}

function toAgent(row: AgentRow | undefined): AgentRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    avatarUrl: row.avatar_url,
    description: row.description,
    status: row.status,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

function toConnection(row: ConnectionRow | undefined): ConnectionRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    agentId: row.agent_id,
    oauthClientId: row.oauth_client_id,
    scopes: row.scopes === '' ? [] : row.scopes.split(' '),
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}
