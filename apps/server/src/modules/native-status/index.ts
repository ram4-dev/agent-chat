import type Database from 'better-sqlite3';
import type { NativeAgentSummary, NativeStatusView } from '@agent-chat/contracts';
import type { AgentsModule } from '../agents/index.js';
import type { GroupsModule } from '../groups/index.js';
import type { NativeAccessModule } from '../native-access/index.js';
import { DomainError } from '../errors.js';
export const NATIVE_CONTACT_FRESHNESS_MS = 15000;
export function createNativeStatusModule(sqlite: Database.Database, deps: { agents: AgentsModule; groups: GroupsModule; nativeAccess: NativeAccessModule }, now: () => number = Date.now) {
  const unavailable = () => new DomainError('not_found', 404, 'Native state unavailable');
  const bindingRow = (agentId: string) => sqlite.prepare('SELECT id FROM native_bindings WHERE agent_id=? AND legacy_projection=0').get(agentId) as { id: string } | undefined;
  function summary(owner: string, agentId: string): NativeAgentSummary | null {
    deps.agents.getOwnedAgent(agentId, owner);
    const row = bindingRow(agentId); if (!row) return null;
    const binding = deps.nativeAccess.repository.findBinding(owner, row.id); if (!binding) return null;
    const target = deps.nativeAccess.repository.findTarget(owner, binding.targetId); if (!target) return null;
    return { bindingId: binding.id, revision: binding.revision, provider: target.provider, enabled: binding.enabled };
  }
  return {
    summary,
    hasBinding(agentId: string): boolean { return !!bindingRow(agentId); },
    ownerState(owner: string, agentId: string, groupId: string): NativeStatusView | null {
      const agent = deps.agents.getOwnedAgent(agentId, owner);
      if (!deps.groups.listGroups(owner).some(item => item.group.id === groupId)) throw unavailable();
      const selected = summary(owner, agentId); if (!selected) return null;
      const binding = deps.nativeAccess.repository.findBinding(owner, selected.bindingId)!;
      const target = deps.nativeAccess.repository.findTarget(owner, binding.targetId)!;
      const covered = agent.status === 'active' && deps.groups.listGroupsForAgent(agentId).some(item => item.group.id === groupId) && !!sqlite.prepare('SELECT 1 FROM native_binding_groups WHERE binding_id=? AND revision=? AND group_id=? AND enabled=1').get(binding.id, binding.revision, groupId);
      const contact = sqlite.prepare('SELECT c.last_contact_at,g.connection_id FROM native_binding_controllers c JOIN native_connection_grants g ON g.id=c.grant_id WHERE c.binding_id=?').get(binding.id) as { last_contact_at: number | null; connection_id: string } | undefined;
      let authorized = false;
      if (covered && contact) {
        try { deps.nativeAccess.requireAccess(contact.connection_id, 'native:read', agentId, groupId); authorized = true; } catch { /* Registration alone is not current authority. */ }
      }
      const observedAt = now(); const lastContactAt = authorized ? contact?.last_contact_at ?? null : null;
      const rows = covered ? sqlite.prepare(`SELECT d.*,m.text AS input FROM native_deliveries d LEFT JOIN inbox_events e ON e.id=d.event_id LEFT JOIN messages m ON m.id=e.message_id
        WHERE d.binding_id=? AND d.binding_revision=? AND d.group_id=? ORDER BY d.created_at DESC,d.event_id DESC LIMIT 30`).all(binding.id, binding.revision, groupId) as {
          event_id: string; state: string; started: number; provider_started: number; input: string | null; result_text: string | null; result_hash: string | null;
          decision: 'reply' | 'no_reply' | null; disposition: 'published' | 'no_reply' | 'suppressed' | null; message_id: string | null;
          native_run_ref: string | null; conversation_ref: string | null; created_at: number; completed_at: number | null;
        }[] : [];
      const blockedElsewhere = !!sqlite.prepare("SELECT 1 FROM native_deliveries WHERE target_id=? AND state NOT IN ('queued','done') AND (binding_id!=? OR group_id!=?) LIMIT 1").get(binding.targetId, binding.id, groupId);
      return {
        binding: { id: binding.id, revision: binding.revision, enabled: binding.enabled },
        target: { provider: target.provider, connectorId: target.connectorId, nativeRef: target.nativeRef, contextMode: target.contextMode, capabilities: target.capabilities, verifiedAt: target.verifiedAt },
        group: { id: groupId, covered }, controller: { authorized, lastContactAt, presence: lastContactAt === null ? 'unknown' : observedAt >= lastContactAt && observedAt - lastContactAt <= NATIVE_CONTACT_FRESHNESS_MS ? 'recent' : 'stale' },
        observedAt, blockedElsewhere,
        jobs: rows.map(row => {
          const contentExpired = row.state === 'done' && row.result_hash !== null && row.result_text === null;
          return { eventId: row.event_id, state: row.state, started: row.started === 1, providerStarted: row.provider_started === 1,
            input: contentExpired ? null : row.input, output: row.result_text, decision: row.decision,
            receipt: row.disposition ? { disposition: row.disposition, messageId: row.message_id } : null, contentExpired,
            runRef: row.native_run_ref, conversationRef: row.conversation_ref, createdAt: row.created_at, completedAt: row.completed_at };
        }),
      };
    },
  };
}
export type NativeStatusModule = ReturnType<typeof createNativeStatusModule>;
