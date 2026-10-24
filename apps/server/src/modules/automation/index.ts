import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { runImmediateTransaction } from '../../persistence/client.js';
import { DomainError } from '../errors.js';
import type { AgentCredential } from '../../adapters/mcp/auth.js';
import type { LocalApplicationServices as ApplicationServices } from '../../services.js';
import type { InboxEventView } from '../inbox/index.js';

export interface AutomationBinding {
  agentId: string; groupId: string; enabled: boolean; model: string;
  threadId: string | null; lastError: string | null; connected: boolean;
}
export interface AutomationJob {
  eventId: string; groupId: string; claim: string;
  state: 'running' | 'generated' | 'published' | 'done' | 'needs_review';
  decision: string | null; output: string | null; threadId: string | null;
  messageId: string | null; error: string | null;
}
interface JobRow {
  event_id: string; agent_id: string; group_id: string; connection_id: string;
  instance_id: string; claim: string; state: AutomationJob['state'];
  decision: string | null; output: string | null; thread_id: string | null;
  message_id: string | null; error: string | null; started: number;
}
interface BindingRow {
  agent_id: string; group_id: string; enabled: number; model: string;
  thread_id: string | null; last_error: string | null; last_seen: number;
}
interface RuntimeRow { controller_id: string; instance_id: string; connection_id: string; last_seen: number }
type Ports = Pick<ApplicationServices, 'agents' | 'groups' | 'inbox' | 'messaging' | 'hub'>;
export type AutomationModule = ReturnType<typeof createAutomationModule>;
const viewJob = (row: JobRow): AutomationJob => ({
  eventId: row.event_id, groupId: row.group_id, claim: row.claim, state: row.state,
  decision: row.decision, output: row.output, threadId: row.thread_id,
  messageId: row.message_id, error: row.error,
});

