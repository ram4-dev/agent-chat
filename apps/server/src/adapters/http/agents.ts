import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { SESSION_COOKIE_NAME, isPlainObject, AGENT_PATHS, type OwnedAgentView, type OwnedAgentsResponse } from '@agent-chat/contracts';
import type { AgentRecord, ConnectionRecord } from '../../modules/agents/index.js';
import type { ApplicationServices } from '../../services.js';
import { DomainError } from '../../modules/errors.js';
import { readCookie } from './cookie.js';
import { sendError } from './error-envelope.js';
export function registerAgentRoutes(app: FastifyInstance, { auth, agents, hub, automation, nativeStatus }: ApplicationServices): void {
    const owner = async (cookie?: string) => (await auth.resolveSession(readCookie(cookie, SESSION_COOKIE_NAME))).id;
    app.get(AGENT_PATHS.collection, (req, reply) => run(reply, async () => {
        const ownerUserId = await owner(req.headers.cookie);
        return { capabilities: { nativeAutomation: !!nativeStatus, legacyAutomation: !!automation }, agents: await Promise.all((await agents.listOwnedAgents(ownerUserId)).map(async (agent) => ({
                ...agent, ...(nativeStatus ? { nativeRuntime: nativeStatus.summary(ownerUserId, agent.id) } : {}), receiverConnected: await hub.receiverIsConnected(agent.id) || automation?.agentConnected(agent.id) === true,
                connections: await agents.listConnections(agent.id, ownerUserId),
            } satisfies OwnedAgentView))) } satisfies OwnedAgentsResponse;
    }));
    if (nativeStatus) {
  app.get<{ Params: { agentId: string; groupId: string } }>('/api/agents/:agentId/native-status/:groupId', (req, reply) => run(reply, async () =>
    reply.header('cache-control', 'private, no-store').send({ native: nativeStatus.ownerState(await owner(req.headers.cookie), req.params.agentId, req.params.groupId) })));
    }
    if (automation) {
  app.get<{ Params: { agentId: string; groupId: string } }>('/api/agents/:agentId/automation/:groupId', (req, reply) => run(reply, async () =>
    automation.ownerState(await owner(req.headers.cookie), req.params.agentId, req.params.groupId)));
  app.patch<{ Params: { agentId: string; groupId: string } }>('/api/agents/:agentId/automation/:groupId', (req, reply) => run(reply, async () => {
    if (!isPlainObject(req.body) || typeof req.body['enabled'] !== 'boolean') return sendError(reply, 400, 'invalid_input');
    return { binding: automation.configureForOwner(await owner(req.headers.cookie), req.params.agentId, req.params.groupId, req.body['enabled']) };
  }));
  app.post<{ Params: { agentId: string } }>('/api/agents/:agentId/automation/recover', (req, reply) => run(reply, async () => {
    if (!isPlainObject(req.body) || typeof req.body['connectionId'] !== 'string' || typeof req.body['instanceId'] !== 'string' ||
        !z.string().uuid().safeParse(req.body['instanceId']).success) return sendError(reply, 400, 'invalid_input');
    return automation.recoverForOwner(await owner(req.headers.cookie), req.params.agentId, req.body['connectionId'], req.body['instanceId']);
  }));
    }
    app.post(AGENT_PATHS.collection, (req, reply) => run(reply, async () => {
        const ownerUserId = await owner(req.headers.cookie);
        if (!isPlainObject(req.body) || typeof req.body['name'] !== 'string')
            return sendError(reply, 400, 'invalid_input');
        return reply.code(201).send({ agent: await agents.createAgent({ ownerUserId, name: req.body['name'], description: req.body['description'], avatarUrl: req.body['avatarUrl'] }) } satisfies {
            agent: AgentRecord;
        });
    }));
    app.patch<{
        Params: {
            agentId: string;
        };
    }>('/api/agents/:agentId', (req, reply) => run(reply, async () => {
        const ownerUserId = await owner(req.headers.cookie);
        if (!isPlainObject(req.body))
            return sendError(reply, 400, 'invalid_input');
        return { agent: await agents.updateProfile({ ownerUserId, agentId: req.params.agentId, name: req.body['name'], description: req.body['description'], avatarUrl: req.body['avatarUrl'] }) } satisfies {
            agent: AgentRecord;
        };
    }));
    app.get<{
        Params: {
            agentId: string;
        };
    }>('/api/agents/:agentId/connections', (req, reply) => run(reply, async () => ({ connections: await agents.listConnections(req.params.agentId, await owner(req.headers.cookie)) } satisfies {
        connections: ConnectionRecord[];
    })));
    app.delete<{
        Params: {
            agentId: string;
        };
    }>('/api/agents/:agentId', (req, reply) => run(reply, async () => ({ agent: await agents.revokeAgent(req.params.agentId, await owner(req.headers.cookie)) } satisfies {
        agent: AgentRecord;
    })));
    app.delete<{
        Params: {
            connectionId: string;
        };
    }>('/api/agent-connections/:connectionId', (req, reply) => run(reply, async () => ({ connection: await agents.revokeConnection(req.params.connectionId, await owner(req.headers.cookie)) } satisfies {
        connection: ConnectionRecord;
    })));
}
async function run<T>(reply: FastifyReply, handler: () => T | Promise<T>): Promise<T | FastifyReply> {
    try {
        return await handler();
    }
    catch (error) {
        if (error instanceof DomainError)
            return sendError(reply, error.statusCode, error.code);
        throw error;
    }
}
