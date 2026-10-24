import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpServices } from './server.js';
import type { AgentCredential } from './auth.js';
import { DomainError } from '../../modules/errors.js';

/** Native credentials have their own surface; legacy automation/ACK is absent. */
export function createNativeMcpServer(services: McpServices, credential: () => AgentCredential): McpServer {
  const access = services.nativeAccess!;
  const server = new McpServer({ name: 'agent-chat', version: '0.0.0' });
  const current = () => credential().connectionId;
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
  function guard(operation: () => unknown) {
    try { return result(operation()); }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof DomainError ? error.code : 'temporarily_unavailable' }] }; }
  }
  server.registerTool('get_identity', { description: 'List explicitly granted identities and currently authorized groups.', inputSchema: {} }, async () => guard(() => {
    const grant = access.resolve(current());
    return { grant: { id: grant.id, kind: grant.kind, scopes: grant.scopes }, identities: access.visibleSelections(current()).map(selection => ({
      ...selection, name: services.agents.getOwnedAgent(selection.agentId, grant.ownerUserId).name,
    })) };
  }));
  server.registerTool('list_groups', { description: 'List authorized groups for an explicitly selected identity.', inputSchema: { as_agent_id: z.string().uuid() } }, async ({ as_agent_id }) => guard(() => {
    access.resolve(current());
    const ids = access.visibleSelections(current()).find(s => s.agentId === as_agent_id)?.groupIds ?? [];
    return { groups: services.groups.listGroupsForAgent(as_agent_id).filter(item => ids.includes(item.group.id)).map(({ group, role }) => ({ id: group.id, name: group.name, role })) };
  }));
  server.registerTool('read_messages', {
    description: 'Read history using one granted identity and group. Does not acknowledge inbox events.',
    inputSchema: { as_agent_id: z.string().uuid(), group_id: z.string().uuid(), limit: z.number().int().min(1).max(100).optional(), before: z.string().min(1).optional() },
  }, async ({ as_agent_id, group_id, limit, before }) => guard(() => {
    access.requireAccess(current(), 'native:read', as_agent_id, group_id);
    return services.messaging.list({ author: { kind: 'agent', id: as_agent_id }, groupId: group_id, limit: limit ?? 50, ...(before === undefined ? {} : { before }) });
  }));
  server.registerTool('send_message', {
    description: 'Interactive publication as an explicitly granted identity. Never consumes automatic inbox work.',
    inputSchema: { as_agent_id: z.string().uuid(), group_id: z.string().uuid(), text: z.string().min(1), idempotency_key: z.string().min(1) },
  }, async ({ as_agent_id, group_id, text, idempotency_key }) => guard(() => {
    return access.publishInteractive(current(), { agentId: as_agent_id, groupId: group_id, text, idempotencyKey: idempotency_key });
  }));
  return server;
}
