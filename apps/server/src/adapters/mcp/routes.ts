import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DOMAIN_ERROR_CODES } from '@agent-chat/contracts';
import type { JWK } from 'jose';
import { AGENT_SCOPES } from '../../modules/agents/index.js';
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
    scopes_supported: ['openid', ...AGENT_SCOPES],
    bearer_methods_supported: ['header'],
  }));

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
