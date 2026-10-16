import type Database from 'better-sqlite3';
import type { GroupRole } from '@agent-chat/contracts';
import type {
  AgentMemberView,
  GroupRecord,
  GroupRepository,
  HumanMemberView,
  HumanMembershipRecord,
} from '../modules/groups/index.js';
import { runImmediateTransaction } from './client.js';

interface GroupRow {
  id: string;
  name: string;
  creator_user_id: string;
  created_at: string;
}

interface HumanMembershipRow {
  group_id: string;
  user_id: string;
  role: GroupRole;
  created_at: string;
}

interface HumanMemberRow extends HumanMembershipRow {
  display_name: string;
  email: string;
}

interface AgentMemberRow {
  agent_id: string;
  display_name: string;
  owner_user_id: string;
  owner_display_name: string;
  created_at: string;
}

/**
 * The group and membership tables behind the groups module's port.
 *
 * Group creation and its first admin membership happen inside one immediate
 * transaction: a group that exists without an admin could never be managed, and
 * a crash between the two writes would create exactly that.
 */
export function createSqliteGroupRepository(sqlite: Database.Database): GroupRepository {
  const insertGroup = sqlite.prepare(
    `INSERT INTO groups (id, name, creator_user_id, created_at)
     VALUES (@id, @name, @creatorUserId, @createdAt)`,
  );
  const insertMembership = sqlite.prepare(
    `INSERT INTO group_human_memberships (group_id, user_id, role, created_at)
     VALUES (@groupId, @userId, @role, @createdAt)`,
  );
  const groupById = sqlite.prepare('SELECT * FROM groups WHERE id = ?');
  const membership = sqlite.prepare(
    'SELECT * FROM group_human_memberships WHERE group_id = ? AND user_id = ?',
  );
  const groupsForUser = sqlite.prepare(
    `SELECT g.*, m.role AS role
       FROM group_human_memberships m
       JOIN groups g ON g.id = m.group_id
      WHERE m.user_id = ?
      ORDER BY g.created_at, g.id`,
  );
  const humansOfGroup = sqlite.prepare(
    `SELECT m.group_id, m.user_id, m.role, m.created_at,
            u.display_name, u.email
       FROM group_human_memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY m.created_at, m.user_id`,
  );
  const agentsOfGroup = sqlite.prepare(
    `SELECT a.id AS agent_id, a.name AS display_name,
            a.owner_user_id, u.display_name AS owner_display_name, m.created_at
       FROM group_agent_memberships m
       JOIN agents a ON a.id = m.agent_id
       JOIN users u ON u.id = a.owner_user_id
      WHERE m.group_id = ?
      ORDER BY m.created_at, a.id`,
  );
  const adminCount = sqlite.prepare(
    `SELECT COUNT(*) AS total FROM group_human_memberships WHERE group_id = ? AND role = 'admin'`,
  );
  const groupsForAgent = sqlite.prepare(
    `SELECT g.*, 'member' AS role
       FROM group_agent_memberships m
       JOIN groups g ON g.id = m.group_id
      WHERE m.agent_id = ?
      ORDER BY g.created_at, g.id`,
  );
  const insertAgentMembership = sqlite.prepare(
    `INSERT INTO group_agent_memberships (group_id, agent_id, admitted_by_user_id, created_at)
     VALUES (@groupId, @agentId, @admittedByUserId, @createdAt)`,
  );
  const findAgentMembership = sqlite.prepare(
    'SELECT 1 AS present FROM group_agent_memberships WHERE group_id = ? AND agent_id = ?',
  );
  const removeAgentMembership = sqlite.prepare(
    'DELETE FROM group_agent_memberships WHERE group_id = ? AND agent_id = ?',
  );
  const agentRole = sqlite.prepare(
    `SELECT 'member' AS role FROM group_agent_memberships WHERE group_id = ? AND agent_id = ?`,
  );
  const deleteMembership = sqlite.prepare(
    'DELETE FROM group_human_memberships WHERE group_id = ? AND user_id = ?',
  );

  return {
    insertGroupWithAdmin(group, record) {
      runImmediateTransaction(sqlite, () => {
        insertGroup.run(group);
        insertMembership.run(record);
      });
    },

    insertHumanMembership(record) {
      insertMembership.run(record);
    },

    findGroupById: (groupId) => toGroup(groupById.get(groupId) as GroupRow | undefined),

    findHumanMembership: (groupId, userId) =>
      toMembership(membership.get(groupId, userId) as HumanMembershipRow | undefined),

    listGroupsForUser: (userId) =>
      (groupsForUser.all(userId) as Array<GroupRow & { role: GroupRole }>).map((row) => ({
        group: toGroup(row)!,
        role: row.role,
      })),

    listHumanMembers: (groupId) =>
      (humansOfGroup.all(groupId) as HumanMemberRow[]).map(
        (row): HumanMemberView => ({
          userId: row.user_id,
          displayName: row.display_name,
          email: row.email,
          role: row.role,
          joinedAt: row.created_at,
        }),
      ),

    listAgentMembers: (groupId) =>
      (agentsOfGroup.all(groupId) as AgentMemberRow[]).map(
        (row): AgentMemberView => ({
          agentId: row.agent_id,
          displayName: row.display_name,
          ownerUserId: row.owner_user_id,
          ownerDisplayName: row.owner_display_name,
          joinedAt: row.created_at,
        }),
      ),

    countAdmins: (groupId) =>
      (adminCount.get(groupId) as { total: number } | undefined)?.total ?? 0,

    removeHumanMembership(groupId, userId) {
      deleteMembership.run(groupId, userId);
    },
    listGroupsForAgent: (agentId) =>
      (groupsForAgent.all(agentId) as Array<GroupRow & { role: GroupRole }>).map((row) => ({
        group: toGroup(row)!,
        role: row.role,
      })),
    insertAgentMembership(record) {
      insertAgentMembership.run(record);
    },
    findAgentMembership: (groupId, agentId) =>
      findAgentMembership.get(groupId, agentId) !== undefined,
    removeAgentMembership(groupId, agentId) {
      removeAgentMembership.run(groupId, agentId);
    },
    agentRoleFor: (groupId, agentId) =>
      (agentRole.get(groupId, agentId) as { role: GroupRole } | undefined)?.role,
  };
}

function toGroup(row: GroupRow | undefined): GroupRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    name: row.name,
    creatorUserId: row.creator_user_id,
    createdAt: row.created_at,
  };
}

function toMembership(row: HumanMembershipRow | undefined): HumanMembershipRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    groupId: row.group_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
  };
}
