import Fastify, { type FastifyInstance } from 'fastify';
import type { RuntimeConfig } from './config/index.js';
import type { DatabaseHandle } from './persistence/index.js';
import { registerHttpAdapter } from './adapters/http/index.js';

export interface AppDependencies {
  config: RuntimeConfig;
  database: DatabaseHandle;
}

/**
 * Builds the Fastify application. The returned instance is not listening: the
 * entrypoint decides when the process may accept traffic.
 */
export async function createApp({
  config,
  database,
}: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
  });

  registerHttpAdapter(app, { config, database });

  return app;
}

/** The instance type the factory returns, for adapters and tests that hold one. */
export type { FastifyInstance };
