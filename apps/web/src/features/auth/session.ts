import {
  AUTH_PATHS,
  parseAuthResponse,
  parseCurrentUserResponse,
  type PublicUser,
} from "@agent-chat/contracts";
import {
  errorCodeOf,
  JSON_HEADERS,
  type JsonFetch,
  type JsonFetchResponse,
} from "../../shared/http";

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: PublicUser }
  | { status: "rejected"; code: string }
  | { status: "error"; httpStatus: number };

export interface Credentials {
  email: string;
  password: string;
}

export interface Registration extends Credentials {
  displayName: string;
}

/**
 * Reads the current session.
 *
 * The session cookie is HttpOnly, so the browser cannot inspect it: the only
 * way to know who is signed in is to ask the server. A 401 is an ordinary
 * answer, not a failure, while any other non-OK status is reported as an error
 * so the shell does not silently claim the visitor is anonymous.
 */
export async function loadSession(
  fetchImpl: JsonFetch = fetch,
): Promise<SessionState> {
  try {
    const response = await fetchImpl(AUTH_PATHS.me);

    if (response.status === 401) {
      return { status: "anonymous" };
    }
    if (!response.ok) {
      return { status: "error", httpStatus: response.status };
    }

    const parsed = parseCurrentUserResponse(await response.json());
    return parsed.ok
      ? { status: "authenticated", user: parsed.value.user }
      : { status: "error", httpStatus: response.status };
  } catch {
    return { status: "error", httpStatus: 0 };
  }
}

/** Registers an account and a session in one call. */
export function registerAccount(
  input: Registration,
  fetchImpl: JsonFetch = fetch,
): Promise<SessionState> {
  return postCredentials(AUTH_PATHS.register, input, fetchImpl);
}

/** Starts a session for an existing account. */
export function loginAccount(
  input: Credentials,
  fetchImpl: JsonFetch = fetch,
): Promise<SessionState> {
  return postCredentials(AUTH_PATHS.login, input, fetchImpl);
}

async function postCredentials(
  path: string,
  input: Credentials | Registration,
  fetchImpl: JsonFetch,
): Promise<SessionState> {
  try {
    const response = await fetchImpl(path, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      return failureFrom(response, await response.json());
    }

    const parsed = parseAuthResponse(await response.json());
    return parsed.ok
      ? { status: "authenticated", user: parsed.value.user }
      : { status: "error", httpStatus: response.status };
  } catch {
    return { status: "error", httpStatus: 0 };
  }
}

/**
 * Keeps the server's stable code so the form can explain what happened without
 * ever repeating a raw message from the response.
 */
function failureFrom(response: JsonFetchResponse, body: unknown): SessionState {
  const code = errorCodeOf(body);
  return code === undefined
    ? { status: "error", httpStatus: response.status }
    : { status: "rejected", code };
}

/** Short, human-readable explanation of a rejected attempt. */
export function describeRejection(code: string): string {
  switch (code) {
    case "conflict":
      return "Ese correo ya tiene una cuenta. Elegí Ingresar.";
    case "unauthenticated":
      return "El correo o la contraseña no coinciden.";
    case "invalid_input":
      return "Revisá los datos. La contraseña debe tener al menos 12 caracteres.";
    case "forbidden":
      return "No pudimos validar la solicitud. Recargá e intentá de nuevo.";
    case "rate_limited":
      return "Hiciste muchos intentos. Esperá un momento y volvé a probar.";
    default:
      return "No pudimos completar la solicitud. Intentá de nuevo.";
  }
}
