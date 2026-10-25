import type { NativeAgentSummary } from '../domain/native-runtime.js';
export const AGENT_PATHS = {
  collection: '/api/agents',
  one: (id: string) => `/api/agents/${id}`,
  connections: (id: string) => `/api/agents/${id}/connections`,
  connection: (id: string) => `/api/agent-connections/${id}`,
} as const;

export interface OwnedAgentView {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  status: 'active' | 'revoked';
  receiverConnected: boolean;
  notificationActive?: boolean;
  nativeRuntime?: NativeAgentSummary | null;
  connections: {
    id: string;
    oauthClientId: string;
    /** Registered OAuth application name; absent for legacy clients. */
    clientName?: string | null;
    scopes: string[];
    revokedAt: string | null;
    createdAt: string;
  }[];
}

export interface OwnedAgentsResponse {
  capabilities?: { nativeAutomation: boolean; legacyAutomation: boolean };
  agents: OwnedAgentView[];
}
