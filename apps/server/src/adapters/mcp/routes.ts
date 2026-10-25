import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { DomainError } from '../../modules/errors.js';
import { sendError } from '../http/error-envelope.js';
import { DOMAIN_ERROR_CODES } from '@agent-chat/contracts';
import type { JWK } from 'jose';
import { ALL_AGENT_SCOPES } from '../../modules/agents/index.js';
import { createMcpAuthenticator, McpUnauthenticated, type AgentCredential } from './auth.js';
import { createMcpServer, type McpServices } from './server.js';

export const MCP_PATH = '/mcp';

export interface McpRoutesOptions {
  publicJwk: JWK;
  issuer: string;
  audience: string;
  services: McpServices;
}

/**
 * Mounts the MCP endpoint.
 *
 * The route lives in its own scope for the same reason the OAuth routes do: Fastify
 * parses a body before the handler runs, and the transport expects either to read
 * the stream itself or to be handed the parsed message, so the media type is parsed
 * here and passed on rather than drained first.
 *
 * Each request gets its own server and transport, which is the stateless shape: a
 * tool call is one round trip, and nothing about one call may carry over to the next
 * one.
 */
export async function registerMcpRoutes(app: FastifyInstance, options: McpRoutesOptions): Promise<void> {
  const { publicJwk, issuer, audience, services } = options;
  const authorize = createMcpAuthenticator({ publicJwk, issuer, audience, agents: services.agents });

  app.get('/.well-known/oauth-protected-resource', () => ({
    resource: audience,
    authorization_servers: [issuer],
    scopes_supported: ['openid', ...ALL_AGENT_SCOPES],
    bearer_methods_supported: ['header'],
  }));

  async function configurationPrincipal(authorization: string | undefined) {
    const principal = await authorize(authorization);
    if (services.nativeAccess?.classify(principal.connectionId) || !principal.scopes.includes('agent:manage')) throw new DomainError('forbidden', 403, 'Scope required');
    const { agent } = await services.agents.resolveActiveConnection(principal.connectionId);
    return { principal, agent };
  }
  const profileInput = z.object({name:z.string().min(1).max(60),description:z.string().max(280).optional(),avatarUrl:z.string().max(2048).optional()}).strict();
  app.get('/agent/configuration', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    try {
      const {principal,agent} = await configurationPrincipal(request.headers.authorization);
      return {agent:{id:agent.id,name:agent.name,description:agent.description,avatarUrl:agent.avatarUrl},connection:{id:principal.connectionId,scopes:principal.scopes},notifications:services.notifications?await services.notifications.status(principal):{configured:false,active:false}};
    } catch(error) { return configurationError(error,reply); }
  });
  app.patch('/agent/configuration/profile', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    try {
      const {principal,agent} = await configurationPrincipal(request.headers.authorization);
      const input=profileInput.safeParse(request.body);
      if(!input.success)return sendError(reply,400,'invalid_input');
      const updated=await services.agents.updateProfile({agentId:principal.agentId,ownerUserId:agent.ownerUserId,name:input.data.name,description:input.data.description??agent.description,avatarUrl:input.data.avatarUrl??agent.avatarUrl});
      services.hub.publishAgentState(principal.agentId);
      return {agent:{id:updated.id,name:updated.name,description:updated.description,avatarUrl:updated.avatarUrl}};
    }catch(error){return configurationError(error,reply);}
  });
  for(const action of ['pause','test'] as const) app.post(`/agent/configuration/notifications/${action}`,async(request,reply)=>{
    reply.header('cache-control','private, no-store');
    try{
      const {principal,agent}=await configurationPrincipal(request.headers.authorization);
      if(!services.notifications)return sendError(reply,409,'conflict');
      const state=await services.notifications.status(principal);
      if(!state.configured) return sendError(reply,409,'conflict');
      if(action==='pause')await services.notifications.pause(agent.ownerUserId,principal.agentId,principal.connectionId);
      else {await services.notifications.probe(agent.ownerUserId,principal.agentId,principal.connectionId);await services.notifications.dispatch();}
      return services.notifications.status(principal);
    }catch(error){return configurationError(error,reply);}
  });
  function configurationError(error:unknown,reply:import('fastify').FastifyReply){
    if(error instanceof McpUnauthenticated)return sendError(reply,401,'unauthenticated');
    if(error instanceof DomainError)return sendError(reply,error.statusCode,error.code);
    return sendError(reply,503,'temporarily_unavailable');
  }

  app.post('/agent/configuration/notifications', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    try {
      const principal = await authorize(request.headers.authorization);
      if (services.nativeAccess?.classify(principal.connectionId) || !principal.scopes.includes('agent:manage')) return sendError(reply, 403, 'forbidden');
      const input = z.object({platform:z.enum(['grokbot','generic']),url:z.string().max(2048),secret:z.string().min(8).max(4096)}).strict().safeParse(request.body);
      if (!input.success) return sendError(reply, 400, 'invalid_input');
      if (!services.notifications) return sendError(reply, 409, 'conflict');
      const { agent } = await services.agents.resolveActiveConnection(principal.connectionId);
      await services.notifications.configure(agent.ownerUserId, principal.agentId, {...input.data,connectionId:principal.connectionId});
      await services.notifications.probe(agent.ownerUserId, principal.agentId,principal.connectionId);
      await services.notifications.dispatch();
      return services.notifications.status(principal);
    } catch (error) {
      if (error instanceof McpUnauthenticated) return sendError(reply, 401, 'unauthenticated');
      if (error instanceof DomainError) return sendError(reply, error.statusCode, error.code);
      request.log.error('Private agent notification configuration failed');
      return sendError(reply, 503, 'temporarily_unavailable');
    }
  });

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      try {
        const parsed: unknown = JSON.parse(body as string);
        done(null, parsed);
      } catch (error) {
        done(error as Error, undefined);
      }
    });

    scope.route({
      method: ['GET', 'POST', 'DELETE'],
      url: MCP_PATH,
      handler: async (request, reply) => {
        reply.hijack();

        let credential: AgentCredential;
        try {
          credential = await authorize(request.headers.authorization);
        } catch (error) {
          if (!(error instanceof McpUnauthenticated)) {
            throw error;
          }
          reply.raw.setHeader('www-authenticate', `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`);
          return write(reply.raw, 401, {
            jsonrpc: '2.0',
            error: { code: -32001, message: DOMAIN_ERROR_CODES.unauthenticated },
          });
        }

        const server = createMcpServer(services, () => credential, issuer);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        transport.onclose = () => {
          void server.close();
        };

        await server.connect(transport);
        // Closing a stateless HTTP request must cancel its pending tool handlers.
        // Otherwise an abandoned long poll can claim an event for a dead client.
        const disconnected = () => { void server.close(); };
        request.raw.once('aborted', disconnected);
        reply.raw.once('close', disconnected);
        await transport.handleRequest(
          request.raw,
          reply.raw,
          request.body as undefined | Record<string, unknown>,
        );
        return reply;
      },
    });
  });
}

function write(raw: ServerResponse, status: number, payload: {
  jsonrpc: '2.0';
  error: { code: number; message: string };
}): void {
  raw.statusCode = status;
  raw.setHeader('content-type', 'application/json');
  raw.end(JSON.stringify(payload));
}
