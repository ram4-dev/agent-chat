import {
  GROUP_PATHS,
  parseGroupDetailResponse,
  parseGroupListResponse,
  type GroupDetailResponse,
  type GroupSummary,
  type InvitationResponse,
  type Member,
} from '@agent-chat/contracts';
import { errorCodeOf, JSON_HEADERS, type JsonFetch } from '../../shared/http';

export type GroupsState =
  | { status: 'loading' }
  | { status: 'ready'; groups: GroupSummary[] }
  | { status: 'error'; httpStatus: number };

export type GroupDetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: GroupDetailResponse }
  | { status: 'rejected'; code: string }
  | { status: 'error'; httpStatus: number };

export type InvitationState =
  | { status: 'idle' }
  | { status: 'ready'; invitation: InvitationResponse }
  | { status: 'rejected'; code: string }
  | { status: 'error'; httpStatus: number };

/** Action results carry the shared code so the UI can explain the refusal. */
export type ActionResult = { ok: true } | { ok: false; code: string };

export async function loadGroups(fetchImpl: JsonFetch = fetch): Promise<GroupsState> {
  try {
    const response = await fetchImpl(GROUP_PATHS.collection);
    if (!response.ok) {
      return { status: 'error', httpStatus: response.status };
    }

    const parsed = parseGroupListResponse(await response.json());
    return parsed.ok
      ? { status: 'ready', groups: parsed.value.groups }
      : { status: 'error', httpStatus: response.status };
  } catch {
    return { status: 'error', httpStatus: 0 };
  }
}

export async function loadGroupDetail(
  groupId: string,
  fetchImpl: JsonFetch = fetch,
): Promise<GroupDetailState> {
  try {
    const response = await fetchImpl(GROUP_PATHS.one(groupId));
    const body: unknown = await response.json();

    if (response.status === 401) {
      return { status: 'error', httpStatus: response.status };
    }
    if (!response.ok) {
      const code = errorCodeOf(body);
      return code === undefined
        ? { status: 'error', httpStatus: response.status }
        : { status: 'rejected', code };
    }

    const parsed = parseGroupDetailResponse(body);
    return parsed.ok
      ? { status: 'ready', detail: parsed.value }
      : { status: 'error', httpStatus: response.status };
  } catch {
    return { status: 'error', httpStatus: 0 };
  }
}

export async function createGroup(
  name: string,
  fetchImpl: JsonFetch = fetch,
): Promise<ActionResult> {
  return post(GROUP_PATHS.collection, { name }, fetchImpl);
}

export async function createInvitation(
  groupId: string,
  fetchImpl: JsonFetch = fetch,
): Promise<InvitationState> {
  try {
    const response = await fetchImpl(GROUP_PATHS.invitations(groupId), {
      method: 'POST',
    });
    const body: unknown = await response.json();

    if (!response.ok) {
      const code = errorCodeOf(body);
      return code === undefined
        ? { status: 'error', httpStatus: response.status }
        : { status: 'rejected', code };
    }

    const invitation = body as Partial<InvitationResponse>;
    if (typeof invitation.token !== 'string' || typeof invitation.expiresAt !== 'string') {
      return { status: 'error', httpStatus: response.status };
    }

    return {
      status: 'ready',
      invitation: { token: invitation.token, expiresAt: invitation.expiresAt },
    };
  } catch {
    return { status: 'error', httpStatus: 0 };
  }
}

export async function acceptInvitation(
  token: string,
  fetchImpl: JsonFetch = fetch,
): Promise<ActionResult> {
  return post(GROUP_PATHS.acceptInvitation, { token }, fetchImpl);
}

export async function removeMember(
  groupId: string,
  memberId: string,
  fetchImpl: JsonFetch = fetch,
): Promise<ActionResult> {
  try {
    const response = await fetchImpl(GROUP_PATHS.removeMember(groupId, memberId), {
      method: 'DELETE',
    });

    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, code: errorCodeOf(await response.json()) ?? 'unknown' };
  } catch {
    return { ok: false, code: 'unreachable' };
  }
}

/** Honest label for a member row: an agent is never shown as its owner. */
export function describeMember(member: Member): string {
  if (member.kind === 'agent') {
    return `${member.displayName} (agent, owner: ${member.ownerDisplayName})`;
  }
  return `${member.displayName} (${member.role})`;
}

async function post(
  path: string,
  payload: unknown,
  fetchImpl: JsonFetch,
): Promise<ActionResult> {
  try {
    const response = await fetchImpl(path, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, code: errorCodeOf(await response.json()) ?? 'unknown' };
  } catch {
    return { ok: false, code: 'unreachable' };
  }
}
