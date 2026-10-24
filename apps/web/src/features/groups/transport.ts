import {
  GROUP_PATHS,
  parseGroupDetailResponse,
  parseGroupListResponse,
  type GroupDetailResponse,
  type GroupSummary,
  type InvitationResponse,
} from '@agent-chat/contracts';
import { errorCodeOf, type JsonFetch } from '../../shared/http';

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
