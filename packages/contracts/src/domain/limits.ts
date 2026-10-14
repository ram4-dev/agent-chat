/**
 * Bounded limits from the approved Program Design.
 *
 * These values are the single source of truth for HTTP, MCP, WebSocket,
 * persistence, and UI code.
 */
export const LIMITS = {
  /** Maximum message body size in UTF-8 bytes. */
  MESSAGE_TEXT_BYTES: 8 * 1024,
  /** Default page size for message and inbox reads. */
  PAGE_SIZE_DEFAULT: 50,
  /** Hard ceiling for any page size. */
  PAGE_SIZE_MAX: 100,
  /** Concurrent browser WebSockets allowed per human session. */
  BROWSER_SOCKETS_MAX_PER_SESSION: 5,
  /** Concurrent agent-receiver WebSockets allowed per agent connection. */
  AGENT_RECEIVER_SOCKETS_MAX_PER_CONNECTION: 2,
  /** Maximum accepted WebSocket frame size in bytes. */
  WEBSOCKET_FRAME_BYTES: 64 * 1024,
  /** OAuth authorization code lifetime in seconds. */
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS: 5 * 60,
  /** Agent access token lifetime in seconds. */
  ACCESS_TOKEN_TTL_SECONDS: 10 * 60,
  /** Maximum lifetime of a rotating refresh-token family in days. */
  REFRESH_TOKEN_FAMILY_MAX_LIFETIME_DAYS: 30,
} as const;

export type Limits = typeof LIMITS;
