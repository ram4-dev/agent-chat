import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { NATIVE_AUTOMATIC_SCOPES, NATIVE_INTERACTIVE_SCOPES, type NativeConsent, type NativeGrant, type NativeScope, type NativeSelection } from '@agent-chat/contracts';
import type { AgentsModule } from '../agents/index.js';
import type { MessagingModule } from '../messaging/index.js';
import type { LiveDeliveryHub } from '../../realtime/hub.js';
import type { GroupsModule } from '../groups/index.js';
import { DomainError } from '../errors.js';
import { createNativeRuntimeRepository } from '../../persistence/native-runtime-repository.js';
import { runImmediateTransaction } from '../../persistence/client.js';

interface GrantRow {
  id: string; connection_id: string; owner_user_id: string; kind: NativeGrant['kind'];
  binding_id: string | null; revision: number | null; target_id: string | null;
  scopes_json: string; selections_json: string; revoked_at: number | null;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const deny = () => new DomainError('forbidden', 403, 'Native authority is not available');
const conflict = () => new DomainError('conflict', 409, 'Native authority changed');

/** Explicit owner consent, layered on a separately authenticated OAuth connection. */
export function createNativeAccessModule(sqlite: Database.Database, deps: {
  agents: AgentsModule; groups: GroupsModule; messaging: MessagingModule; hub: LiveDeliveryHub; closeReceivers(connectionId: string): void;
}, now: () => number = Date.now) {
  const repository = createNativeRuntimeRepository(sqlite);
  const member = (agentId: string, groupId: string) => deps.groups.listGroupsForAgent(agentId).some(item => item.group.id === groupId);
  function ownedConnection(owner: string, connectionId: string) {
    const current = deps.agents.resolveActiveConnection(connectionId);
    if (current.agent.ownerUserId !== owner) throw deny();
    return current;
  }
  function validateSelections(owner: string, selections: NativeSelection[]) {
    if (!selections.length || new Set(selections.map(s => s.agentId)).size !== selections.length) throw deny();
    for (const selection of selections) {
      const agent = deps.agents.getOwnedAgent(selection.agentId, owner);
      if (agent.status !== 'active' || !selection.groupIds.length || new Set(selection.groupIds).size !== selection.groupIds.length ||
          selection.groupIds.some(group => !member(agent.id, group))) throw deny();
    }
  }
  function consentSelections(owner: string, consent: NativeConsent): NativeSelection[] {
    ownedConnection(owner, consent.connectionId);
    // Pair a separate client, never take the credential of a legacy controller.
    if (sqlite.prepare('SELECT 1 FROM agent_runtimes WHERE connection_id=?').get(consent.connectionId)) throw conflict();
    const allowed: readonly NativeScope[] = consent.kind === 'automatic' ? NATIVE_AUTOMATIC_SCOPES : NATIVE_INTERACTIVE_SCOPES;
    if (!consent.scopes.length || consent.scopes.some(scope => !allowed.includes(scope))) throw deny();
    if (consent.kind === 'interactive') {
      validateSelections(owner, consent.selections);
      return consent.selections;
    }
    const binding = repository.findBinding(owner, consent.bindingId);
    if (!binding || binding.legacyProjection || binding.revision !== consent.revision || binding.targetId !== consent.targetId) throw conflict();
    if (deps.agents.resolveActiveConnection(consent.connectionId).agent.id !== binding.agentId) throw deny();
    const rows = sqlite.prepare('SELECT group_id FROM native_binding_groups WHERE binding_id=? AND revision=? AND enabled=1')
      .all(binding.id, binding.revision) as { group_id: string }[];
    const selections = [{ agentId: binding.agentId, groupIds: rows.map(row => row.group_id) }];
    validateSelections(owner, selections);
    return selections;
  }
  function classify(connectionId: string): boolean {
    return sqlite.prepare('SELECT 1 FROM native_connection_grants WHERE connection_id=?').get(connectionId) !== undefined;
  }
  function resolve(connectionId: string): NativeGrant {
    const row = sqlite.prepare('SELECT * FROM native_connection_grants WHERE connection_id=?').get(connectionId) as GrantRow | undefined;
    if (!row || row.revoked_at !== null) throw deny();
    ownedConnection(row.owner_user_id, connectionId);
    if (row.kind === 'automatic') {
      const binding = repository.findBinding(row.owner_user_id, row.binding_id!);
      if (!binding || binding.legacyProjection || binding.revision !== row.revision || binding.targetId !== row.target_id) throw deny();
    }
    return { id: row.id, connectionId, ownerUserId: row.owner_user_id, kind: row.kind, bindingId: row.binding_id,
      revision: row.revision, targetId: row.target_id,
      scopes: JSON.parse(row.scopes_json) as NativeScope[], selections: JSON.parse(row.selections_json) as NativeSelection[] };
  }
  function requireAccess(connectionId: string, scope: NativeScope, agentId: string, groupId: string): NativeGrant {
    const grant = resolve(connectionId);
    if (!grant.scopes.includes(scope) || !grant.selections.some(s => s.agentId === agentId && s.groupIds.includes(groupId))) throw deny();
    const agent = deps.agents.getOwnedAgent(agentId, grant.ownerUserId);
    if (agent.status !== 'active' || !member(agentId, groupId)) throw deny();
    if (grant.kind === 'automatic' && !sqlite.prepare(`SELECT 1 FROM native_binding_groups
      WHERE binding_id=? AND revision=? AND group_id=? AND enabled=1`).get(grant.bindingId, grant.revision, groupId)) throw deny();
    return grant;
  }
  return {
    repository, classify, resolve, requireAccess,
    createOwnedBinding(owner: string, input: { agentId: string; targetId: string; groupIds: string[] }) {
      return runImmediateTransaction(sqlite, () => {
        validateSelections(owner, [{ agentId: input.agentId, groupIds: input.groupIds }]);
        const target = repository.findTarget(owner, input.targetId);
        if (!target || target.provider === 'legacy_codex') throw deny();
        if (sqlite.prepare("SELECT 1 FROM agent_automation_jobs WHERE agent_id=? AND state!='done'").get(input.agentId) ||
            sqlite.prepare('SELECT 1 FROM agent_automation_bindings WHERE agent_id=? AND enabled=1').get(input.agentId)) throw conflict();
        return repository.createBinding({ ...input, ownerUserId: owner, id: randomUUID() });
      });
    },
    publishInteractive(connectionId: string, input: { agentId: string; groupId: string; text: string; idempotencyKey: string }) {
      const sent = runImmediateTransaction(sqlite, () => {
        const grant = requireAccess(connectionId, 'native:send', input.agentId, input.groupId);
        if (grant.kind !== 'interactive') throw deny();
        const sent = deps.messaging.send({ author: { kind: 'agent', id: input.agentId }, groupId: input.groupId, text: input.text, idempotencyKey: input.idempotencyKey });
        if (!sent.replayed) sqlite.prepare(`INSERT INTO audit_events(id,actor_kind,actor_id,action,target_kind,target_id,outcome,metadata)
          VALUES(?,'agent',?,'native.interactive.sent','message',?,'allowed',?)`).run(randomUUID(), input.agentId, sent.message.id, JSON.stringify({ grantId: grant.id, connectionId }));
        return sent;
      });
      if (!sent.replayed) deps.hub.publishMessage(sent.message);
      return sent;
    },
    visibleSelections(connectionId: string): NativeSelection[] {
      const grant = resolve(connectionId);
      return grant.selections.flatMap(selection => {
        const groupIds = selection.groupIds.filter(groupId => {
          try { requireAccess(connectionId, 'native:read', selection.agentId, groupId); return true; } catch { return false; }
        });
        return groupIds.length ? [{ agentId: selection.agentId, groupIds }] : [];
      });
    },
    createChallenge(owner: string, consent: NativeConsent) {
      return runImmediateTransaction(sqlite, () => {
        consentSelections(owner, consent);
        if (classify(consent.connectionId)) throw conflict();
        const challenge = randomBytes(32).toString('base64url');
        const expiresAt = now() + 5 * 60_000;
        const id = randomUUID();
        sqlite.prepare(`INSERT INTO native_pairing_challenges(id,secret_hash,owner_user_id,connection_id,consent_json,expires_at)
          VALUES(?,?,?,?,?,?)`).run(id, hash(challenge), owner, consent.connectionId, JSON.stringify(consent), expiresAt);
        return { id, challenge, expiresAt, consent };
      });
    },
    consumeChallenge(connectionId: string, challenge: string, expected: { bindingId?: string; revision?: number; targetId?: string }): NativeGrant {
      const grant = runImmediateTransaction(sqlite, () => {
        const row = sqlite.prepare('SELECT * FROM native_pairing_challenges WHERE secret_hash=?').get(hash(challenge)) as {
          id: string; owner_user_id: string; connection_id: string; consent_json: string; expires_at: number; consumed_at: number | null;
        } | undefined;
        if (!row || row.connection_id !== connectionId || row.consumed_at !== null || row.expires_at <= now() || classify(connectionId)) throw deny();
        const consent = JSON.parse(row.consent_json) as NativeConsent;
        if (consent.kind === 'automatic') {
          if (expected.bindingId !== consent.bindingId || expected.revision !== consent.revision || expected.targetId !== consent.targetId) throw deny();
        } else if (Object.values(expected).some(value => value !== undefined)) throw deny();
        const selections = consentSelections(row.owner_user_id, consent);
        const id = randomUUID();
        sqlite.prepare(`INSERT INTO native_connection_grants(id,connection_id,owner_user_id,kind,binding_id,revision,target_id,scopes_json,selections_json,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, connectionId, row.owner_user_id, consent.kind,
          consent.kind === 'automatic' ? consent.bindingId : null, consent.kind === 'automatic' ? consent.revision : null,
          consent.kind === 'automatic' ? consent.targetId : null, JSON.stringify([...new Set(consent.scopes)]), JSON.stringify(selections), now());
        sqlite.prepare('UPDATE native_pairing_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(now(), row.id);
        return resolve(connectionId);
      });
      deps.closeReceivers(connectionId);
      return grant;
    },
    restrict(owner: string, id: string, scopes: NativeScope[], selections: NativeSelection[]): NativeGrant {
      return runImmediateTransaction(sqlite, () => {
        const row = sqlite.prepare('SELECT connection_id FROM native_connection_grants WHERE id=? AND owner_user_id=?').get(id, owner) as { connection_id: string } | undefined;
        if (!row) throw deny();
        const grant = resolve(row.connection_id);
        if (scopes.some(scope => !grant.scopes.includes(scope)) || selections.some(selection =>
          selection.groupIds.some(group => !grant.selections.some(old => old.agentId === selection.agentId && old.groupIds.includes(group))))) throw deny();
        // A restriction cannot introduce an identity, even with an empty group list.
        if (selections.some(s => !grant.selections.some(old => old.agentId === s.agentId))) throw deny();
        sqlite.prepare('UPDATE native_connection_grants SET scopes_json=?,selections_json=? WHERE id=?').run(JSON.stringify(scopes), JSON.stringify(selections), id);
        return resolve(row.connection_id);
      });
    },
    revoke(owner: string, id: string): void {
      const row = sqlite.prepare('SELECT connection_id FROM native_connection_grants WHERE id=? AND owner_user_id=?').get(id, owner) as { connection_id: string } | undefined;
      if (!row) throw deny();
      sqlite.prepare('UPDATE native_connection_grants SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(now(), id);
      deps.closeReceivers(row.connection_id);
    },
    assertLegacyAckAllowed(agentId: string, eventId: string): void {
      const reserved = sqlite.prepare(`SELECT 1 FROM inbox_events e JOIN native_bindings b ON b.agent_id=e.agent_id
        JOIN native_binding_groups g ON g.binding_id=b.id AND g.group_id=e.group_id
        WHERE e.id=? AND e.agent_id=? AND b.legacy_projection=0`).get(eventId, agentId);
      if (reserved) throw conflict();
    },
  };
}
export type NativeAccessModule = ReturnType<typeof createNativeAccessModule>;
