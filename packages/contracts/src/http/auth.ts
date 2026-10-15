import {
  isPlainObject,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordShape,
  type Parsed,
} from '../domain/auth.js';

/** The four session routes served by the human HTTP adapter. */
export const AUTH_PATHS = {
  register: '/api/auth/register',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  me: '/api/auth/me',
} as const;

/**
 * Name of the opaque session cookie. The cookie is the only place a session
 * identifier travels: never a body, never a URL, never a log line.
 */
export const SESSION_COOKIE_NAME = 'agent_chat_session';

/**
 * The only user projection a browser ever receives. It deliberately has no
 * password field, so the hash cannot be returned by simply spreading a row.
 */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface RegisterRequest {
  email: string;
  displayName: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: PublicUser;
}

export interface CurrentUserResponse {
  user: PublicUser;
}

export interface LogoutResponse {
  status: 'ok';
}

export function parseRegisterRequest(body: unknown): Parsed<RegisterRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body:not_object' };
  }

  const email = validateEmail(body['email']);
  if (!email.ok) {
    return email;
  }

  const displayName = validateDisplayName(body['displayName']);
  if (!displayName.ok) {
    return displayName;
  }

  const password = validatePassword(body['password']);
  if (!password.ok) {
    return password;
  }

  return {
    ok: true,
    value: {
      email: email.value,
      displayName: displayName.value,
      password: password.value,
    },
  };
}

export function parseLoginRequest(body: unknown): Parsed<LoginRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body:not_object' };
  }

  const email = validateEmail(body['email']);
  if (!email.ok) {
    return email;
  }

  const password = validatePasswordShape(body['password']);
  if (!password.ok) {
    return password;
  }

  return { ok: true, value: { email: email.value, password: password.value } };
}

export function parseAuthResponse(body: unknown): Parsed<AuthResponse> {
  const user = parsePublicUser(body, 'user');
  return user.ok ? { ok: true, value: { user: user.value } } : user;
}

export function parseCurrentUserResponse(body: unknown): Parsed<CurrentUserResponse> {
  const user = parsePublicUser(body, 'user');
  return user.ok ? { ok: true, value: { user: user.value } } : user;
}

function parsePublicUser(body: unknown, key: string): Parsed<PublicUser> {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body:not_object' };
  }

  const candidate = body[key];
  if (!isPlainObject(candidate)) {
    return { ok: false, reason: `${key}:not_object` };
  }

  const fields = ['id', 'email', 'displayName', 'createdAt'] as const;
  for (const field of fields) {
    if (typeof candidate[field] !== 'string') {
      return { ok: false, reason: `${key}.${field}:not_text` };
    }
  }

  return {
    ok: true,
    value: {
      id: candidate['id'] as string,
      email: candidate['email'] as string,
      displayName: candidate['displayName'] as string,
      createdAt: candidate['createdAt'] as string,
    },
  };
}
