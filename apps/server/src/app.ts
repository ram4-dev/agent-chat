import Fastify, { type FastifyInstance } from 'fastify';
import { LIMITS } from '@agent-chat/contracts';
import { registerBrowserSocket } from './adapters/browser-ws/index.js';
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
 * WebSocket routes must exist before the HTTP adapter installs its catch-all
 * static route, so they are registered first.
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
    options: { maxPayload: LIMITS.WEBSOCKET_FRAME_BYTES },
  });

  registerBrowserSocket(app, {
    auth: services.auth,
    groups: services.groups,
    hub: services.hub,
    maxSocketsPerSession: LIMITS.BROWSER_SOCKETS_MAX_PER_SESSION,
  });

  registerHttpAdapter(app, { config, database, services });

  return app;
}

/** The instance type the factory returns, for adapters and tests that hold one. */
export type { FastifyInstance };
