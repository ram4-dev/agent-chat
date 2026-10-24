/** Single liveness path served by the application server. */
export const LIVENESS_PATH = '/liveness';

/**
 * Body returned by {@link LIVENESS_PATH}. The server answers only after the
 * database connection is open and migrations have been applied.
 */
export interface LivenessResponse {
  status: 'ok';
  database: 'ok';
}
