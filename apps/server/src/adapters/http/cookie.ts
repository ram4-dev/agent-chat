/**
 * Minimal cookie reader and writer.
 *
 * The session cookie is the only cookie this server sets, so a full cookie
 * plugin would add a dependency without adding behavior. Values are validated
 * against the RFC 6265 `cookie-octet` set: a value with a separator, a space, or
 * a control character would otherwise let a caller inject header attributes.
 */
const SAFE_COOKIE_NAME = /^[A-Za-z0-9_$:-]+$/;
const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]*$/;

export interface SessionCookieOptions {
  /** `Secure` is added unless this is explicitly false (local development and test). */
  secure?: boolean;
  /** Seconds until the browser drops the cookie. Omitted means a session cookie. */
  maxAgeSeconds?: number;
}

export interface ClearedCookieOptions {
  secure?: boolean;
}

/**
 * Builds the `Set-Cookie` value for a session.
 *
 * `HttpOnly` keeps the session out of reach of scripts, `SameSite=Lax` keeps it
 * off cross-site requests, and `Path=/` makes it available to the whole
 * application instead of one subtree.
 */
export function serializeSessionCookie(
  name: string,
  value: string,
  options: SessionCookieOptions = {},
): string {
  assertSafe(name, value);

  const attributes = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];

  if (options.maxAgeSeconds !== undefined) {
    attributes.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options.secure ?? true) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

/** Expires the cookie in the browser as well as on the server. */
export function clearedSessionCookie(
  name: string,
  options: ClearedCookieOptions = {},
): string {
  return serializeSessionCookie(name, '', {
    secure: options.secure,
    maxAgeSeconds: 0,
  });
}

/** Returns the value of `name`, or undefined when the request does not carry it. */
export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }

  return undefined;
}

function assertSafe(name: string, value: string): void {
  if (!SAFE_COOKIE_NAME.test(name)) {
    throw new TypeError(`Unsafe cookie name: ${JSON.stringify(name)}`);
  }
  if (!SAFE_COOKIE_VALUE.test(value)) {
    throw new TypeError(`Unsafe cookie value for ${name}`);
  }
}
