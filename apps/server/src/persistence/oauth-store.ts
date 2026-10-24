import type Database from 'better-sqlite3';
import type { AsyncPort } from '../services.js';
import type { AgentsModule } from '../modules/agents/index.js';
import { createOidcAdapterFactory } from './oidc-adapter.js';
import { ensureClientRegistered } from './oauth-clients-repository.js';
import { readConnectionClaims, writeConnectionGrantDetail, type ConnectionClaims } from '../adapters/oauth/grant-claims.js';

export interface OAuthStore {
  adapterFactory(onRefreshReuse: (grantId: string) => Promise<void>): (model: string) => unknown;
  claims(grantId: string | undefined, agents: AsyncPort<AgentsModule>): Promise<ConnectionClaims | undefined>;
  hasUser(id: string): Promise<boolean>;
  ensureClient(clientId: string): Promise<void>;
  bindGrant(grantId: string, connectionId: string): Promise<void>;
}

export function createSqliteOAuthStore(sqlite: Database.Database): OAuthStore {
  return {
    adapterFactory: (onRefreshReuse) => createOidcAdapterFactory(sqlite, onRefreshReuse),
    claims: (id, agents) => readConnectionClaims(sqlite, agents, id),
    hasUser: async (id) => sqlite.prepare('SELECT 1 FROM users WHERE id = ?').get(id) !== undefined,
    ensureClient: async (id) => { ensureClientRegistered(sqlite, id); },
    bindGrant: async (id, connection) => { writeConnectionGrantDetail(sqlite, id, connection); },
  };
}
