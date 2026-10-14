import type { FastifyInstance } from 'fastify';
import type { RuntimeConfig } from '../../config/index.js';
import type { DatabaseHandle } from '../../persistence/index.js';
import { registerErrorHandler, registerNotFoundHandler } from './error-envelope.js';
import { registerLivenessRoute } from './liveness.js';
import { registerWebApp } from './web-app.js';

export interface HttpAdapterDependencies {
  config: RuntimeConfig;
  database: DatabaseHandle;
}

/**
 * Registers every HTTP surface of the application. Adapters translate transport
 * input only; authorization and persistence rules live in the modules.
 */
export function registerHttpAdapter(
  app: FastifyInstance,
  dependencies: HttpAdapterDependencies,
): void {
  registerLivenessRoute(app, dependencies.database);
  registerWebApp(app, { webDistDir: dependencies.config.webDistDir });
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
export { contentTypeFor, resolveStaticFile } from './static-assets.js';
