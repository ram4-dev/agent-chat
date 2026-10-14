/**
 * Stable, transport-agnostic error codes.
 *
 * Every adapter (HTTP, MCP, WebSocket) maps its failures onto this set so the
 * browser client, the MCP client, and the tests cannot drift apart.
 */
export const DOMAIN_ERROR_CODES = {
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  invalid_input: 'invalid_input',
  rate_limited: 'rate_limited',
  temporarily_unavailable: 'temporarily_unavailable',
} as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[keyof typeof DOMAIN_ERROR_CODES];
