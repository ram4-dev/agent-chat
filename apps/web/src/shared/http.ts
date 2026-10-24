/**
 * Minimal structural view of `fetch`.
 *
 * Every web feature depends on this shape instead of the global, so a feature
 * can be exercised with a two-line fake and never needs a real network.
 */
export interface JsonFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface JsonFetchInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export type JsonFetch = (
  input: string,
  init?: JsonFetchInit,
) => Promise<JsonFetchResponse>;

export const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * Reads the stable domain code out of an error envelope.
 *
 * The server never sends a human-readable reason, so the UI must not invent one
 * from the response: it maps the code to its own copy.
 */
export function errorCodeOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const error = (body as { error?: { code?: unknown } }).error;
  return typeof error?.code === 'string' ? error.code : undefined;
}
