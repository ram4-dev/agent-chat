import type { FastifyInstance, FastifyReply } from 'fastify';
import { DOMAIN_ERROR_CODES, type DomainErrorCode } from '@agent-chat/contracts';

export interface ErrorEnvelope {
  error: { code: DomainErrorCode };
}

/**
 * The server's HTTP error codes are the shared contract object itself, never a
 * copy, so a new code cannot appear on the wire without appearing in
 * `@agent-chat/contracts` for every other adapter and test.
 */
export { DOMAIN_ERROR_CODES };

export function errorEnvelope(code: DomainErrorCode): ErrorEnvelope {
  return { error: { code } };
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: DomainErrorCode,
): FastifyReply {
  return reply.code(statusCode).send(errorEnvelope(code));
}

export function sendNotFound(reply: FastifyReply): FastifyReply {
  return sendError(reply, 404, DOMAIN_ERROR_CODES.not_found);
}

/** Guarantees a stable body for any request that matches no route. */
export function registerNotFoundHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => sendNotFound(reply));
}

/**
 * Turns any other failure into a stable code. Internal details stay in the log,
 * never in the response body.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');

    const statusCode = toHttpStatus(error);
    sendError(
      reply,
      statusCode,
      statusCode < 500 ? DOMAIN_ERROR_CODES.invalid_input : DOMAIN_ERROR_CODES.temporarily_unavailable,
    );
  });
}

/** Keeps a client-error status when the thrown value carries one. */
function toHttpStatus(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    const { statusCode } = error as { statusCode?: unknown };
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return statusCode;
    }
  }
  return 500;
}
