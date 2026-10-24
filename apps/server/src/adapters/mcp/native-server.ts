import { nativeTicketSchema, nativeResultSchema, nativeProofSchema } from '../../modules/native-delivery/schema.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpServices } from './server.js';
import type { AgentCredential } from './auth.js';
import { DomainError } from '../../modules/errors.js';

/** Native credentials have their own surface; legacy automation/ACK is absent. */
export function createNativeMcpServer(services: McpServices, credential: () => AgentCredential): McpServer {
  const access = services.nativeAccess!;
  const server = new McpServer({ name: 'agent-chat', version: '0.0.0' }, { instructions: 'This connection uses native grants. Read get_identity to determine its kind and permitted selections. Native automatic controllers must use native delivery tools and native_finish for atomic publication and acknowledgement; never use legacy WebSocket receivers or manual inbox ACK. Interactive grants may reply only through their explicitly allowed identities and groups. Keep the authorized controller running while its host is available; report unsupported background execution honestly.' });
  const current = () => credential().connectionId;
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
  async function guard(operation: () => unknown | Promise<unknown>) {
    try { return result(await operation()); }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof DomainError ? error.code : 'temporarily_unavailable' }] }; }
  }
  server.registerTool('get_identity', { description: 'List explicitly granted identities and currently authorized groups.', inputSchema: {} }, async () => guard(async () => {
    const grant = access.resolve(current());
    return { grant: { id: grant.id, kind: grant.kind, scopes: grant.scopes }, identities: await Promise.all(access.visibleSelections(current()).map(async selection => ({
      ...selection, name: (await services.agents.getOwnedAgent(selection.agentId, grant.ownerUserId)).name,
    }))) };
  }));
  server.registerTool('list_groups', { description: 'List authorized groups for an explicitly selected identity.', inputSchema: { as_agent_id: z.string().uuid() } }, async ({ as_agent_id }) => guard(async () => {
    access.resolve(current());
    const ids = access.visibleSelections(current()).find(s => s.agentId === as_agent_id)?.groupIds ?? [];
    return { groups: (await services.groups.listGroupsForAgent(as_agent_id)).filter(item => ids.includes(item.group.id)).map(({ group, role }) => ({ id: group.id, name: group.name, role })) };
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
  if (services.nativeDelivery) {
    const delivery = services.nativeDelivery;
    server.registerTool('native_open', { description: 'Register a controller epoch without releasing uncertain execution.', inputSchema: { controllerId: z.string().uuid() } }, async ({ controllerId }) => guard(() => delivery.open(current(), controllerId)));
    server.registerTool('native_next', { description: 'Claim or recover durable work; started deliveries must only be observed.', inputSchema: { controllerId: z.string().uuid(), epoch: z.number().int().positive(), waitMs: z.number().int().min(0).max(10000).optional() } }, async ({ controllerId, epoch, waitMs }, extra) => {
      if (extra.signal.aborted) return guard(() => { throw new DomainError('temporarily_unavailable', 503, 'Cancelled'); });
      const initial = await guard(() => delivery.next(current(), controllerId, epoch));
      if ('isError' in initial || !waitMs || JSON.parse(initial.content[0]!.text).delivery || JSON.parse(initial.content[0]!.text).blocked) return initial;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); unsubscribe(); extra.signal.removeEventListener('abort', finish); resolve(); };
        const unsubscribe = services.hub.subscribeMessages(finish);
        const timer = setTimeout(finish, waitMs);
        extra.signal.addEventListener('abort', finish, { once: true });
        if (extra.signal.aborted) finish();
      });
      return guard(() => { if (extra.signal.aborted) throw new DomainError('temporarily_unavailable', 503, 'Cancelled'); return delivery.next(current(), controllerId, epoch); });
    });
    server.registerTool('native_begin', { description: 'Consume one start authorization. Never retry an uncertain start.', inputSchema: { ticket: nativeTicketSchema } }, async ({ ticket }) => guard(() => delivery.begin(current(), ticket)));
    server.registerTool('native_grok_begin', { description: 'Consume the Grok task authorization before message processing. Webhook acceptance is not authorization. Never retry an ambiguous task start.', inputSchema: { ticket: nativeTicketSchema, startKey: z.string().uuid() } }, async ({ ticket, startKey }) => guard(() => delivery.grokBegin(current(), ticket, startKey)));
    server.registerTool('native_cancel_begin', { description: 'Consume one cancellation dispatch for an owner-requested cancellation.', inputSchema: { ticket: nativeTicketSchema } }, async ({ ticket }) => guard(() => delivery.cancelBegin(current(), ticket)));
    server.registerTool('native_running', { description: 'Record the accepted native run reference.', inputSchema: { ticket: nativeTicketSchema, runRef: z.string().min(1).max(500) } }, async ({ ticket, runRef }) => guard(() => delivery.running(current(), ticket, runRef)));
    server.registerTool('native_pending', { description: 'Record an approval or uncertain run without releasing its slot.', inputSchema: { ticket: nativeTicketSchema, state: z.enum(['awaiting_approval','needs_review']) } }, async ({ ticket, state }) => guard(() => delivery.pending(current(), ticket, state)));
    server.registerTool('native_save', { description: 'Persist an immutable result with signed terminal evidence.', inputSchema: { ticket: nativeTicketSchema, result: nativeResultSchema, proof: nativeProofSchema } }, async ({ ticket, result, proof }) => guard(() => delivery.save(current(), ticket, result, proof)));
    server.registerTool('native_finish', { description: 'Publish the saved result and ACK atomically; does not generate.', inputSchema: { ticket: nativeTicketSchema } }, async ({ ticket }) => guard(() => delivery.finish(current(), ticket)));
    server.registerTool('native_delivery', { description: 'Read an authorized delivery or its terminal receipt.', inputSchema: { eventId: z.string().uuid() } }, async ({ eventId }) => guard(() => delivery.get(current(), eventId)));
  }
  return server;
}
