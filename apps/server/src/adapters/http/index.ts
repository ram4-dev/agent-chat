import type { FastifyInstance } from 'fastify';
import type { RuntimeConfig } from '../../config/index.js';
import type { DatabaseHandle } from '../../persistence/index.js';
import { createServices, type ApplicationServices } from '../../services.js';
import { registerAuthRoutes } from './auth.js';
import { registerGroupRoutes } from './groups.js';
import { registerMessageRoutes } from './messages.js';
import { registerErrorHandler, registerNotFoundHandler } from './error-envelope.js';
import { registerLivenessRoute } from './liveness.js';
import { registerOriginGuard } from './origin-guard.js';
import { registerWebApp } from './web-app.js';

export interface HttpAdapterDependencies {
  config: RuntimeConfig;
  database: DatabaseHandle;
  services?: ApplicationServices;
}

/**
 * Registers every HTTP surface of the application.
 *
 * The same-origin guard is installed before any route, so no mutating handler
 * exists on a request that has not already proved its origin. Adapters translate
 * transport input only; authorization and persistence rules live in the modules.
 */
export function registerHttpAdapter(
  app: FastifyInstance,
  { config, database, services = createServices(database) }: HttpAdapterDependencies,
): void {
  registerOriginGuard(app);
  registerAuthRoutes(app, {
    auth: services.auth,
    secureCookies: config.nodeEnv === 'production',
  });
  registerGroupRoutes(app, { auth: services.auth, groups: services.groups });
  registerMessageRoutes(app, {
    auth: services.auth,
    messaging: services.messaging,
    hub: services.hub,
  });
  registerLivenessRoute(app, database);
  registerWebApp(app, { webDistDir: config.webDistDir });
  registerErrorHandler(app);
  registerNotFoundHandler(app);
}

export {
  DOMAIN_ERROR_CODES,
  errorEnvelope,
  sendError,
  sendNotFound,
  type ErrorEnvelope,
} from './error-envelope.js';
export { clearedSessionCookie, readCookie, serializeSessionCookie } from './cookie.js';
export { isGuardedPath, isSameOriginRequest, registerOriginGuard } from './origin-guard.js';
export { contentTypeFor, resolveStaticFile } from './static-assets.js';
