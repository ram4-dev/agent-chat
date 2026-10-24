import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { LIVENESS_PATH, type LivenessResponse } from '@agent-chat/contracts';
import type { DatabaseHandle } from '../../persistence/index.js';

/**
 * Liveness answers only when the database is reachable, so a process that
 * cannot read its own store fails the probe instead of pretending to be up.
 */
export function registerLivenessRoute(
  app: FastifyInstance,
  database: DatabaseHandle,
): void {
  app.get(LIVENESS_PATH, async (): Promise<LivenessResponse> => {
    database.db.get(sql`SELECT 1 AS ok`);
    return { status: 'ok', database: 'ok' };
  });
}
