import type { FastifyInstance, FastifyReply } from 'fastify';
import { SESSION_COOKIE_NAME, isPlainObject, AGENT_PATHS, type OwnedAgentView } from '@agent-chat/contracts';
import type { ApplicationServices } from '../../services.js';
import { DomainError } from '../../modules/errors.js';
import { readCookie } from './cookie.js';
import { sendError } from './error-envelope.js';

export function registerAgentRoutes(app: FastifyInstance, { auth, agents, hub }: ApplicationServices): void {
  const owner = (cookie?: string) => auth.resolveSession(readCookie(cookie, SESSION_COOKIE_NAME)).id;
  app.get(AGENT_PATHS.collection, (req, reply) => run(reply, () => {
    const ownerUserId = owner(req.headers.cookie);
    return { agents: agents.listOwnedAgents(ownerUserId).map((agent) => ({
      ...agent, receiverConnected: hub.receiverIsConnected(agent.id),
      connections: agents.listConnections(agent.id, ownerUserId),
    } satisfies OwnedAgentView)) };
  }));
  app.post(AGENT_PATHS.collection, (req, reply) => run(reply, () => {
    const ownerUserId = owner(req.headers.cookie);
    if (!isPlainObject(req.body) || typeof req.body['name'] !== 'string') return sendError(reply, 400, 'invalid_input');
    return reply.code(201).send({ agent: agents.createAgent({ ownerUserId, name: req.body['name'], description: req.body['description'], avatarUrl: req.body['avatarUrl'] }) });
  }));
  app.patch<{ Params: { agentId: string } }>('/api/agents/:agentId', (req, reply) => run(reply, () => {
    const ownerUserId = owner(req.headers.cookie);
    if (!isPlainObject(req.body)) return sendError(reply, 400, 'invalid_input');
    return { agent: agents.updateProfile({ ownerUserId, agentId: req.params.agentId, name: req.body['name'], description: req.body['description'], avatarUrl: req.body['avatarUrl'] }) };
  }));
  app.get<{ Params: { agentId: string } }>('/api/agents/:agentId/connections', (req, reply) => run(reply, () => ({ connections: agents.listConnections(req.params.agentId, owner(req.headers.cookie)) })));
  app.delete<{ Params: { agentId: string } }>('/api/agents/:agentId', (req, reply) => run(reply, () => ({ agent: agents.revokeAgent(req.params.agentId, owner(req.headers.cookie)) })));
  app.delete<{ Params: { connectionId: string } }>('/api/agent-connections/:connectionId', (req, reply) => run(reply, () => ({ connection: agents.revokeConnection(req.params.connectionId, owner(req.headers.cookie)) })));
}

async function run(reply: FastifyReply, handler: () => unknown): Promise<unknown> {
  try { return await handler(); }
  catch (error) {
    if (error instanceof DomainError) return sendError(reply, error.statusCode, error.code);
    throw error;
  }
}
