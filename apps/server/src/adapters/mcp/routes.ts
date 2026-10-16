import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DOMAIN_ERROR_CODES } from '@agent-chat/contracts';
import type { JWK } from 'jose';
import { createMcpAuthenticator, McpUnauthenticated } from './auth.js';
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

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (error) {
        done(error as Error, undefined);
      }
    });

    scope.route({
      method: ['GET', 'POST', 'DELETE'],
      url: MCP_PATH,
      handler: async (request, reply) => {
        reply.hijack();

        let credential;
        try {
          credential = await authorize(request.headers.authorization);
        } catch (error) {
          if (!(error instanceof McpUnauthenticated)) {
            throw error;
          }
          return write(reply.raw, 401, {
            jsonrpc: '2.0',
            error: { code: -32001, message: DOMAIN_ERROR_CODES.unauthenticated },
          });
        }

        const server = createMcpServer(services, () => credential);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        transport.onclose = () => {
          void server.close();
        };

        await server.connect(transport);
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

function write(res: unknown, status: number, payload: unknown): void {
  const raw = res as {
    statusCode?: number;
    setHeader(name: string, value: string): void;
    end(chunk: string): void;
  };
  raw.statusCode = status;
  raw.setHeader('content-type', 'application/json');
  raw.end(JSON.stringify(payload));
}
