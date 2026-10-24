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
  nativeRuntime?: NativeAgentSummary | null;
  connections: {
    id: string;
    oauthClientId: string;
    scopes: string[];
    revokedAt: string | null;
    createdAt: string;
  }[];
}

export interface OwnedAgentsResponse {
  capabilities?: { nativeAutomation: boolean; legacyAutomation: boolean };
  agents: OwnedAgentView[];
}
