import type { FastifyInstance } from 'fastify';
import { DOMAIN_ERROR_CODES } from '@agent-chat/contracts';
import { sendError } from './error-envelope.js';

/** Methods that can change server state and therefore must prove their origin. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface OriginCheck {
  method: string;
  origin: string | undefined;
  host: string | undefined;
  /** `Sec-Fetch-Site` when the browser sends it; `cross-site` is a hard rejection. */
  secFetchSite?: string | undefined;
}

/**
 * Same-origin CSRF check for state-changing requests.
 *
 * A browser always sends `Origin` on a state-changing request, and a page on
 * another origin cannot forge it. Requiring the header to match the host the
 * request arrived on therefore blocks cross-site form posts and fetch calls
 * without a token round trip, and it cannot be satisfied by a request that
 * deliberately omits `Origin` (as a non-browser client would).
 */
export function isSameOriginRequest({
  method,
  origin,
  host,
  secFetchSite,
}: OriginCheck): boolean {
  if (!MUTATING_METHODS.has(method.toUpperCase())) {
    return true;
  }

  if (secFetchSite === 'cross-site') {
    return false;
  }

  if (origin === undefined || origin === '' || host === undefined || host === '') {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  return parsed.host.toLowerCase() === host.toLowerCase();
}

/**
 * Paths whose mutations are performed by a browser session cookie.
 *
 * The check applies here and nowhere else. OAuth protocol endpoints are used by
 * native MCP clients that send no `Origin` at all, and they authenticate through
 * PKCE, a client identifier, and a single-use code; requiring a browser origin
 * there would reject every legitimate client. The consent screen is included
 * because it is a browser form that approves agent access, which is exactly the
 * kind of request CSRF protection exists for.
 */
const GUARDED_PREFIXES = ['/api/', '/oauth/interaction/'] as const;

export function isGuardedPath(url: string): boolean {
  return GUARDED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Rejects every guarded state-changing request that is not same-origin, before
 * routing, so no mutating handler can run without the check.
 *
 * The rejection carries the shared `forbidden` code and says nothing about why.
 */
export function registerOriginGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (
      !isGuardedPath(request.url) ||
      isSameOriginRequest({
        method: request.method,
        origin: headerValue(request.headers.origin),
        host: headerValue(request.headers.host),
        secFetchSite: headerValue(request.headers['sec-fetch-site']),
      })
    ) {
      return;
    }

    request.log.warn(
      { method: request.method, url: request.url.split('?')[0] },
      'rejected a state-changing request without a same-origin Origin header',
    );

    return sendError(reply, 403, DOMAIN_ERROR_CODES.forbidden);
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
