import { isPlainObject, type Parsed } from '@agent-chat/contracts';

/**
 * Bounded agent profile limits.
 *
 * They live here rather than in the HTTP adapter so the consent screen, the
 * owner settings screen, and the tests all validate against one definition.
 */
export const AGENT_LIMITS = {
  NAME_MAX_LENGTH: 60,
  DESCRIPTION_MAX_LENGTH: 280,
  AVATAR_URL_MAX_LENGTH: 2048,
} as const;

/** Scopes the agent connection can be granted, per the approved design. */
export const AGENT_SCOPES = ['agent:read', 'agent:send', 'agent:inbox', 'agent:receive'] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/**
 * The standard OIDC scope.
 *
 * A client asks for it alongside the agent scopes, but it grants nothing about
 * an agent: it only tells the provider to include an ID token. It is therefore
 * accepted and dropped rather than refused as unsupported access.
 */
export const OIDC_SCOPE = 'openid';

export function validateAgentName(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'name:not_text' };
  }
  const name = raw.trim();
  if (name === '') {
    return { ok: false, reason: 'name:required' };
  }
  if (name.length > AGENT_LIMITS.NAME_MAX_LENGTH) {
    return { ok: false, reason: 'name:too_long' };
  }
  return { ok: true, value: name };
}

export function validateAgentDescription(raw: unknown): Parsed<string> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: '' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'description:not_text' };
  }
  const description = raw.trim();
  if (description.length > AGENT_LIMITS.DESCRIPTION_MAX_LENGTH) {
    return { ok: false, reason: 'description:too_long' };
  }
  return { ok: true, value: description };
}

/**
 * Only absolute http(s) avatar URLs are accepted.
 *
 * A `javascript:` or `data:` value would turn a profile field into script
 * execution in whichever client renders it, so the scheme is allow-listed
 * instead of the dangerous ones being denied.
 */
export function validateAvatarUrl(raw: unknown): Parsed<string | undefined> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'avatarUrl:not_text' };
  }
  const value = raw.trim();
  if (value.length > AGENT_LIMITS.AVATAR_URL_MAX_LENGTH) {
    return { ok: false, reason: 'avatarUrl:too_long' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'avatarUrl:invalid' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'avatarUrl:unsupported_scheme' };
  }

  return { ok: true, value };
}

export function parseAgentProfile(body: unknown): Parsed<{
  name: string;
  description: string;
  avatarUrl: string | undefined;
}> {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body:not_object' };
  }

  const name = validateAgentName(body['name']);
  if (!name.ok) {
    return name;
  }
  const description = validateAgentDescription(body['description']);
  if (!description.ok) {
    return description;
  }
  const avatarUrl = validateAvatarUrl(body['avatarUrl']);
  if (!avatarUrl.ok) {
    return avatarUrl;
  }

  return {
    ok: true,
    value: { name: name.value, description: description.value, avatarUrl: avatarUrl.value },
  };
}

/**
 * Filters requested scopes down to what the platform grants.
 *
 * An unknown or over-broad scope is refused rather than ignored, so a client
 * cannot believe it received authority it did not receive.
 */
export function parseRequestedScopes(raw: unknown): Parsed<AgentScope[]> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: [...AGENT_SCOPES] };
  }

  const requested = (Array.isArray(raw) ? raw : String(raw).split(/\s+/)).filter(
    (scope) => scope !== '',
  );

  const agentScopes: AgentScope[] = [];
  for (const scope of requested) {
    if (scope === OIDC_SCOPE) {
      continue;
    }
    if (!AGENT_SCOPES.includes(scope as AgentScope)) {
      return { ok: false, reason: `scope:unsupported:${String(scope)}` };
    }
    agentScopes.push(scope as AgentScope);
  }

  return { ok: true, value: [...new Set(agentScopes)] };
}
