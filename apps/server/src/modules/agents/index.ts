import type { AuditPort } from '../audit/index.js';
import type { Clock } from '../identity/index.js';
import { AgentNotFoundError, AgentRevokedError, InvalidAgentInputError } from './errors.js';
import { parseAgentProfile, parseRequestedScopes } from './contracts.js';

export interface AgentRecord {
  id: string;
  /** Fixed at insert; no API in this module can change it. */
  ownerUserId: string;
  name: string;
  avatarUrl: string | null;
  description: string;
  status: 'active' | 'revoked';
  revokedAt: string | null;
  createdAt: string;
}

export interface ConnectionRecord {
  id: string;
  agentId: string;
  oauthClientId: string;
  clientName?: string | null;
  scopes: string[];
  revokedAt: string | null;
  createdAt: string;
}

export interface AgentRepository {
  insertAgent(agent: AgentRecord): void;
  findAgentById(agentId: string): AgentRecord | undefined;
  listAgentsByOwner(ownerUserId: string): AgentRecord[];
  /** Updates only profile columns; ownership is not in the statement. */
  updateAgentProfile(input: {
    agentId: string;
    name: string;
    avatarUrl: string | null;
    description: string;
  }): void;
  revokeAgent(agentId: string, revokedAt: string): void;
}

export interface ConnectionRepository {
  insertConnection(connection: ConnectionRecord): void;
  findConnectionById(connectionId: string): ConnectionRecord | undefined;
  listConnectionsByAgent(agentId: string): ConnectionRecord[];
  findActiveConnection(agentId: string, oauthClientId: string): ConnectionRecord | undefined;
  updateConnectionScopes(connectionId: string, scopes: string): void;
  revokeConnection(connectionId: string, revokedAt: string): void;
  /** Used when a whole agent is revoked: every connection stops at once. */
  revokeConnectionsByAgent(agentId: string, revokedAt: string): number;
}

export interface AgentsModule {
  createAgent(input: {
    ownerUserId: string;
    name: string;
    description?: unknown;
    avatarUrl?: unknown;
  }): AgentRecord;
  listOwnedAgents(ownerUserId: string): AgentRecord[];
  /**
   * Whether an agent exists and is not revoked.
   *
   * Deliberately not owner-scoped: deciding who may admit an agent to a group
   * belongs to the group, not to the agent's owner.
   */
  isActiveAgent(agentId: string): boolean;
  /** Owner-scoped read: another person's agent is reported as not found. */
  getOwnedAgent(agentId: string, ownerUserId: string): AgentRecord;
  updateProfile(input: {
    agentId: string;
    ownerUserId: string;
    name: unknown;
    description?: unknown;
    avatarUrl?: unknown;
  }): AgentRecord;
  revokeAgent(agentId: string, ownerUserId: string): AgentRecord;
  createConnection(input: {
    agentId: string;
    oauthClientId: string;
    scopes?: unknown;
  }): ConnectionRecord;
  listConnections(agentId: string, ownerUserId: string): ConnectionRecord[];
  revokeConnection(connectionId: string, ownerUserId: string): ConnectionRecord;
  revokeCompromisedConnection(connectionId: string): void;
  /**
   * Resolves a connection that may still act.
   *
   * This is the single gate every agent credential passes: it requires a live
   * connection AND a live agent, so revoking either one blocks the next call.
   */
  resolveActiveConnection(connectionId: string): { agent: AgentRecord; connection: ConnectionRecord };
}

export interface AgentsModuleDependencies {
  transaction<T>(operation: () => T): T;
  audit: AuditPort;
  credentials: { revokeConnection(connectionId: string): void };
  closeReceivers(target: { agentId?: string; connectionId?: string }): void;
  agents: AgentRepository;
  connections: ConnectionRepository;
  clock: Clock;
  generateId(): string;
}

/**
 * Owns agent identity, ownership, and connection revocation.
 *
 * Ownership is immutable by construction: `ownerUserId` is set once at insert,
 * and the repository's update statement does not contain the column. Every
 * method that touches an existing agent first resolves it against the acting
 * owner, so a non-owner sees `not_found` rather than a permission error that
 * would confirm the agent exists.
 */
