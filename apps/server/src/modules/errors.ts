import type { DomainErrorCode } from '@agent-chat/contracts';

/**
 * A failure the modules raise deliberately.
 *
 * A module never knows about HTTP, MCP, or WebSocket, so it cannot choose a
 * status code or a wire shape. It states the shared domain code and the HTTP
 * status an adapter should prefer; the adapter still decides the final body.
 *
 * `message` is for logs and tests only. Adapters respond with the stable code
 * and never echo the message, so a rejection cannot describe internal state.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly statusCode: number;

  constructor(code: DomainErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}
