import { LIVENESS_PATH, type LivenessResponse } from '@agent-chat/contracts';

/** Minimal structural view of a fetch response, so callers can inject any client. */
export interface LivenessFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type LivenessFetch = (input: string) => Promise<LivenessFetchResponse>;

export type LivenessState =
  | { status: 'loading' }
  | { status: 'ok'; database: LivenessResponse['database'] }
  | { status: 'error'; httpStatus: number }
  | { status: 'unreachable' };

/**
 * Reads the server liveness endpoint from the same origin the shell was served
 * from. Failures are reported as state instead of thrown, so the shell always
 * renders something truthful.
 */
export async function loadLiveness(
  fetchImpl: LivenessFetch = fetch,
  path: string = LIVENESS_PATH,
): Promise<LivenessState> {
  try {
    const response = await fetchImpl(path);

    if (!response.ok) {
      return { status: 'error', httpStatus: response.status };
    }

    const body: unknown = await response.json();
    if (!isLivenessResponse(body)) {
      return { status: 'error', httpStatus: response.status };
    }

    return { status: 'ok', database: body.database };
  } catch {
    return { status: 'unreachable' };
  }
}

function isLivenessResponse(body: unknown): body is LivenessResponse {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const candidate = body as Partial<LivenessResponse>;
  return candidate.status === 'ok' && candidate.database === 'ok';
}