export function createAgentsModule({
  agents,
  connections,
  clock,
  generateId, transaction, audit, credentials, closeReceivers,
}: AgentsModuleDependencies): AgentsModule {
  function requireOwnedAgent(agentId: string, ownerUserId: string): AgentRecord {
    const agent = agents.findAgentById(agentId);
    if (agent === undefined || agent.ownerUserId !== ownerUserId) {
      throw new AgentNotFoundError();
    }
    return agent;
  }

  function requireOwnedConnection(connectionId: string, ownerUserId: string): ConnectionRecord {
    const connection = connections.findConnectionById(connectionId);
    if (connection === undefined) {
      throw new AgentNotFoundError();
    }
    requireOwnedAgent(connection.agentId, ownerUserId);
    return connection;
  }

  return {
    createAgent({ ownerUserId, name, description, avatarUrl }) {
      const profile = parseAgentProfile({ name, description, avatarUrl });
      if (!profile.ok) {
        throw new InvalidAgentInputError(`Rejected agent profile (${profile.reason})`);
      }

      const agent: AgentRecord = {
        id: generateId(),
        ownerUserId,
        name: profile.value.name,
        avatarUrl: profile.value.avatarUrl ?? null,
        description: profile.value.description,
        status: 'active',
        revokedAt: null,
        createdAt: clock.now().toISOString(),
      };

      agents.insertAgent(agent);
      return agent;
    },

    listOwnedAgents(ownerUserId) {
      return agents.listAgentsByOwner(ownerUserId);
    },

    isActiveAgent(agentId) {
      const agent = agents.findAgentById(agentId);
      return agent !== undefined && agent.status === 'active';
    },

    getOwnedAgent(agentId, ownerUserId) {
      return requireOwnedAgent(agentId, ownerUserId);
    },

    updateProfile({ agentId, ownerUserId, name, description, avatarUrl }) {
      const agent = requireOwnedAgent(agentId, ownerUserId);

      const profile = parseAgentProfile({ name, description, avatarUrl });
      if (!profile.ok) {
        throw new InvalidAgentInputError(`Rejected agent profile (${profile.reason})`);
      }

      agents.updateAgentProfile({
        agentId,
        name: profile.value.name,
        avatarUrl: profile.value.avatarUrl ?? null,
        description: profile.value.description,
      });

      return {
        ...agent,
        name: profile.value.name,
        avatarUrl: profile.value.avatarUrl ?? null,
        description: profile.value.description,
      };
    },

    revokeAgent(agentId, ownerUserId) {
      const agent = requireOwnedAgent(agentId, ownerUserId);
      const revokedAt = clock.now().toISOString();

      if (agent.status === 'revoked') return agent;
      transaction(() => {
        for (const connection of connections.listConnectionsByAgent(agentId)) credentials.revokeConnection(connection.id);
        connections.revokeConnectionsByAgent(agentId, revokedAt);
        agents.revokeAgent(agentId, revokedAt);
        audit.record({ actorKind: 'human', actorId: ownerUserId, action: 'agent.revoked', targetKind: 'agent', targetId: agentId, outcome: 'allowed', createdAt: revokedAt });
      });
      closeReceivers({ agentId });

      return { ...agent, status: 'revoked', revokedAt };
    },

    createConnection({ agentId, oauthClientId, scopes }) {
      const agent = agents.findAgentById(agentId);
      if (agent === undefined) {
        throw new AgentNotFoundError();
      }
      if (agent.status !== 'active') {
        throw new AgentRevokedError();
      }

      const granted = parseRequestedScopes(scopes);
      if (!granted.ok) {
        throw new InvalidAgentInputError(`Rejected scopes (${granted.reason})`);
      }

      // Re-authorizing the same client must not add a row every time. A client
      // holds one connection, so an active one is reused and its scopes are
      // brought in line with what was just consented to.
      const existing = connections.findActiveConnection(agentId, oauthClientId);
      if (existing !== undefined) {
        const grantedScopes = granted.value.join(' ');
        if (existing.scopes.join(' ') !== grantedScopes) {
          connections.updateConnectionScopes(existing.id, grantedScopes);
          return { ...existing, scopes: granted.value };
        }
        return existing;
      }

      const connection: ConnectionRecord = {
        id: generateId(),
        agentId,
        oauthClientId,
        scopes: granted.value,
        revokedAt: null,
        createdAt: clock.now().toISOString(),
      };

      connections.insertConnection(connection);
      return connection;
    },

    listConnections(agentId, ownerUserId) {
      requireOwnedAgent(agentId, ownerUserId);
      return connections.listConnectionsByAgent(agentId);
    },

    revokeConnection(connectionId, ownerUserId) {
      const connection = requireOwnedConnection(connectionId, ownerUserId);
      const revokedAt = clock.now().toISOString();
      if (connection.revokedAt !== null) return connection;
      transaction(() => {
        connections.revokeConnection(connectionId, revokedAt);
        credentials.revokeConnection(connectionId);
        audit.record({ actorKind: 'human', actorId: ownerUserId, action: 'connection.revoked', targetKind: 'connection', targetId: connectionId, outcome: 'allowed', createdAt: revokedAt });
      });
      closeReceivers({ connectionId });
      return { ...connection, revokedAt };
    },

    revokeCompromisedConnection(connectionId) {
      const connection = connections.findConnectionById(connectionId);
      if (connection === undefined || connection.revokedAt !== null) return;
      const at = clock.now().toISOString();
      transaction(() => {
        connections.revokeConnection(connectionId, at);
        credentials.revokeConnection(connectionId);
        audit.record({ actorKind: 'system', actorId: null, action: 'refresh.reused', targetKind: 'connection', targetId: connectionId, outcome: 'denied', createdAt: at });
      });
      closeReceivers({ connectionId });
    },

    resolveActiveConnection(connectionId) {
      const connection = connections.findConnectionById(connectionId);
      if (connection === undefined || connection.revokedAt !== null) {
        throw new AgentRevokedError('Connection is not active');
      }

      const agent = agents.findAgentById(connection.agentId);
      if (agent === undefined || agent.status !== 'active') {
        throw new AgentRevokedError('Agent is not active');
      }

      return { agent, connection };
    },
  };
}

export { parseRequestedScopes, parseAgentProfile, AGENT_SCOPES, ALL_AGENT_SCOPES, type AgentScope } from './contracts.js';
export { AgentNotFoundError, AgentRevokedError, InvalidAgentInputError } from './errors.js';
