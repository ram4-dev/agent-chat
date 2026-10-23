import {
  isPlainObject,
  type Parsed,
} from '../domain/auth.js';
import { GROUPS_LIMITS, type GroupRole, type MemberKind } from '../domain/groups.js';
import type { PublicUser } from './auth.js';

/** Every private-group route the human HTTP adapter serves. */
export const GROUP_PATHS = {
  collection: '/api/groups',
  one: (groupId: string) => `/api/groups/${groupId}`,
  members: (groupId: string) => `/api/groups/${groupId}/members`,
  removeMember: (groupId: string, memberId: string) =>
    `/api/groups/${groupId}/members/${memberId}`,
  invitations: (groupId: string) => `/api/groups/${groupId}/invitations`,
  agents: (groupId: string) => `/api/groups/${groupId}/agents`,
  agentMember: (groupId: string, agentId: string) =>
    `/api/groups/${groupId}/agents/${agentId}`,
  acceptInvitation: '/api/invitations/accept',
} as const;

export interface GroupSummary {
  id: string;
  name: string;
  createdAt: string;
  /** The caller's role, so the UI never has to guess what it may do. */
  role: GroupRole;
}

export interface HumanMember {
  kind: 'human';
  id: string;
  displayName: string;
  email: string;
  role: GroupRole;
  /** The agent's visible owner is always a human member of the same group. */
  joinedAt: string;
}

export interface AgentMember {
  receiverConnected?: boolean;
  kind: 'agent';
  id: string;
  displayName: string;
  ownerUserId: string;
  ownerDisplayName: string;
  joinedAt: string;
}

export type Member = HumanMember | AgentMember;

export interface GroupDetail {
  group: { id: string; name: string; createdAt: string };
  members: Member[];
  /** The caller's role in this group. */
  role: GroupRole;
}

export interface GroupListResponse {
  groups: GroupSummary[];
}

export interface GroupDetailResponse {
  group: GroupDetail['group'];
  members: Member[];
  role: GroupRole;
}

export interface CreateGroupResponse {
  group: GroupDetail['group'];
  role: GroupRole;
}

export interface InvitationResponse {
  /** The only time this value exists; the server stores a hash of it. */
  token: string;
  expiresAt: string;
}

export interface AcceptedInvitationResponse {
  group: GroupDetail['group'];
  role: GroupRole;
}

export interface OkResponse {
  status: 'ok';
}

export function parseCreateGroupRequest(body: unknown): Parsed<{ name: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body:not_object' };
  }

  const name = body['name'];
  if (typeof name !== 'string') {
    return { ok: false, reason: 'name:not_text' };
  }

  const trimmed = name.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'name:required' };
  }
  if (trimmed.length > GROUPS_LIMITS.GROUP_NAME_MAX_LENGTH) {
    return { ok: false, reason: 'name:too_long' };
  }

  return { ok: true, value: { name: trimmed } };
}

export function parseAcceptInvitationRequest(body: unknown): Parsed<{ token: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body:not_object' };
  }

  const token = body['token'];
  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, reason: 'token:required' };
  }

  return { ok: true, value: { token: token.trim() } };
}

export function parseGroupListResponse(body: unknown): Parsed<GroupListResponse> {
  if (!isPlainObject(body) || !Array.isArray(body['groups'])) {
    return { ok: false, reason: 'groups:not_array' };
  }

  const groups: GroupSummary[] = [];
  for (const candidate of body['groups']) {
    const group = parseGroupSummary(candidate);
    if (!group.ok) {
      return group;
    }
    groups.push(group.value);
  }

  return { ok: true, value: { groups } };
}

export function parseGroupDetailResponse(body: unknown): Parsed<GroupDetailResponse> {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body:not_object' };
  }

  const group = parseGroup(body['group']);
  if (!group.ok) {
    return group;
  }

  const role = parseRole(body['role']);
  if (!role.ok) {
    return role;
  }

  if (!Array.isArray(body['members'])) {
    return { ok: false, reason: 'members:not_array' };
  }
  const members: Member[] = [];
  for (const candidate of body['members']) {
    const member = parseMember(candidate);
    if (!member.ok) {
      return member;
    }
    members.push(member.value);
  }

  return { ok: true, value: { group: group.value, members, role: role.value } };
}

export function parseMemberKind(raw: unknown): Parsed<MemberKind> {
  if (raw === 'human' || raw === 'agent') {
    return { ok: true, value: raw };
  }
  return { ok: false, reason: 'kind:invalid' };
}

export type { PublicUser };

function parseGroupSummary(raw: unknown): Parsed<GroupSummary> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'group:not_object' };
  }

  const group = parseGroup(raw);
  if (!group.ok) {
    return group;
  }
  const role = parseRole(raw['role']);
  if (!role.ok) {
    return role;
  }

  return { ok: true, value: { ...group.value, role: role.value } };
}

function parseGroup(raw: unknown): Parsed<GroupDetail['group']> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'group:not_object' };
  }
  for (const field of ['id', 'name', 'createdAt'] as const) {
    if (typeof raw[field] !== 'string') {
      return { ok: false, reason: `group.${field}:not_text` };
    }
  }
  return {
    ok: true,
    value: {
      id: raw['id'] as string,
      name: raw['name'] as string,
      createdAt: raw['createdAt'] as string,
    },
  };
}

function parseRole(raw: unknown): Parsed<GroupRole> {
  if (raw === 'admin' || raw === 'member') {
    return { ok: true, value: raw };
  }
  return { ok: false, reason: 'role:invalid' };
}

function parseMember(raw: unknown): Parsed<Member> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'member:not_object' };
  }

  const kind = parseMemberKind(raw['kind']);
  if (!kind.ok) {
    return kind;
  }

  const required =
    kind.value === 'human'
      ? (['id', 'displayName', 'email', 'role', 'joinedAt'] as const)
      : (['id', 'displayName', 'ownerUserId', 'ownerDisplayName', 'joinedAt'] as const);

  for (const field of required) {
    if (typeof raw[field] !== 'string') {
      return { ok: false, reason: `member.${field}:not_text` };
    }
  }

  if (kind.value === 'human') {
    const role = parseRole(raw['role']);
    if (!role.ok) {
      return role;
    }
    return {
      ok: true,
      value: {
        kind: 'human',
        id: raw['id'] as string,
        displayName: raw['displayName'] as string,
        email: raw['email'] as string,
        role: role.value,
        joinedAt: raw['joinedAt'] as string,
      },
    };
  }

  return {
    ok: true,
    value: {
      kind: 'agent',
      ...(typeof raw['receiverConnected'] === 'boolean' ? { receiverConnected: raw['receiverConnected'] } : {}),
      id: raw['id'] as string,
      displayName: raw['displayName'] as string,
      ownerUserId: raw['ownerUserId'] as string,
      ownerDisplayName: raw['ownerDisplayName'] as string,
      joinedAt: raw['joinedAt'] as string,
    },
  };
}
