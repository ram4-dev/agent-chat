import type { AsyncPort } from "../../services.js";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DOMAIN_ERROR_CODES, MESSAGE_PATHS, parseSendMessageRequest } from '@agent-chat/contracts';
import { DomainError } from '../../modules/errors.js';
import type { AgentsModule } from '../../modules/agents/index.js';
import type { GroupsModule } from '../../modules/groups/index.js';
import type { MessagingModule } from '../../modules/messaging/index.js';
import type { IdentityModule } from '../../modules/identity/index.js';
import type { InboxModule } from '../../modules/inbox/index.js';
import type { ApplicationHub } from '../../services.js';
import type { AgentCredential } from './auth.js';
import { McpUnauthenticated } from './auth.js';
import { AGENT_GUIDE, AGENT_GUIDE_URI, MCP_INSTRUCTIONS, agentReceiverUrl } from './instructions.js';
export interface McpServices {
    agents: AsyncPort<AgentsModule>;
    inbox: AsyncPort<InboxModule>;
    groups: AsyncPort<GroupsModule>;
    messaging: AsyncPort<MessagingModule>;
    identity: AsyncPort<IdentityModule>;
    hub: ApplicationHub;
}
export interface McpCredentialContext {
    authorize(authorization: string | undefined): Promise<AgentCredential>;
}
/** The tool names this surface exposes, kept in one place for the contract test. */
export const MCP_TOOL_NAMES = [
    'get_agent_instructions',
    'get_identity',
    'list_groups',
    'read_messages',
    'send_message',
    'get_inbox',
    'ack_inbox',
] as const;
type TextResult = {
    content: Array<{
        type: 'text';
        text: string;
    }>;
    isError?: boolean;
};
function ok(value: unknown): TextResult {
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
/** One stable answer for every refusal, so a client learns nothing about why. */
function refused(code: string): TextResult {
    return { isError: true, content: [{ type: 'text', text: code }] };
}
/**
 * Builds the MCP server.
 *
 * Every handler starts by resolving the credential on the current request,
 * because a tool call is a fresh authorization decision: a connection revoked
 * between two calls cannot use the second one. The handler body then reads
 * through the modules, so no tool can reach data the application's own routes
 * would refuse.
 */
export function createMcpServer({ agents, groups, inbox, messaging, identity, hub, }: McpServices, credential: () => AgentCredential, issuer: string): McpServer {
    const server = new McpServer({ name: 'agent-chat', version: '0.0.0' }, { instructions: MCP_INSTRUCTIONS });
    const context = (scope: AgentCredential['scopes'][number]) => {
        const current = credential();
        if (!current.scopes.includes(scope)) throw new DomainError('forbidden', 403, 'Scope required');
        return current;
    };
    server.registerResource('agent_chat_participation', AGENT_GUIDE_URI, {
        title: 'Respuestas y notificaciones de Agent Chat',
        description: 'Cómo responder chats, mantener el receptor activo y recuperar notificaciones pendientes.',
        mimeType: 'text/markdown',
    }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: AGENT_GUIDE }] }));
    server.registerTool('get_agent_instructions', {
        description: 'Read this first when connecting or resuming Agent Chat. Learn how to keep notifications active, reply to chats, recover pending events and acknowledge completed processing. Returns receiver configuration without credentials.',
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => ok({
        guide_uri: AGENT_GUIDE_URI,
        instructions: AGENT_GUIDE,
        mcp_url: `${issuer}/mcp`,
        receiver: {
            url: agentReceiverUrl(issuer), required_scope: 'agent:receive',
            authentication: 'OAuth access token in Authorization: Bearer header',
            ready_event: 'receiver.ready', notification_event: 'inbox.event',
            direction: 'receive-only',
        },
        granted_scopes: credential().scopes,
    }));
    server.registerTool('get_identity', {
        description: 'Confirm which agent this credential represents, who owns it, and which permissions it carries.',
        inputSchema: {},
    }, async () => guard(async () => {
        const { connectionId, scopes } = context('agent:read');
        // The authenticator already proved the connection and its agent are live,
        // so this resolves the same pair and reads the owner from it: no lookup by
        // owner is needed, and no other person's agent is reachable here.
        const { agent } = await agents.resolveActiveConnection(connectionId);
        return ok({
            agent: { id: agent.id, name: agent.name, status: agent.status },
            owner: await identity.getCurrentUser(agent.ownerUserId),
            connection: { id: connectionId, scopes },
        });
    }));
    server.registerTool('list_groups', {
        description: 'List only the groups this agent belongs to.',
        inputSchema: {},
    }, async () => guard(async () => {
        const principal = context('agent:read');
        return ok({
            groups: (await groups.listGroupsForAgent(principal.agentId)).map(({ group, role }) => ({
                id: group.id,
                name: group.name,
                role,
            })),
        });
    }));
    server.registerTool('read_messages', {
        description: 'Read messages from a group this agent belongs to, newest first.',
        inputSchema: {
            group_id: z.string().min(1),
            limit: z.number().int().min(1).max(100).optional(),
            before: z.string().min(1).optional(),
        },
    }, async ({ group_id, limit, before }) => guard(async () => ok(await messaging.list({
        author: { kind: 'agent', id: context('agent:read').agentId },
        groupId: group_id,
        limit: limit ?? 50,
        ...(before === undefined ? {} : { before }),
    }))));
    server.registerTool('send_message', {
        description: 'Publish a message as this agent in a group it belongs to, without needing a mention or a prior message.',
        inputSchema: {
            group_id: z.string().min(1),
            text: z.string().min(1),
            idempotency_key: z.string().min(1),
        },
    }, async ({ group_id, text, idempotency_key }) => guard(async () => {
        const principal = context('agent:send');
        if (!parseSendMessageRequest({ text, idempotencyKey: idempotency_key }).ok) throw new DomainError('invalid_input', 400, 'Message limits exceeded');
        const { message, replayed } = await messaging.send({
            author: { kind: 'agent', id: principal.agentId },
            groupId: group_id,
            text,
            idempotencyKey: idempotency_key,
        });
        // The same rule as the HTTP path: a replay already fanned out once, so
        // publishing it again would show the same message twice in the browser.
        if (!replayed) {
            hub.publishMessage(message);
        }
        return ok({ message, replayed, path: MESSAGE_PATHS.collection(group_id) });
    }));
    server.registerTool('get_inbox', {
        description: 'Retrieve pending events for this agent, oldest first. Events stay pending until acknowledged.',
        inputSchema: {
            limit: z.number().int().min(1).max(100).optional(),
            after: z.number().int().min(1).optional(),
        },
    }, async ({ limit, after }) => guard(async () => ok(await inbox.listPending({
        agentId: context('agent:receive').agentId,
        ...(limit === undefined ? {} : { limit }),
        ...(after === undefined ? {} : { after }),
    }))));
    server.registerTool('ack_inbox', {
        description: 'Mark a pending inbox event as processed. Repeating it is safe; reading message history does not do this.',
        inputSchema: { event_id: z.string().min(1) },
    }, async ({ event_id }) => guard(async () => ok(await inbox.acknowledge({ agentId: context('agent:receive').agentId, eventId: event_id }))));
    return server;
}
/**
 * Turns a refusal into one stable error code.
 *
 * A rejected tool call must not become a transport failure: the client needs to
 * distinguish "not allowed" from "the server broke", and it must not learn
 * whether a group exists when it may not.
 */
async function guard(run: () => TextResult | Promise<TextResult>): Promise<TextResult> {
    try {
        return await run();
    }
    catch (error) {
        if (error instanceof McpUnauthenticated) {
            return refused(DOMAIN_ERROR_CODES.unauthenticated);
        }
        const code = (error as {
            code?: unknown;
        }).code;
        return refused(typeof code === 'string' ? code : DOMAIN_ERROR_CODES.temporarily_unavailable);
    }
}
