import { randomUUID } from 'node:crypto';
import {
  GROUPS_LIMITS, LIMITS, parseCreateGroupRequest, parseSendMessageRequest,
  type Member, type MessageView, type DomainErrorCode,
} from '@agent-chat/contracts';
import { DomainError } from '../modules/errors.js';
import { parseAgentProfile, parseRequestedScopes, type AgentRecord, type ConnectionRecord } from '../modules/agents/index.js';
import { type UserRecord } from '../modules/identity/index.js';
import { createInvitationToken, hashInvitationToken, type GroupRecord } from '../modules/groups/index.js';
import { digestOf, type MessageAuthorRef } from '../modules/messaging/index.js';
import type { InboxEventView } from '../modules/inbox/index.js';
import { createLiveDeliveryHub } from '../realtime/hub.js';
import type { ApplicationServices } from '../services.js';
import { ManagedDatabase } from './database.js';
import { createManagedHumanAuth, type SupabaseAuthConfig } from './human-auth.js';
import { createNotifications } from '../notifications/module.js';

const USER = 'id,email,password_hash AS "passwordHash",display_name AS "displayName",created_at AS "createdAt"';
const AGENT = 'id,owner_user_id AS "ownerUserId",name,avatar_url AS "avatarUrl",description,status,revoked_at AS "revokedAt",created_at AS "createdAt"';
const CONNECTION = 'id,agent_id AS "agentId",oauth_client_id AS "oauthClientId",scopes,revoked_at AS "revokedAt",created_at AS "createdAt"';
const GROUP = 'id,name,creator_user_id AS "creatorUserId",created_at AS "createdAt"';
type StoredConnection = Omit<ConnectionRecord, 'scopes'> & { scopes: string };
const asConnection = (row: StoredConnection): ConnectionRecord => ({ ...row, scopes: row.scopes.split(' ').filter(Boolean) });
const fail = (code: DomainErrorCode, status = 404): never => { throw new DomainError(code, status, 'Operation refused'); };
const now = () => new Date().toISOString();

const MESSAGE_VIEW = `SELECT m.id,m.group_id AS "groupId",m.text,m.mentioned_agent_ids AS "mentionedAgentIds",m.created_at AS "createdAt",
  CASE WHEN m.author_kind='human' THEN jsonb_build_object('kind','human','id',u.id,'displayName',u.display_name)
  ELSE jsonb_build_object('kind','agent','id',a.id,'displayName',a.name,'ownerDisplayName',o.display_name) END AS author
  FROM messages m LEFT JOIN users u ON u.id=m.human_author_id
  LEFT JOIN agents a ON a.id=m.agent_author_id LEFT JOIN users o ON o.id=a.owner_user_id`;

export interface ManagedServices extends ApplicationServices {
  database: ManagedDatabase;
}

