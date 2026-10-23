import Fastify, { type FastifyInstance } from 'fastify';
import { LIMITS } from '@agent-chat/contracts';
import { registerAgentSocket } from './adapters/agent-ws/index.js';
import { registerBrowserSocket } from './adapters/browser-ws/index.js';
import { registerInteractionRoutes } from './adapters/oauth/interactions.js';
import { registerMcpRoutes } from './adapters/mcp/routes.js';
import {
  createOidcProvider,
  loadOrGenerateJwks,
  toPublicJwk,
} from './adapters/oauth/provider.js';
import { registerOidcRoutes } from './adapters/oauth/routes.js';
import type { RuntimeConfig } from './config/index.js';
import type { DatabaseHandle } from './persistence/index.js';
import { createServices, type ApplicationServices } from './services.js';
import { registerHttpAdapter } from './adapters/http/index.js';

export interface AppDependencies {
  config: RuntimeConfig;
  database: DatabaseHandle;
  services?: ApplicationServices;
}

/**
 * Builds the Fastify application. The returned instance is not listening: the
 * entrypoint decides when the process may accept traffic.
 *
 * Route order is load-bearing. The authorization server owns fixed root paths
 * and the browser socket owns a fixed path, so both must be registered before
 * the static catch-all that serves the client bundle; otherwise the catch-all
 * would answer for them with the not-found envelope.
 */
export async function createApp({
  config,
  database,
  services = createServices(database),
}: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
  });

  const sockets = await import('@fastify/websocket');
  await app.register(sockets.default, {
    options: { maxPayload: limits.websocketFrameBytes },
  });

  const jwks = await loadOrGenerateJwks(config.oidcJwksPath);
  const provider = await createOidcProvider({
    issuer: config.publicOrigin,
    sqlite: database.sqlite,
    agents: services.agents,
    jwks,
    interactionsUrl: (uid) => `${interactionPrefix}/${uid}`,
    ...(providerLogLevelOf(config) === undefined ? {} : { logLevel: providerLogLevelOf(config) }),
  });

  // Handlers reach the provider through the instance rather than through a
  // module-level singleton, so two applications in one process stay isolated.
  app.decorate('oidcProvider', provider);

  // A plain HTML form posts urlencoded, so the consent screen needs a parser
  // for it; the application API keeps its JSON parser.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, new URLSearchParams(body as string));
    },
  );

  await registerOidcRoutes(app, provider);
  registerInteractionRoutes(app, {
    provider,
    agents: services.agents,
    auth: services.auth,
    sqlite: database.sqlite,
    issuer: config.publicOrigin,
  });

  // The MCP endpoint is mounted before the static catch-all for the same reason
  // the OAuth routes are: the catch-all would otherwise answer for it.
  await registerMcpRoutes(app, {
    publicJwk: toPublicJwk(jwks.keys[0]),
    issuer: config.publicOrigin,
    audience: config.publicOrigin,
    services,
  });

  registerAgentSocket(app, {
    publicJwk: toPublicJwk(jwks.keys[0]), issuer: config.publicOrigin,
    audience: config.publicOrigin, services,
  });

  registerBrowserSocket(app, {
    auth: services.auth,
    groups: services.groups,
    hub: services.hub,
    maxSocketsPerSession: limits.browserSocketsPerSession,
  });

  registerHttpAdapter(app, { config, database, services });

  return app;
}

/** Read once so the route table and the provider cannot disagree about sizes. */
const limits = {
  websocketFrameBytes: LIMITS.WEBSOCKET_FRAME_BYTES,
  browserSocketsPerSession: LIMITS.BROWSER_SOCKETS_MAX_PER_SESSION,
} as const;

const interactionPrefix = '/oauth/interaction';

/**
 * The provider accepts a narrower set of levels than the application does, so
 * the two are mapped rather than passed through; a silent or trace-level
 * application run disables the provider's own logging.
 */
function providerLogLevelOf(config: RuntimeConfig): string | undefined {
  const level = config.logLevel;
  return level === 'debug' || level === 'info' || level === 'warn' || level === 'error'
    ? level
    : undefined;
}

/** The instance type the factory returns, for adapters and tests that hold one. */
export type { FastifyInstance };
