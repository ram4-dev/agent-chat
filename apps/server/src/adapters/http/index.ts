import { registerNativeAccessRoutes } from './native-access.js';
import type { FastifyInstance } from 'fastify';
import type { RuntimeConfig } from '../../config/index.js';
import type { DatabaseHandle } from '../../persistence/index.js';
import { createServices, type ApplicationServices } from '../../services.js';
import { registerAgentRoutes } from './agents.js';
import { registerAuthRoutes } from './auth.js';
import { registerGroupRoutes } from './groups.js';
import { registerMessageRoutes } from './messages.js';
import { registerErrorHandler, registerNotFoundHandler } from './error-envelope.js';
import { registerLivenessRoute } from './liveness.js';
import { registerOriginGuard } from './origin-guard.js';
import { registerWebApp } from './web-app.js';
import { registerAgentSkills } from './agent-skills.js';
import { registerNotificationRoutes } from '../../notifications/routes.js';

export interface HttpAdapterDependencies {
  config: RuntimeConfig;
  database?: DatabaseHandle;
  health?: () => Promise<boolean>;
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
  { config, database, health, services = createServices(database!) }: HttpAdapterDependencies,
): void {
  registerOriginGuard(app);
  registerAgentSkills(app, config.publicOrigin);
  registerAuthRoutes(app, {
    auth: services.auth,
    secureCookies: config.nodeEnv === 'production',
  });
  registerAgentRoutes(app, services);
  registerNotificationRoutes(app,services);
  if (services.nativeAccess && services.nativeDelivery) registerNativeAccessRoutes(app, { auth: services.auth, nativeAccess: services.nativeAccess, nativeDelivery: services.nativeDelivery });
  registerGroupRoutes(app, { ...(services.notifications?{notifications:services.notifications}:{}), auth: services.auth, groups: services.groups, hub: services.hub, ...(services.automation ? { automation: services.automation } : {}), ...(services.nativeStatus ? { nativeStatus: services.nativeStatus } : {}) });
  registerMessageRoutes(app, {
    auth: services.auth,
    messaging: services.messaging,
    hub: services.hub,
  });
  if (database) registerLivenessRoute(app, database);
  else app.get('/liveness', async () => {
    if (!health || !await health()) throw new Error('Database unavailable');
    return { status: 'ok', database: 'ok' };
  });
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