/** All cross-record mutations commit with their audit and distribution hint. */
export function createManagedServices(db: ManagedDatabase, authConfig: SupabaseAuthConfig): ManagedServices {
  const localHub = createLiveDeliveryHub();
  const hub: ApplicationServices['hub'] = {
    ...localHub,
    receiverIsConnected: async (agentId) => !!await db.one('SELECT 1 FROM receiver_leases WHERE agent_id=$1 AND expires_at>now()', [agentId]),
  };
  const identity: ApplicationServices['identity'] = {
    async createUser(input) {
      const id = randomUUID();
      const row = await db.one<UserRecord>(`INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4) RETURNING ${USER}`,
        [id, input.email.toLowerCase(), input.passwordHash, input.displayName]);
      return row!;
    },
    findById: async (id) => db.one<UserRecord>(`SELECT ${USER} FROM users WHERE id=$1`, [id]),
    findByEmail: async (email) => db.one<UserRecord>(`SELECT ${USER} FROM users WHERE email=$1`, [email.trim().toLowerCase()]),
    async getCurrentUser(id) {
      const row = await db.one<UserRecord>(`SELECT ${USER} FROM users WHERE id=$1`, [id]);
      if (!row) return undefined;
      return { id: row.id, email: row.email, displayName: row.displayName, createdAt: row.createdAt };
    },
  };
  async function owned(agentId: string, ownerId: string, lock = false): Promise<AgentRecord> {
    const agent = await db.one<AgentRecord>(`SELECT ${AGENT} FROM agents WHERE id=$1 AND owner_user_id=$2${lock ? ' FOR UPDATE' : ''}`, [agentId, ownerId]);
    return agent ?? fail('not_found');
  }
  async function active(connectionId: string) {
    const row = await db.one<StoredConnection>(`SELECT ${CONNECTION} FROM agent_connections WHERE id=$1 AND revoked_at IS NULL`, [connectionId]);
    if (!row) return fail('unauthenticated', 401);
    const agent = await db.one<AgentRecord>(`SELECT ${AGENT} FROM agents WHERE id=$1 AND status='active'`, [row.agentId]);
    if (!agent) return fail('unauthenticated', 401);
    return { agent, connection: asConnection(row) };
  }
  async function audit(actor: string | null, action: string, targetKind: string, targetId: string, kind = 'human') {
    await db.rows(`INSERT INTO audit_events(id,actor_kind,actor_id,action,target_kind,target_id,outcome) VALUES($1,$2,$3,$4,$5,$6,'allowed')`,
      [randomUUID(), kind, actor, action, targetKind, targetId]);
  }
  async function revokeCredentials(connectionId: string) {
    await db.rows(`DELETE FROM oidc_artifacts WHERE grant_id IN (
      SELECT id FROM oidc_artifacts WHERE model='Grant' AND payload::jsonb->'details'->>'connectionId'=$1)`, [connectionId]);
    await db.rows('DELETE FROM receiver_leases WHERE connection_id=$1', [connectionId]);
  }
  const agents: ApplicationServices['agents'] = {
    async createAgent(input) {
      const parsed = parseAgentProfile(input);
      if (!parsed.ok) return fail('invalid_input', 400);
      const p = parsed.value;
      return db.transaction(async () => {
        const row = await db.one<AgentRecord>(`INSERT INTO agents(id,owner_user_id,name,description,avatar_url) VALUES($1,$2,$3,$4,$5) RETURNING ${AGENT}`,
          [randomUUID(), input.ownerUserId, p.name, p.description, p.avatarUrl ?? null]);
        await db.notify('agent', row!.id);
        return row!;
      });
    },
    listOwnedAgents: async (id) => db.rows<AgentRecord>(`SELECT ${AGENT} FROM agents WHERE owner_user_id=$1 ORDER BY created_at,id`, [id]),
    isActiveAgent: async (id) => !!await db.one('SELECT id FROM agents WHERE id=$1 AND status=\'active\'', [id]),
    getOwnedAgent: owned,
    async updateProfile(input) {
      const parsed = parseAgentProfile(input);
      if (!parsed.ok) return fail('invalid_input', 400);
      const p = parsed.value;
      return db.transaction(async () => {
        await owned(input.agentId, input.ownerUserId, true);
        const row = await db.one<AgentRecord>(`UPDATE agents SET name=$1,description=$2,avatar_url=$3 WHERE id=$4 RETURNING ${AGENT}`,
          [p.name, p.description, p.avatarUrl ?? null, input.agentId]);
        await db.notify('agent', input.agentId);
        return row!;
      });
    },
    async revokeAgent(id, ownerId) {
      const result = await db.transaction(async () => {
        const agent = await owned(id, ownerId, true);
        if (agent.status === 'revoked') return agent;
        const connections = await db.rows<{ id: string }>('SELECT id FROM agent_connections WHERE agent_id=$1', [id]);
        for (const c of connections) await revokeCredentials(c.id);
        const at = now();
        await db.rows('UPDATE agent_connections SET revoked_at=COALESCE(revoked_at,$2) WHERE agent_id=$1', [id, at]);
        const row = await db.one<AgentRecord>(`UPDATE agents SET status='revoked',revoked_at=$2 WHERE id=$1 RETURNING ${AGENT}`, [id, at]);
        await audit(ownerId, 'agent.revoked', 'agent', id);
        await db.notify('agent', id);
        return row!;
      });
      hub.closeReceivers({ agentId: id });
      return result;
    },
    async createConnection({ agentId, oauthClientId, scopes }) {
      const parsed = parseRequestedScopes(scopes);
      if (!parsed.ok) return fail('invalid_input', 400);
      return db.transaction(async () => {
        const agent = await db.one<AgentRecord>(`SELECT ${AGENT} FROM agents WHERE id=$1 FOR UPDATE`, [agentId]);
        if (!agent || agent.status !== 'active') return fail('not_found');
        const existing = await db.one<StoredConnection>(`SELECT ${CONNECTION} FROM agent_connections WHERE agent_id=$1 AND oauth_client_id=$2 AND revoked_at IS NULL`, [agentId, oauthClientId]);
        const row = existing
          ? await db.one<StoredConnection>(`UPDATE agent_connections SET scopes=$2 WHERE id=$1 RETURNING ${CONNECTION}`, [existing.id, parsed.value.join(' ')])
          : await db.one<StoredConnection>(`INSERT INTO agent_connections(id,agent_id,oauth_client_id,scopes) VALUES($1,$2,$3,$4) RETURNING ${CONNECTION}`,
            [randomUUID(), agentId, oauthClientId, parsed.value.join(' ')]);
        await db.notify('agent', agentId);
        return asConnection(row!);
      });
    },
    async listConnections(id, ownerId) {
      await owned(id, ownerId);
      return (await db.rows<StoredConnection>(`SELECT c.id,c.agent_id AS "agentId",c.oauth_client_id AS "oauthClientId",c.scopes,
        c.revoked_at AS "revokedAt",c.created_at AS "createdAt",o.client_name AS "clientName"
        FROM agent_connections c LEFT JOIN oauth_clients o ON o.client_id=c.oauth_client_id
        WHERE c.agent_id=$1 ORDER BY c.created_at,c.id`, [id])).map(asConnection);
    },
    async revokeConnection(id, ownerId) {
      const result = await db.transaction(async () => {
        const row = await db.one<StoredConnection>(`SELECT ${CONNECTION} FROM agent_connections WHERE id=$1 FOR UPDATE`, [id]);
        if (!row) return fail('not_found');
        await owned(row.agentId, ownerId);
        if (!row.revokedAt) {
          await db.rows('UPDATE agent_connections SET revoked_at=$2 WHERE id=$1', [id, now()]);
          await revokeCredentials(id);
          await audit(ownerId, 'connection.revoked', 'connection', id);
          await db.notify('agent', row.agentId);
        }
        return asConnection((await db.one<StoredConnection>(`SELECT ${CONNECTION} FROM agent_connections WHERE id=$1`, [id]))!);
      });
      hub.closeReceivers({ connectionId: id });
      return result;
    },
    async revokeCompromisedConnection(id) {
      await db.transaction(async () => {
        const row = await db.one<{ agent_id: string }>('UPDATE agent_connections SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING agent_id', [id, now()]);
        if (!row) return;
        await revokeCredentials(id);
        await audit(null, 'refresh.reused', 'connection', id, 'system');
        await db.notify('agent', row.agent_id);
      });
      hub.closeReceivers({ connectionId: id });
    },
    resolveActiveConnection: active,
  };
  async function membership(groupId: string, userId: string, admin = false, lock = false) {
    if (lock) await db.rows('SELECT id FROM groups WHERE id=$1 FOR UPDATE', [groupId]);
    const row = await db.one<{ role: 'admin' | 'member' }>('SELECT role FROM group_human_memberships WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
    if (!row) return fail('not_found');
    if (admin && row.role !== 'admin') return fail('forbidden', 403);
    return row.role;
  }
  const groups: ApplicationServices['groups'] = {
    async listAgentPeers({agentId,groupId}) {
      await requireMessageAccess({kind:'agent',id:agentId},groupId);
      return db.rows<{id:string;name:string}>(`SELECT a.id,a.name FROM group_agent_memberships m JOIN agents a ON a.id=m.agent_id AND a.status='active' WHERE m.group_id=$1 ORDER BY a.name,a.id`,[groupId]);
    },
    createGroup: async ({ userId, name }) => db.transaction(async () => {
      const parsed = parseCreateGroupRequest({ name });
      if (!parsed.ok) return fail('invalid_input', 400);
      const id = randomUUID();
      const group = await db.one<GroupRecord>(`INSERT INTO groups(id,name,creator_user_id) VALUES($1,$2,$3) RETURNING ${GROUP}`, [id, parsed.value.name, userId]);
      await db.rows("INSERT INTO group_human_memberships(group_id,user_id,role) VALUES($1,$2,'admin')", [id, userId]);
      await db.notify('membership', id);
      return { group: group!, role: 'admin' as const };
    }),
    async listGroups(userId) {
      return db.rows<{ group: GroupRecord; role: 'admin' | 'member' }>(`SELECT jsonb_build_object('id',g.id,'name',g.name,'creatorUserId',g.creator_user_id,'createdAt',g.created_at) AS "group",m.role
        FROM groups g JOIN group_human_memberships m ON m.group_id=g.id WHERE m.user_id=$1 ORDER BY g.created_at,g.id`, [userId]);
    },
    async listGroupsForAgent(agentId) {
      return db.rows<{ group: GroupRecord; role: 'member' }>(`SELECT jsonb_build_object('id',g.id,'name',g.name,'creatorUserId',g.creator_user_id,'createdAt',g.created_at) AS "group",'member' AS role
        FROM groups g JOIN group_agent_memberships m ON m.group_id=g.id JOIN agents a ON a.id=m.agent_id AND a.status='active'
        WHERE m.agent_id=$1 ORDER BY g.created_at,g.id`, [agentId]);
    },
    async getGroupDetail({ userId, groupId }) {
      const role = await membership(groupId, userId);
      const group = (await db.one<GroupRecord>(`SELECT ${GROUP} FROM groups WHERE id=$1`, [groupId]))!;
      const people = await db.rows<Member>(`SELECT 'human' AS kind,u.id,u.display_name AS "displayName",u.email,m.role,m.created_at AS "joinedAt"
        FROM group_human_memberships m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 ORDER BY m.created_at,u.id`, [groupId]);
      const bots = await db.rows<Member>(`SELECT 'agent' AS kind,a.id,a.name AS "displayName",a.owner_user_id AS "ownerUserId",u.display_name AS "ownerDisplayName",m.created_at AS "joinedAt"
        FROM group_agent_memberships m JOIN agents a ON a.id=m.agent_id JOIN users u ON u.id=a.owner_user_id WHERE m.group_id=$1 ORDER BY m.created_at,a.id`, [groupId]);
      return { group, role, members: [...people, ...bots] };
    },
    createInvitation: async ({ userId, groupId }) => db.transaction(async () => {
      await membership(groupId, userId, true, true);
      const token = createInvitationToken();
      const expiresAt = new Date(Date.now() + GROUPS_LIMITS.INVITATION_TTL_SECONDS * 1000).toISOString();
      await db.rows('INSERT INTO invitations(id,token_hash,group_id,inviter_user_id,expires_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(), hashInvitationToken(token), groupId, userId, expiresAt]);
      return { token, expiresAt };
    }),
    acceptInvitation: async ({ userId, token }) => db.transaction(async () => {
      const row = await db.one<{ id: string; group_id: string; expires_at: string; accepted_at: string | null }>('SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE', [hashInvitationToken(token)]);
      if (!row || row.accepted_at || Date.parse(row.expires_at) <= Date.now()) return fail('not_found');
      await db.rows("INSERT INTO group_human_memberships(group_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING", [row.group_id, userId]);
      await db.rows('UPDATE invitations SET accepted_by_user_id=$2,accepted_at=$3 WHERE id=$1', [row.id, userId, now()]);
      await db.notify('membership', row.group_id);
      return { group: (await db.one<GroupRecord>(`SELECT ${GROUP} FROM groups WHERE id=$1`, [row.group_id]))!, role: await membership(row.group_id, userId) };
    }),
    removeHumanMember: async ({ userId, groupId, memberId }) => db.transaction(async () => {
      await membership(groupId, userId, true, true);
      const member = await db.one<{ role: string }>('SELECT role FROM group_human_memberships WHERE group_id=$1 AND user_id=$2', [groupId, memberId]);
      if (member?.role === 'admin') {
        const count = await db.one<{ total: string }>("SELECT count(*) AS total FROM group_human_memberships WHERE group_id=$1 AND role='admin'", [groupId]);
        if (Number(count!.total) <= 1) return fail('conflict', 409);
      }
      await db.rows('DELETE FROM group_human_memberships WHERE group_id=$1 AND user_id=$2', [groupId, memberId]);
      await db.notify('membership', groupId);
    }),
    admitAgent: async ({ userId, groupId, agentId }) => db.transaction(async () => {
      await membership(groupId, userId, true, true);
      if (!await agents.isActiveAgent(agentId)) return fail('not_found');
      const added = await db.one('INSERT INTO group_agent_memberships(group_id,agent_id,admitted_by_user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING agent_id', [groupId, agentId, userId]);
      await db.notify('membership', groupId);
      return { groupId, agentId, alreadyMember: !added };
    }),
    removeAgentMember: async ({ userId, groupId, agentId }) => db.transaction(async () => {
      await membership(groupId, userId, true, true);
      await db.rows('DELETE FROM group_agent_memberships WHERE group_id=$1 AND agent_id=$2', [groupId, agentId]);
      await db.notify('membership', groupId);
    }),
  };
  async function requireMessageAccess(author: MessageAuthorRef, groupId: string) {
    if (author.kind === 'human') { await membership(groupId, author.id); return; }
    const row = await db.one(`SELECT 1 FROM group_agent_memberships m JOIN agents a ON a.id=m.agent_id AND a.status='active' WHERE m.group_id=$1 AND m.agent_id=$2`, [groupId, author.id]);
    if (!row) return fail('not_found');
  }
  const messaging: ApplicationServices['messaging'] = {
    send: async (input) => db.transaction(async () => {
      const parsed = parseSendMessageRequest(input);
      if (!parsed.ok) return fail('invalid_input', 400);
      await db.lock(`send:${input.author.kind}:${input.author.id}:${input.idempotencyKey}`);
      await db.rows('SELECT id FROM groups WHERE id=$1 FOR UPDATE', [input.groupId]);
      await requireMessageAccess(input.author, input.groupId);
      const digest = digestOf(input.groupId, input.text, parsed.value.mentionedAgentIds);
      const prior = await db.one<{ request_digest: string; message_id: string }>(`SELECT request_digest,message_id FROM message_idempotency WHERE author_kind=$1 AND COALESCE(human_author_id,agent_author_id)=$2 AND idempotency_key=$3`, [input.author.kind, input.author.id, input.idempotencyKey]);
      if (prior) {
        if (prior.request_digest !== digest) return fail('conflict', 409);
        return { message: (await db.one<MessageView>(`${MESSAGE_VIEW} WHERE m.id=$1`, [prior.message_id]))!, replayed: true };
      }
      const members = await db.rows<{ agent_id: string }>(`SELECT m.agent_id FROM group_agent_memberships m JOIN agents a ON a.id=m.agent_id AND a.status='active' WHERE m.group_id=$1 ORDER BY m.agent_id`, [input.groupId]);
      const mentionedAgentIds = parsed.value.mentionedAgentIds ?? [];
      if (mentionedAgentIds.some(id => !members.some(member => member.agent_id === id))) return fail('invalid_input', 400);
      const id = randomUUID();
      const human = input.author.kind === 'human' ? input.author.id : null;
      const agent = input.author.kind === 'agent' ? input.author.id : null;
      await db.rows(`INSERT INTO messages(id,group_id,author_kind,human_author_id,agent_author_id,text,sequence,mentioned_agent_ids)
        SELECT $1,$2,$3,$4,$5,$6,COALESCE(MAX(sequence),0)+1,$7::jsonb FROM messages WHERE group_id=$2`, [id, input.groupId, input.author.kind, human, agent, input.text, JSON.stringify(mentionedAgentIds)]);
      await db.rows(`INSERT INTO message_idempotency(author_kind,human_author_id,agent_author_id,idempotency_key,request_digest,message_id) VALUES($1,$2,$3,$4,$5,$6)`, [input.author.kind, human, agent, input.idempotencyKey, digest, id]);
      const recipients = members.filter(member => member.agent_id !== agent && (!mentionedAgentIds.length || mentionedAgentIds.includes(member.agent_id)));
      for (const recipient of recipients) {
        await db.lock(`inbox:${recipient.agent_id}`);
        await db.rows(`INSERT INTO inbox_events(id,agent_id,sequence,group_id,message_id)
          SELECT $1,$2,COALESCE(MAX(sequence),0)+1,$3,$4 FROM inbox_events WHERE agent_id=$2`, [randomUUID(), recipient.agent_id, input.groupId, id]);
      }
      await audit(input.author.id, 'message.sent', 'message', id, input.author.kind);
      await db.notify('message', id);
      return { message: (await db.one<MessageView>(`${MESSAGE_VIEW} WHERE m.id=$1`, [id]))!, replayed: false };
    }),
    async list({ author, groupId, limit, before }) {
      await requireMessageAccess(author, groupId);
      const bounded = Math.min(LIMITS.PAGE_SIZE_MAX, Math.max(1, limit));
      const rows = await db.rows<MessageView>(`${MESSAGE_VIEW} WHERE m.group_id=$1 AND ($2::text IS NULL OR m.sequence<(SELECT sequence FROM messages WHERE id=$2 AND group_id=$1)) ORDER BY m.sequence DESC LIMIT $3`, [groupId, before ?? null, bounded + 1]);
      const page = rows.slice(0, bounded);
      return { messages: page, ...(rows.length > bounded ? { nextCursor: page.at(-1)!.id } : {}) };
    },
  };
  async function inboxEvents(agentId: string, condition: string, params: unknown[] = []): Promise<InboxEventView[]> {
    const rows = await db.rows<{ eventId: string; sequence: string; groupId: string; createdAt: string; messageId: string }>(`SELECT e.id AS "eventId",e.sequence,e.group_id AS "groupId",e.created_at AS "createdAt",e.message_id AS "messageId"
      FROM inbox_events e JOIN group_agent_memberships m ON m.agent_id=e.agent_id AND m.group_id=e.group_id
      JOIN agents a ON a.id=e.agent_id AND a.status='active' WHERE e.agent_id=$1 ${condition}`, [agentId, ...params]);
    const events: InboxEventView[] = [];
    for (const row of rows) {
      const message = await db.one<MessageView>(`${MESSAGE_VIEW} WHERE m.id=$1`, [row.messageId]);
      if (message) events.push({ eventId: row.eventId, sequence: Number(row.sequence), groupId: row.groupId, createdAt: row.createdAt, message });
    }
    return events;
  }
  const inbox: ApplicationServices['inbox'] = {
    eventForMessage: async (agentId, messageId) => (await inboxEvents(agentId, 'AND e.message_id=$2', [messageId]))[0],
    async listPending({ agentId, limit, after }) {
      const bounded = Math.max(1, Math.min(limit ?? LIMITS.PAGE_SIZE_DEFAULT, LIMITS.PAGE_SIZE_MAX));
      const rows = await inboxEvents(agentId, 'AND e.acknowledged_at IS NULL AND e.sequence>$2 ORDER BY e.sequence LIMIT $3', [after ?? 0, bounded + 1]);
      const page = rows.slice(0, bounded);
      return { events: page, ...(rows.length > bounded ? { nextCursor: page.at(-1)!.sequence } : {}) };
    },
    acknowledge: async ({ agentId, eventId }) => db.transaction(async () => {
      const event = (await inboxEvents(agentId, 'AND e.id=$2', [eventId]))[0];
      if (!event) return fail('not_found');
      await db.rows('UPDATE inbox_events SET acknowledged_at=COALESCE(acknowledged_at,$2) WHERE id=$1', [eventId, now()]);
      return { status: 'acknowledged' as const };
    }),
  };
  const socketLeases: NonNullable<ApplicationServices['socketLeases']> = {
    reserve: async (principal, id, max, agentId, connectionId) => db.transaction(async () => {
      await db.lock(`socket:${principal}`);
      await db.rows('DELETE FROM receiver_leases WHERE expires_at<=now()');
      const count = await db.one<{ total: string }>('SELECT count(*) AS total FROM receiver_leases WHERE principal=$1', [principal]);
      if (Number(count!.total) >= max) return false;
      await db.rows("INSERT INTO receiver_leases(id,principal,agent_id,connection_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 seconds')", [id, principal, agentId ?? null, connectionId ?? null]);
      if (agentId) await db.notify('agent', agentId);
      return true;
    }),
    renew: async (id) => !!await db.one("UPDATE receiver_leases SET expires_at=now()+interval '10 seconds' WHERE id=$1 AND expires_at>now() RETURNING id", [id]),
    release: async (id) => db.transaction(async () => {
      const row = await db.one<{ agent_id: string | null }>('DELETE FROM receiver_leases WHERE id=$1 RETURNING agent_id', [id]);
      if (row?.agent_id) await db.notify('agent', row.agent_id);
    }),
  };
  return { database: db, identity, agents, groups, messaging, inbox, auth: createManagedHumanAuth(db, authConfig), hub, socketLeases,
    notifications: createNotifications(db,agents) };
}

export { MESSAGE_VIEW };
