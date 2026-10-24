import { createHash, randomBytes } from 'node:crypto';
import {
  GROUPS_LIMITS,
  parseCreateGroupRequest,
  type GroupRole,
  type Member,
} from '@agent-chat/contracts';
import type { Clock } from '../identity/index.js';
import { DomainError } from '../errors.js';
import {
  GroupNotFoundError,
  InvitationInvalidError,
  LastGroupAdminError,
  NotGroupAdminError,
} from './errors.js';

export interface GroupRecord {
  id: string;
  name: string;
  creatorUserId: string;
  createdAt: string;
}

export interface HumanMembershipRecord {
  groupId: string;
  userId: string;
  role: GroupRole;
  createdAt: string;
}

export interface HumanMemberView {
  userId: string;
  displayName: string;
  email: string;
  role: GroupRole;
  joinedAt: string;
}

export interface AgentMemberView {
  agentId: string;
  displayName: string;
  ownerUserId: string;
  ownerDisplayName: string;
  joinedAt: string;
}

export interface InvitationRecord {
  id: string;
  tokenHash: string;
  groupId: string;
  inviterUserId: string;
  expiresAt: string;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export interface GroupRepository {
  /**
   * Creates the group and its first admin in one transaction.
   *
   * They are inseparable: a group that exists without an admin could never be
   * managed, so a partial write must be impossible.
   */
  insertGroupWithAdmin(group: GroupRecord, membership: HumanMembershipRecord): void;
  insertHumanMembership(membership: HumanMembershipRecord): void;
  findGroupById(groupId: string): GroupRecord | undefined;
  findHumanMembership(groupId: string, userId: string): HumanMembershipRecord | undefined;
  listGroupsForUser(userId: string): Array<{ group: GroupRecord; role: GroupRole }>;
  listHumanMembers(groupId: string): HumanMemberView[];
  listAgentMembers(groupId: string): AgentMemberView[];
  countAdmins(groupId: string): number;
  removeHumanMembership(groupId: string, userId: string): void;
  listGroupsForAgent(agentId: string): Array<{ group: GroupRecord; role: GroupRole }>;
  agentRoleFor(groupId: string, agentId: string): GroupRole | undefined;
  insertAgentMembership(record: AgentMembershipRecord): void;
  findAgentMembership(groupId: string, agentId: string): boolean;
  removeAgentMembership(groupId: string, agentId: string): void;
}

/** One row of agent admission, recording who allowed it. */
export interface AgentMembershipRecord {
  groupId: string;
  agentId: string;
  admittedByUserId: string;
  createdAt: string;
}

export interface InvitationRepository {
  insert(invitation: InvitationRecord): void;
  findByTokenHash(tokenHash: string): InvitationRecord | undefined;
  markAccepted(invitationId: string, userId: string, acceptedAt: string): void;
}

export interface GroupsModule {
  createGroup(input: { userId: string; name: string }): {
    group: GroupRecord;
    role: GroupRole;
  };
  listGroups(userId: string): Array<{ group: GroupRecord; role: GroupRole }>;
  /** Groups the agent itself belongs to; this is what `list_groups` exposes. */
  listGroupsForAgent(agentId: string): Array<{ group: GroupRecord; role: GroupRole }>;
  /** Throws `GroupNotFoundError` when the caller is not a member. */
  getGroupDetail(input: { userId: string; groupId: string }): {
    group: GroupRecord;
    role: GroupRole;
    members: Member[];
  };
  createInvitation(input: {
    userId: string;
    groupId: string;
  }): { token: string; expiresAt: string };
  acceptInvitation(input: { userId: string; token: string }): {
    group: GroupRecord;
    role: GroupRole;
  };
  removeHumanMember(input: { userId: string; groupId: string; memberId: string }): void;
  /** Adds an agent to a private group. Group-admin authority decides this. */
  admitAgent(input: { userId: string; groupId: string; agentId: string }): {
    groupId: string;
    agentId: string;
    alreadyMember: boolean;
  };
  removeAgentMember(input: { userId: string; groupId: string; agentId: string }): void;
}

/**
 * The agent facts admission needs.
 *
 * Kept as a port so the group module never learns an agent's profile, owner, or
 * connection: all it can ask is whether the agent exists and is usable.
 */
export interface AgentLookupPort {
  isActive(agentId: string): boolean;
}

export interface GroupsModuleDependencies {
  groups: GroupRepository;
  invitations: InvitationRepository;
  clock: Clock;
  generateId(): string;
  agentLookup: AgentLookupPort;
  /** Injectable so a test can pin the value it will accept. */
  createInvitationToken?(): string;
}

const INVITATION_TOKEN_BYTES = 32;

/**
 * Mints an invitation token.
 *
 * The token is what the invitee holds; the database only ever sees its hash, so
 * a database read cannot be replayed as an invitation.
 */
export function createInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Owns private groups, their membership, and their invitations.
 *
 * Every read and write resolves the caller's membership first and answers
 * `GroupNotFoundError` when it is absent, so a non-member cannot even learn
 * that a group exists. Admin-only paths check the role after membership, which
 * is why a non-member gets 404 and a plain member gets 403.
 */
export function createGroupsModule({
  groups,
  invitations,
  clock,
  generateId,
  agentLookup,
  createInvitationToken: mintToken = createInvitationToken,
}: GroupsModuleDependencies): GroupsModule {
  function requireMembership(groupId: string, userId: string): HumanMembershipRecord {
    const group = groups.findGroupById(groupId);
    const membership = group === undefined ? undefined : groups.findHumanMembership(groupId, userId);
    if (group === undefined || membership === undefined) {
      throw new GroupNotFoundError();
    }
    return membership;
  }

  function requireAdmin(groupId: string, userId: string): HumanMembershipRecord {
    const membership = requireMembership(groupId, userId);
    if (membership.role !== 'admin') {
      throw new NotGroupAdminError();
    }
    return membership;
  }

  return {
    createGroup({ userId, name }) {
      const parsed = parseCreateGroupRequest({ name });
      if (!parsed.ok) {
        throw new DomainError('invalid_input', 400, `Rejected group name (${parsed.reason})`);
      }

      const group: GroupRecord = {
        id: generateId(),
        name: parsed.value.name,
        creatorUserId: userId,
        createdAt: clock.now().toISOString(),
      };

      groups.insertGroupWithAdmin(group, {
        groupId: group.id,
        userId,
        role: 'admin',
        createdAt: group.createdAt,
      });

      return { group, role: 'admin' };
    },

    listGroups(userId) {
      return groups.listGroupsForUser(userId);
    },

    listGroupsForAgent(agentId) {
      return groups.listGroupsForAgent(agentId);
    },

    getGroupDetail({ userId, groupId }) {
      const membership = requireMembership(groupId, userId);
      const group = groups.findGroupById(groupId)!;

      const members: Member[] = [
        ...groups.listHumanMembers(groupId).map(
          (member): Member => ({
            kind: 'human',
            id: member.userId,
            displayName: member.displayName,
            email: member.email,
            role: member.role,
            joinedAt: member.joinedAt,
          }),
        ),
        ...groups.listAgentMembers(groupId).map(
          (member): Member => ({
            kind: 'agent',
            id: member.agentId,
            displayName: member.displayName,
            ownerUserId: member.ownerUserId,
            ownerDisplayName: member.ownerDisplayName,
            joinedAt: member.joinedAt,
          }),
        ),
      ];

      return { group, role: membership.role, members };
    },

    createInvitation({ userId, groupId }) {
      requireAdmin(groupId, userId);

      const token = mintToken();
      const now = clock.now();
      const expiresAt = new Date(
        now.getTime() + GROUPS_LIMITS.INVITATION_TTL_SECONDS * 1000,
      ).toISOString();

      invitations.insert({
        id: generateId(),
        tokenHash: hashInvitationToken(token),
        groupId,
        inviterUserId: userId,
        expiresAt,
        acceptedByUserId: null,
        acceptedAt: null,
        createdAt: now.toISOString(),
      });

      return { token, expiresAt };
    },

    acceptInvitation({ userId, token }) {
      const invitation = invitations.findByTokenHash(hashInvitationToken(token));
      const now = clock.now();

      if (
        invitation === undefined ||
        invitation.acceptedAt !== null ||
        Date.parse(invitation.expiresAt) <= now.getTime()
      ) {
        // Unknown, already used, and expired invitations are one answer: a
        // distinct code would confirm that a guessed token once existed.
        throw new InvitationInvalidError();
      }

      const existing = groups.findHumanMembership(invitation.groupId, userId);
      if (existing === undefined) {
        groups.insertHumanMembership({
          groupId: invitation.groupId,
          userId,
          role: 'member',
          createdAt: now.toISOString(),
        });
      }

      // Marking the invitation used is unconditional: a member who follows the
      // same link twice must not extend its life.
      invitations.markAccepted(invitation.id, userId, now.toISOString());

      const group = groups.findGroupById(invitation.groupId);
      if (group === undefined) {
        throw new GroupNotFoundError();
      }

      return { group, role: existing?.role ?? 'member' };
    },

    admitAgent({ userId, groupId, agentId }) {
      // Admitting is a group decision: only an admin of this group can do it, and
      // another person's private group answers as missing rather than forbidden.
      requireAdmin(groupId, userId);

      if (!agentLookup.isActive(agentId)) {
        // A revoked or unknown agent is reported as absent; naming it would leak
        // which agents exist to a group admin who never saw one.
        throw new GroupNotFoundError('Agent not found');
      }

      // The repository answers with a boolean, not a record: comparing it to
      // `undefined` would treat every group as already having this agent.
      if (groups.findAgentMembership(groupId, agentId)) {
        return { groupId, agentId, alreadyMember: true };
      }

      groups.insertAgentMembership({
        groupId,
        agentId,
        admittedByUserId: userId,
        createdAt: clock.now().toISOString(),
      });

      return { groupId, agentId, alreadyMember: false };
    },

    removeAgentMember({ userId, groupId, agentId }) {
      requireAdmin(groupId, userId);

      if (!groups.findAgentMembership(groupId, agentId)) {
        throw new GroupNotFoundError();
      }

      groups.removeAgentMembership(groupId, agentId);
    },

    removeHumanMember({ userId, groupId, memberId }) {
      requireAdmin(groupId, userId);

      const target = groups.findHumanMembership(groupId, memberId);
      if (target === undefined) {
        throw new GroupNotFoundError();
      }

      if (target.role === 'admin' && groups.countAdmins(groupId) <= 1) {
        throw new LastGroupAdminError();
      }

      groups.removeHumanMembership(groupId, memberId);
    },
  };
}

export { GroupNotFoundError, InvitationInvalidError, LastGroupAdminError, NotGroupAdminError };