/** Durable claims and publication receipts. No expired claim ever starts another turn. */
export function createAutomationModule(sqlite: Database.Database, ports: Ports) {
  const tx = <T>(work: () => T): T => runImmediateTransaction(sqlite, work);
  function nativeBinding(agentId: string): boolean {
    return sqlite.prepare('SELECT 1 FROM native_bindings WHERE agent_id=? AND legacy_projection=0').get(agentId) !== undefined;
  }
  function access(c: AgentCredential): void {
    if (nativeBinding(c.agentId) || sqlite.prepare('SELECT 1 FROM native_connection_grants WHERE connection_id=?').get(c.connectionId)) {
      throw new DomainError('conflict', 409, 'Native execution requires a native delivery grant');
    }
    const active = ports.agents.resolveActiveConnection(c.connectionId);
    if (active.agent.id !== c.agentId || Date.now() >= c.expiresAt ||
        !['agent:read', 'agent:send', 'agent:inbox'].every((scope) => c.scopes.includes(scope as typeof c.scopes[number]))) {
      throw new DomainError('unauthenticated', 401, 'Runtime permission required');
    }
  }
  function member(agentId: string, groupId: string): void {
    if (!ports.groups.listGroupsForAgent(agentId).some(({ group }) => group.id === groupId)) {
      throw new DomainError('not_found', 404, 'Group is unavailable');
    }
  }
  function binding(agentId: string, groupId: string): BindingRow | undefined {
    return sqlite.prepare('SELECT * FROM agent_automation_bindings WHERE agent_id=? AND group_id=?')
      .get(agentId, groupId) as BindingRow | undefined;
  }
  function runtime(agentId: string): RuntimeRow | undefined {
    return sqlite.prepare('SELECT * FROM agent_runtimes WHERE agent_id=?').get(agentId) as RuntimeRow | undefined;
  }
  function publicBinding(row: BindingRow): AutomationBinding {
    const live = runtime(row.agent_id);
    let active = false;
    if (live !== undefined) { try { ports.agents.resolveActiveConnection(live.connection_id); active = true; } catch { /* Revocation is reflected immediately. */ } }
    return { agentId: row.agent_id, groupId: row.group_id, enabled: row.enabled === 1,
      model: row.model, threadId: row.thread_id, lastError: row.last_error,
      connected: active && Date.now() - row.last_seen < 15_000 };
  }
  function configure(agentId: string, groupId: string, enabled: boolean, model: string) {
    member(agentId, groupId);
    if (enabled && nativeBinding(agentId)) throw new DomainError('conflict', 409, 'Native configuration is separate');
    if (model !== 'gpt-6.1-sol') throw new DomainError('invalid_input', 400, 'Model is not supported');
    sqlite.prepare(`INSERT INTO agent_automation_bindings(agent_id,group_id,enabled,model) VALUES(?,?,?,?)
      ON CONFLICT(agent_id,group_id) DO UPDATE SET enabled=excluded.enabled,model=excluded.model`)
      .run(agentId, groupId, enabled ? 1 : 0, model);
    return publicBinding(binding(agentId, groupId)!);
  }
  function assertInstance(c: AgentCredential, instanceId: string, controllerId = instanceId, opening = false): void {
    access(c);
    const old = runtime(c.agentId);
    if (old !== undefined && (old.instance_id !== instanceId || old.connection_id !== c.connectionId)) {
      throw new DomainError('conflict', 409, 'Another runtime owns this agent');
    }
    if (!opening && old !== undefined && old.controller_id && old.controller_id !== controllerId) throw new DomainError('conflict', 409, 'Controller was replaced');
    sqlite.prepare(`INSERT INTO agent_runtimes(agent_id,instance_id,connection_id,last_seen,controller_id) VALUES(?,?,?,?,?)
      ON CONFLICT(agent_id) DO UPDATE SET last_seen=excluded.last_seen`)
      .run(c.agentId, instanceId, c.connectionId, Date.now(), controllerId);
    if (opening || !old?.controller_id) sqlite.prepare('UPDATE agent_runtimes SET controller_id=? WHERE agent_id=?').run(controllerId, c.agentId);

  }
  function jobFor(c: AgentCredential, instanceId: string, eventId: string, claim: string, controllerId = instanceId): JobRow {
    assertInstance(c, instanceId, controllerId);
    const row = sqlite.prepare('SELECT * FROM agent_automation_jobs WHERE event_id=? AND agent_id=?')
      .get(eventId, c.agentId) as JobRow | undefined;
    if (row === undefined || row.claim !== claim || row.instance_id !== instanceId || row.connection_id !== c.connectionId) {
      throw new DomainError('conflict', 409, 'Claim is unavailable');
    }
    member(c.agentId, row.group_id);
    return row;
  }
  return {
    open(c: AgentCredential, instanceId: string, controllerId: string) {
      return tx(() => { assertInstance(c, instanceId, controllerId, true); return { opened: true }; });
    },
    configureForAgent(c: AgentCredential, groupId: string, enabled: boolean, model: string, onlyNew = false) {
      access(c);
      const current = binding(c.agentId, groupId);
      if (current !== undefined) {
        member(c.agentId, groupId);
        if (onlyNew || (current.enabled === (enabled ? 1 : 0) && current.model === model)) return publicBinding(current);
        throw new DomainError('conflict', 409, 'Only the owner can change an existing runtime configuration');
      }
      return tx(() => configure(c.agentId, groupId, enabled, model));
    },
    configureForOwner(ownerId: string, agentId: string, groupId: string, enabled: boolean) {
      if (!ports.agents.listOwnedAgents(ownerId).some((a) => a.id === agentId && a.status === 'active')) {
        throw new DomainError('not_found', 404, 'Agent unavailable');
      }
      return tx(() => configure(agentId, groupId, enabled, 'gpt-6.1-sol'));
    },
    ownerState(ownerId: string, agentId: string, groupId: string) {
      if (!ports.agents.listOwnedAgents(ownerId).some((a) => a.id === agentId)) throw new DomainError('not_found', 404, 'Agent unavailable');
      member(agentId, groupId);
      const row = binding(agentId, groupId);
      const jobs = sqlite.prepare('SELECT * FROM agent_automation_jobs WHERE agent_id=? AND group_id=? ORDER BY created_at DESC LIMIT 30')
        .all(agentId, groupId) as JobRow[];
      return { binding: row === undefined ? null : publicBinding(row), jobs: jobs.map(viewJob) };
    },
    agentConnected(agentId: string): boolean {
      const live = runtime(agentId);
      if (live === undefined) return false;
      try { ports.agents.resolveActiveConnection(live.connection_id); } catch { return false; }
      return Date.now() - live.last_seen < 15_000;
    },
    groupConnected(agentId: string, groupId: string): boolean {
      const row = binding(agentId, groupId);
      return row !== undefined && publicBinding(row).connected;
    },
    recoverForOwner(ownerId: string, agentId: string, connectionId: string, instanceId: string) {
      return tx(() => {
        if (!ports.agents.listOwnedAgents(ownerId).some((a) => a.id === agentId && a.status === 'active')) throw new DomainError('not_found', 404, 'Agent unavailable');
        const next = ports.agents.resolveActiveConnection(connectionId);
        if (next.agent.id !== agentId) throw new DomainError('not_found', 404, 'Connection unavailable');
        const previous = runtime(agentId);
        if (previous !== undefined) {
          let previousActive = false;
          try { ports.agents.resolveActiveConnection(previous.connection_id); previousActive = true; } catch { /* Revoked controller cannot publish. */ }
          if (previousActive) throw new DomainError('conflict', 409, 'Revoke the previous connection first');
        }
        if (sqlite.prepare("SELECT 1 FROM agent_automation_jobs WHERE agent_id=? AND state IN ('running','needs_review')").get(agentId)) {
          throw new DomainError('conflict', 409, 'An ambiguous turn must remain blocked');
        }
        sqlite.prepare("UPDATE agent_runtimes SET connection_id=?,instance_id=?,last_seen=0,controller_id='' WHERE agent_id=?").run(connectionId, instanceId, agentId);
        const pending = sqlite.prepare("SELECT event_id FROM agent_automation_jobs WHERE agent_id=? AND state IN ('generated','published')").all(agentId) as { event_id: string }[];
        for (const row of pending) sqlite.prepare('UPDATE agent_automation_jobs SET connection_id=?,instance_id=?,claim=? WHERE event_id=?').run(connectionId, instanceId, randomUUID(), row.event_id);
        sqlite.prepare('UPDATE agent_automation_bindings SET last_seen=0 WHERE agent_id=?').run(agentId);
        return { recovered: true };
      });
    },
    isRuntimeConnection(connectionId: string): boolean {
      return sqlite.prepare('SELECT 1 FROM agent_runtimes WHERE connection_id=?').get(connectionId) !== undefined;
    },
    next(c: AgentCredential, instanceId: string, groupIds: string[], controllerId = instanceId): {
      job: AutomationJob | null; event?: InboxEventView; binding?: AutomationBinding; blocked?: boolean;
    } {
      return tx(() => {
        assertInstance(c, instanceId, controllerId);
        const authorized = new Set(ports.groups.listGroupsForAgent(c.agentId).map(({ group }) => group.id));
        const covered = groupIds.filter((id) => authorized.has(id));
        let changed = false;
        for (const id of covered) {
          const row = binding(c.agentId, id);
          if (row !== undefined && Date.now() - row.last_seen >= 15_000) changed = true;
          sqlite.prepare('UPDATE agent_automation_bindings SET last_seen=? WHERE agent_id=? AND group_id=?').run(Date.now(), c.agentId, id);
        }
        if (changed) ports.hub.notifyAgentState(c.agentId);
        const enabled = covered.filter((id) => binding(c.agentId, id)?.enabled === 1);
        const pending = sqlite.prepare("SELECT * FROM agent_automation_jobs WHERE agent_id=? AND state!='done' ORDER BY created_at")
          .all(c.agentId) as JobRow[];
        const active = pending.find((j) => j.state === 'running' || j.state === 'needs_review');
        if (active !== undefined) {
          if (!authorized.has(active.group_id) || !covered.includes(active.group_id)) return { job: null, blocked: true };
          if (active.state === 'running' && active.started === 0) {
            const source = sqlite.prepare('SELECT message_id FROM inbox_events WHERE id=?').get(active.event_id) as { message_id: string };
            const event = ports.inbox.eventForMessage(c.agentId, source.message_id);
            if (event === undefined) {
              sqlite.prepare("UPDATE agent_automation_jobs SET state='done' WHERE event_id=?").run(active.event_id);
              return { job: null };
            }
            return { job: viewJob(active), event, binding: publicBinding(binding(c.agentId, active.group_id)!) };
          }
          return { job: viewJob(active) };
        }
        const ready = pending.find((j) => enabled.includes(j.group_id));
        if (ready !== undefined) return { job: viewJob(ready) };
        const used = sqlite.prepare('SELECT count(*) AS n FROM agent_automation_jobs WHERE agent_id=? AND created_at>?')
          .get(c.agentId, Date.now() - 3_600_000) as { n: number };
        if (used.n >= 30) {
          for (const id of enabled) sqlite.prepare('UPDATE agent_automation_bindings SET last_error=? WHERE agent_id=? AND group_id=?')
            .run('Se alcanzó el límite de 30 activaciones por hora. Los mensajes siguen pendientes.', c.agentId, id);
          return { job: null, blocked: true };
        }
        for (const id of enabled) sqlite.prepare('UPDATE agent_automation_bindings SET last_error=NULL WHERE agent_id=? AND group_id=?').run(c.agentId, id);
        // Scan every inbox page so disabled groups cannot starve enabled groups.
        let after: number | undefined;
        do {
          const page = ports.inbox.listPending({ agentId: c.agentId, limit: 100, ...(after === undefined ? {} : { after }) });
          for (const event of page.events) {
            if (!enabled.includes(event.groupId)) continue;
            const old = sqlite.prepare('SELECT * FROM agent_automation_jobs WHERE event_id=?').get(event.eventId) as JobRow | undefined;
            if (old !== undefined) continue;
            const decision = event.message.author.kind === 'agent' ? 'no_reply' : null;
            sqlite.prepare(`INSERT INTO agent_automation_jobs(event_id,agent_id,group_id,connection_id,instance_id,claim,state,decision,created_at,started)
              VALUES(?,?,?,?,?,?,?,?,?,?)`).run(event.eventId, c.agentId, event.groupId, c.connectionId, instanceId, randomUUID(), decision === null ? 'running' : 'generated', decision, Date.now(), decision === null ? 0 : 1);
            const row = sqlite.prepare('SELECT * FROM agent_automation_jobs WHERE event_id=?').get(event.eventId) as JobRow;
            return { job: viewJob(row), event, binding: publicBinding(binding(c.agentId, event.groupId)!) };
          }
          after = page.nextCursor;
        } while (after !== undefined);
        return { job: null };
      });
    },
    begin(c: AgentCredential, instanceId: string, eventId: string, claim: string, controllerId = instanceId) {
      return tx(() => {
        const row = jobFor(c, instanceId, eventId, claim, controllerId);
        if (row.state !== 'running' || row.started !== 0 || !binding(c.agentId, row.group_id)?.enabled) {
          throw new DomainError('conflict', 409, 'Generation authorization already consumed or paused');
        }
        const source = sqlite.prepare('SELECT acknowledged_at FROM inbox_events WHERE id=?').get(eventId) as { acknowledged_at: string | null };
        if (source.acknowledged_at !== null) throw new DomainError('conflict', 409, 'Event was already acknowledged');
        sqlite.prepare('UPDATE agent_automation_jobs SET started=1 WHERE event_id=?').run(eventId);
        return { started: true };
      });
    },
    save(c: AgentCredential, instanceId: string, eventId: string, claim: string,
      output: { decision: 'reply' | 'no_reply'; text: string; threadId: string }, controllerId = instanceId) {
      return tx(() => {
        const row = jobFor(c, instanceId, eventId, claim, controllerId);
        if (row.state !== 'running') {
          if (row.decision === output.decision && row.output === output.text && row.thread_id === output.threadId) return viewJob(row);
          throw new DomainError('conflict', 409, 'Output is immutable');
        }
        if (output.text.length > 4000 || (output.decision === 'reply' && !output.text.trim())) throw new DomainError('invalid_input', 400, 'Invalid reply');
        sqlite.prepare("UPDATE agent_automation_jobs SET state='generated',decision=?,output=?,thread_id=? WHERE event_id=?")
          .run(output.decision, output.text, output.threadId, eventId);
        sqlite.prepare('UPDATE agent_automation_bindings SET thread_id=?,last_error=NULL WHERE agent_id=? AND group_id=?')
          .run(output.threadId, c.agentId, row.group_id);
        return viewJob(sqlite.prepare('SELECT * FROM agent_automation_jobs WHERE event_id=?').get(eventId) as JobRow);
      });
    },
    finish(c: AgentCredential, instanceId: string, eventId: string, claim: string, controllerId = instanceId) {
      let published: ReturnType<Ports['messaging']['send']> | undefined;
      const result = tx(() => {
        const row = jobFor(c, instanceId, eventId, claim, controllerId);
        if (row.state === 'done') return viewJob(row);
        if (!binding(c.agentId, row.group_id)?.enabled) throw new DomainError('conflict', 409, 'Runtime is paused');
        if (!['generated', 'published'].includes(row.state)) throw new DomainError('conflict', 409, 'No durable result');
        const event = sqlite.prepare('SELECT acknowledged_at FROM inbox_events WHERE id=? AND agent_id=?').get(eventId, c.agentId) as { acknowledged_at: string | null };
        if (event.acknowledged_at === null && row.decision === 'reply') {
          published = ports.messaging.send({ author: { kind: 'agent', id: c.agentId }, groupId: row.group_id,
            text: row.output!, idempotencyKey: `automation:${eventId}` });
          sqlite.prepare('UPDATE agent_automation_jobs SET message_id=? WHERE event_id=?').run(published.message.id, eventId);
        }
        ports.inbox.acknowledge({ agentId: c.agentId, eventId });
        sqlite.prepare("UPDATE agent_automation_jobs SET state='done' WHERE event_id=?").run(eventId);
        return viewJob(sqlite.prepare('SELECT * FROM agent_automation_jobs WHERE event_id=?').get(eventId) as JobRow);
      });
      if (published !== undefined && !published.replayed) ports.hub.publishMessage(published.message);
      return result;
    },
    fail(c: AgentCredential, instanceId: string, eventId: string, claim: string, controllerId = instanceId) {
      return tx(() => {
        const row = jobFor(c, instanceId, eventId, claim, controllerId);
        if (row.state === 'done') return viewJob(row);
        sqlite.prepare("UPDATE agent_automation_jobs SET state='needs_review',error='Turno no confirmado; no se reintentó automáticamente' WHERE event_id=?").run(eventId);
        sqlite.prepare('UPDATE agent_automation_bindings SET last_error=? WHERE agent_id=? AND group_id=?')
          .run('El turno requiere revisión antes de continuar.', c.agentId, row.group_id);
        return viewJob(sqlite.prepare('SELECT * FROM agent_automation_jobs WHERE event_id=?').get(eventId) as JobRow);
      });
    },
  };
}
