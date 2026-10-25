import type { OwnedAgentView } from '@agent-chat/contracts';

export function connectionName(connection: OwnedAgentView['connections'][number]): string {
  return connection.clientName?.trim() || `Aplicación MCP sin nombre (${connection.oauthClientId.slice(-8)})`;
}

export function agentSetupState(agent?: OwnedAgentView, groupAgentIds: readonly string[] = []) {
  const identity = agent?.status === 'active';
  const authorized = identity && agent.connections.some(connection => !connection.revokedAt);
  return {
    identity,
    authorized,
    // Presence alone does not prove a webhook receipt or processing capability.
    notifications: authorized && agent.notificationActive === true,
    admitted: identity && groupAgentIds.includes(agent.id),
  };
}
