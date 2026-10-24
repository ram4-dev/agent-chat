import { nativePublicationKey } from '../messaging/agent-idempotency.js';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import type Database from 'better-sqlite3';
import { nativeProofPayload, nativeResultPayload, type NativeDeliveryView, type NativeGrant, type NativeResult, type NativeTerminalProof, type NativeTicket } from '@agent-chat/contracts';
import { DomainError } from '../errors.js';
import type { NativeAccessModule } from '../native-access/index.js';
import type { LocalApplicationServices as ApplicationServices } from '../../services.js';
import { runImmediateTransaction } from '../../persistence/client.js';

interface Row {
  event_id: string; binding_id: string; binding_revision: number; target_id: string; agent_id: string; group_id: string;
  grant_id: string; controller_id: string; controller_epoch: number; claim: string; start_key: string; started: number;
  state: string; provider_started: number; cancel_started: number; native_run_ref: string | null; proof_public_key: string; terminal_confirmed: number; owner_suppressed: number;
  evidence_hash: string | null; result_hash: string | null; result_text: string | null; decision: NativeResult['decision'] | null; conversation_ref: string | null;
  disposition: 'published' | 'no_reply' | 'suppressed' | null; message_id: string | null;
}
const fail = (code: 'conflict' | 'forbidden' = 'conflict') => new DomainError(code, code === 'conflict' ? 409 : 403, 'Native delivery unavailable');
const evidenceDigest = (proof: NativeTerminalProof) => createHash('sha256').update(nativeProofPayload(proof.data)).digest('hex');
const digest = (result: NativeResult) => createHash('sha256').update(nativeResultPayload(result)).digest('hex');
export function createNativeDeliveryModule(sqlite: Database.Database, access: NativeAccessModule,
  ports: Pick<ApplicationServices, 'agents' | 'groups' | 'messaging' | 'inbox' | 'hub'>, now: () => number = Date.now) {
  const tx = <T>(work: () => T): T => runImmediateTransaction(sqlite, work);
  const row = (eventId: string) => sqlite.prepare('SELECT * FROM native_deliveries WHERE event_id=?').get(eventId) as Row | undefined;
  function grant(connectionId: string): NativeGrant {
    const value = access.resolve(connectionId);
    if (value.kind !== 'automatic') throw fail('forbidden');
    return value;
  }
  function authorize(connectionId: string, r: Row, scope: 'native:read' | 'native:claim' | 'native:start' | 'native:complete') {
    const g = grant(connectionId);
    if (g.bindingId !== r.binding_id || g.revision !== r.binding_revision || g.targetId !== r.target_id) throw fail('forbidden');
    access.requireAccess(connectionId, scope, r.agent_id, r.group_id);
    return g;
  }
  function enabled(bindingId: string) {
    if (!sqlite.prepare('SELECT 1 FROM native_bindings WHERE id=? AND enabled=1 AND legacy_projection=0').get(bindingId)) throw fail();
  }
  function controller(g: NativeGrant, id: string, epoch: number) {
    if (!sqlite.prepare('SELECT 1 FROM native_binding_controllers WHERE binding_id=? AND grant_id=? AND controller_id=? AND epoch=?')
      .get(g.bindingId, g.id, id, epoch)) throw fail();
  }
  function claimed(connectionId: string, ticket: NativeTicket, scope: 'native:start' | 'native:complete'): Row {
    const r = row(ticket.eventId); if (!r) throw fail('forbidden');
    const g = authorize(connectionId, r, scope);
    controller(g, ticket.controllerId, ticket.epoch);
    if (r.grant_id !== g.id || r.claim !== ticket.claim || r.controller_id !== ticket.controllerId || r.controller_epoch !== ticket.epoch) throw fail();
    return r;
  }
  function view(r: Row): NativeDeliveryView {
    const source = r.state !== 'done' ? sqlite.prepare('SELECT message_id FROM inbox_events WHERE id=?').get(r.event_id) as { message_id: string } | undefined : undefined;
    const mapping = sqlite.prepare('SELECT generation FROM native_conversations WHERE binding_id=? AND revision=? AND group_id=? ORDER BY generation DESC LIMIT 1').get(r.binding_id, r.binding_revision, r.group_id) as { generation: number };
    return { bindingRevision: r.binding_revision, conversationGeneration: mapping.generation, ticket: { eventId: r.event_id, claim: r.claim, epoch: r.controller_epoch, controllerId: r.controller_id },
      bindingId: r.binding_id, targetId: r.target_id, agentId: r.agent_id, groupId: r.group_id,
      incoming: source ? ports.inbox.eventForMessage(r.agent_id, source.message_id)?.message ?? null : null,
      state: r.state, started: r.started === 1, cancelStarted: r.cancel_started === 1, startKey: r.start_key, runRef: r.native_run_ref,
      conversationRef: r.conversation_ref,
      result: r.result_text !== null && r.decision !== null && r.conversation_ref !== null ? { decision: r.decision, text: r.result_text, conversationRef: r.conversation_ref } : null,
      receipt: r.disposition ? { disposition: r.disposition, messageId: r.message_id } : null };
  }
  function proof(r: Row, value: NativeTerminalProof): void {
    const d = value.data;
    if ((d.terminal === 'completed') !== (d.resultHash !== null) || (r.evidence_hash !== null && r.evidence_hash !== evidenceDigest(value))) throw fail();
    if (!r.started || d.eventId !== r.event_id || d.targetId !== r.target_id || d.startKey !== r.start_key ||
        (r.native_run_ref !== null && d.runRef !== r.native_run_ref)) throw fail('forbidden');
    let valid = false;
    try { valid = createPublicKey(r.proof_public_key).asymmetricKeyType === 'ed25519' && verify(null, Buffer.from(nativeProofPayload(d)), r.proof_public_key, Buffer.from(value.signature, 'base64url')); }
    catch { /* Invalid evidence never closes a reservation. */ }
    if (!valid) throw fail('forbidden');
  }
  function budgetFull(targetId: string): boolean {
    const recent = sqlite.prepare('SELECT count(*) AS n FROM native_deliveries WHERE target_id=? AND started_at>?').get(targetId, now() - 3600_000) as { n: number };
    return recent.n >= 30;
  }
  function allowedSender(r: Pick<Row, 'event_id' | 'binding_id' | 'binding_revision' | 'group_id'>): boolean {
    const source = sqlite.prepare(`SELECT m.author_kind,m.human_author_id,m.agent_author_id,g.allowed_sender_refs_json
      FROM inbox_events e JOIN messages m ON m.id=e.message_id JOIN native_binding_groups g
      ON g.binding_id=? AND g.revision=? AND g.group_id=e.group_id WHERE e.id=?`).get(r.binding_id, r.binding_revision, r.event_id) as {
        author_kind: 'human' | 'agent'; human_author_id: string | null; agent_author_id: string | null; allowed_sender_refs_json: string;
      } | undefined;
    if (!source) return false;
    const id = source.author_kind === 'human' ? source.human_author_id : source.agent_author_id;
    const allowed = JSON.parse(source.allowed_sender_refs_json) as string[];
    if (allowed.length && !allowed.includes(`${source.author_kind}:${id}`)) return false;
    // Agent-triggered runs remain disabled until cycle detection is implemented and verified.
    if (source.author_kind !== 'human') return false;
    if (source.author_kind === 'human') return !!sqlite.prepare('SELECT 1 FROM group_human_memberships WHERE group_id=? AND user_id=?').get(r.group_id, id);
    return false;
  }
  function finishSuppressed(r: Row): void {
    sqlite.prepare(`UPDATE native_deliveries SET state='done',disposition='suppressed',completed_at=? WHERE event_id=?`).run(now(), r.event_id);
  }
  return {
    configureOwner(owner: string, bindingId: string, expectedRevision: number, value: boolean) {
      return tx(() => {
        const binding = access.repository.findBinding(owner, bindingId);
        if (!binding || binding.legacyProjection || binding.revision !== expectedRevision) throw fail('forbidden');
        if (value) {
          const target = access.repository.findTarget(owner, binding.targetId)!;
          const key = sqlite.prepare('SELECT proof_public_key FROM native_runtime_targets WHERE id=?').get(target.id) as { proof_public_key: string | null };
          if (!key.proof_public_key || Object.values(target.capabilities).some(status => status !== 'verified')) throw fail();
          const groups = sqlite.prepare('SELECT group_id FROM native_binding_groups WHERE binding_id=? AND revision=? AND enabled=1').all(bindingId, binding.revision) as { group_id: string }[];
          if (target.provider === 'grok_bot' && groups.length !== 1) throw fail();
          if (!groups.length || !ports.agents.isActiveAgent(binding.agentId) || groups.some(g => !ports.groups.listGroupsForAgent(binding.agentId).some(m => m.group.id === g.group_id))) throw fail();
        }
        sqlite.prepare('UPDATE native_bindings SET enabled=? WHERE id=?').run(value ? 1 : 0, bindingId);
        return { enabled: value };
      });
    },
    open(connectionId: string, controllerId: string) {
      return tx(() => {
        const g = grant(connectionId);
        if (!g.scopes.includes('native:claim')) throw fail('forbidden');
        const current = sqlite.prepare('SELECT * FROM native_binding_controllers WHERE binding_id=?').get(g.bindingId) as { controller_id: string; grant_id: string; epoch: number } | undefined;
        if (current?.controller_id === controllerId && current.grant_id === g.id) {
          sqlite.prepare('UPDATE native_binding_controllers SET last_contact_at=? WHERE binding_id=?').run(now(), g.bindingId);
          return { epoch: current.epoch };
        }
        const epoch = (current?.epoch ?? 0) + 1;
        sqlite.prepare(`INSERT INTO native_binding_controllers(binding_id,grant_id,controller_id,epoch) VALUES(?,?,?,?)
          ON CONFLICT(binding_id) DO UPDATE SET grant_id=excluded.grant_id,controller_id=excluded.controller_id,epoch=excluded.epoch`).run(g.bindingId, g.id, controllerId, epoch);
        sqlite.prepare('UPDATE native_binding_controllers SET last_contact_at=? WHERE binding_id=?').run(now(), g.bindingId);
        return { epoch };
      });
    },
    next(connectionId: string, controllerId: string, epoch: number): { delivery: NativeDeliveryView | null; blocked?: boolean } {
      return tx(() => {
        const g = grant(connectionId); controller(g, controllerId, epoch); enabled(g.bindingId!);
        if (!g.scopes.includes('native:claim') || !g.scopes.includes('native:read')) throw fail('forbidden');
        sqlite.prepare('UPDATE native_binding_controllers SET last_contact_at=? WHERE binding_id=?').run(now(), g.bindingId);
        const active = sqlite.prepare("SELECT * FROM native_deliveries WHERE target_id=? AND state NOT IN ('queued','done')").get(g.targetId) as Row | undefined;
        if (active) {
          try { authorize(connectionId, active, 'native:claim'); access.requireAccess(connectionId, 'native:read', active.agent_id, active.group_id); }
          catch { return { delivery: null, blocked: true }; }
          if (active.grant_id !== g.id || active.controller_id !== controllerId || active.controller_epoch !== epoch) {
            sqlite.prepare('UPDATE native_deliveries SET grant_id=?,controller_id=?,controller_epoch=?,claim=? WHERE event_id=?')
              .run(g.id, controllerId, epoch, randomUUID(), active.event_id);
          }
          return { delivery: view(row(active.event_id)!) };
        }
        if (budgetFull(g.targetId!)) return { delivery: null, blocked: true };
        const selection = g.selections[0]; if (!selection) throw fail('forbidden');
        const events = sqlite.prepare(`SELECT e.id,e.group_id FROM inbox_events e WHERE e.agent_id=? AND e.acknowledged_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM native_deliveries d WHERE d.event_id=e.id) ORDER BY e.sequence`).all(selection.agentId) as { id: string; group_id: string }[];
        for (const event of events) {
          try { access.requireAccess(connectionId, 'native:claim', selection.agentId, event.group_id); access.requireAccess(connectionId, 'native:read', selection.agentId, event.group_id); }
          catch { continue; }
          const key = sqlite.prepare('SELECT proof_public_key FROM native_runtime_targets WHERE id=?').get(g.targetId) as { proof_public_key: string | null };
          if (!key.proof_public_key) throw fail();
          if (!allowedSender({ event_id: event.id, binding_id: g.bindingId!, binding_revision: g.revision!, group_id: event.group_id })) continue;
          const conversation = sqlite.prepare('SELECT native_ref FROM native_conversations WHERE binding_id=? AND revision=? AND group_id=? ORDER BY generation DESC LIMIT 1')
            .get(g.bindingId, g.revision, event.group_id) as { native_ref: string | null };
          sqlite.prepare(`INSERT INTO native_deliveries(event_id,agent_id,group_id,binding_id,binding_revision,target_id,grant_id,controller_id,controller_epoch,claim,start_key,state,created_at,proof_public_key,conversation_ref)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,'claimed',?,?,?)`).run(event.id, selection.agentId, event.group_id, g.bindingId, g.revision, g.targetId, g.id, controllerId, epoch, randomUUID(), randomUUID(), now(), key.proof_public_key, conversation.native_ref);
          return { delivery: view(row(event.id)!) };
        }
        return { delivery: null };
      });
    },
    begin(connectionId: string, ticket: NativeTicket) {
      return tx(() => {
        const r = claimed(connectionId, ticket, 'native:start'); enabled(r.binding_id);
        if (r.started || r.state !== 'claimed' || !allowedSender(r)) throw fail();
        if (budgetFull(r.target_id)) throw new DomainError('rate_limited', 429, 'Native activation limit reached');
        sqlite.prepare("UPDATE native_deliveries SET started=1,started_at=?,state='start_uncertain' WHERE event_id=? AND started=0").run(now(), r.event_id);
        return { startKey: r.start_key };
      });
    },
    cancelBegin(connectionId: string, ticket: NativeTicket) {
      return tx(() => {
        const r = claimed(connectionId, ticket, 'native:start');
        if (!r.started || r.state !== 'cancel_requested' || r.cancel_started) throw fail();
        sqlite.prepare('UPDATE native_deliveries SET cancel_started=1 WHERE event_id=?').run(r.event_id);
        return { authorized: true };
      });
    },
    cancelOwner(owner: string, eventId: string) {
      return tx(() => {
        const r = row(eventId); if (!r || !access.repository.findBinding(owner, r.binding_id)) throw fail('forbidden');
        if (r.state !== 'done' && r.state !== 'result_saved') sqlite.prepare("UPDATE native_deliveries SET state='cancel_requested' WHERE event_id=?").run(eventId);
        return { state: row(eventId)!.state };
      });
    },
    grokBegin(connectionId: string, ticket: NativeTicket, startKey: string) {
      return tx(() => {
        const r = claimed(connectionId, ticket, 'native:start'); enabled(r.binding_id);
        const target = sqlite.prepare('SELECT provider FROM native_runtime_targets WHERE id=?').get(r.target_id) as { provider: string };
        if (target.provider !== 'grok_bot' || !r.started || r.provider_started || r.start_key !== startKey || r.owner_suppressed ||
            !['start_uncertain','running','awaiting_approval','needs_review'].includes(r.state) || !allowedSender(r)) throw fail();
        // Separate from webhook dispatch: duplicates and delayed wakes cannot obtain another task start.
        sqlite.prepare('UPDATE native_deliveries SET provider_started=1 WHERE event_id=?').run(r.event_id);
        return { authorized: true, delivery: view(row(r.event_id)!) };
      });
    },
    running(connectionId: string, ticket: NativeTicket, runRef: string) {
      return tx(() => {
        const r = claimed(connectionId, ticket, 'native:start');
        if (['result_saved','done'].includes(r.state) && r.native_run_ref === runRef) return { recorded: true };
        if (!r.started || !['start_uncertain','running','awaiting_approval'].includes(r.state) || (r.native_run_ref && r.native_run_ref !== runRef)) throw fail();
        sqlite.prepare("UPDATE native_deliveries SET state='running',native_run_ref=? WHERE event_id=?").run(runRef, r.event_id);
        return { recorded: true };
      });
    },
    pending(connectionId: string, ticket: NativeTicket, state: 'awaiting_approval' | 'needs_review') {
      return tx(() => {
        const r = claimed(connectionId, ticket, 'native:start');
        if (!r.started || r.state === 'done' || r.state === 'result_saved' || r.state === 'cancel_requested') throw fail();
        sqlite.prepare('UPDATE native_deliveries SET state=? WHERE event_id=?').run(state, r.event_id);
        return { recorded: true };
      });
    },
    save(connectionId: string, ticket: NativeTicket, result: NativeResult, evidence: NativeTerminalProof) {
      return tx(() => {
        const r = claimed(connectionId, ticket, 'native:complete');
        const target = sqlite.prepare('SELECT provider FROM native_runtime_targets WHERE id=?').get(r.target_id) as { provider: string };
        if (target.provider === 'grok_bot' && !r.provider_started) throw fail();
        proof(r, evidence);
        const hash = digest(result);
        if (evidence.data.terminal !== 'completed' || evidence.data.resultHash !== hash ||
            (result.decision === 'no_reply' && result.text !== '') || (result.decision === 'reply' && !result.text.trim())) throw fail();
        if (r.result_hash !== null) {
          if (r.result_hash !== hash) throw fail();
          return { saved: true };
        }
        if (r.state === 'done' || r.state === 'cancel_requested') throw fail();
        const conversation = sqlite.prepare('SELECT generation,native_ref FROM native_conversations WHERE binding_id=? AND revision=? AND group_id=? ORDER BY generation DESC LIMIT 1')
          .get(r.binding_id, r.binding_revision, r.group_id) as { generation: number; native_ref: string | null };
        if (conversation.native_ref !== null && conversation.native_ref !== result.conversationRef) throw fail();
        sqlite.prepare('UPDATE native_conversations SET native_ref=? WHERE binding_id=? AND revision=? AND group_id=? AND generation=?')
          .run(result.conversationRef, r.binding_id, r.binding_revision, r.group_id, conversation.generation);
        sqlite.prepare(`UPDATE native_deliveries SET state='result_saved',decision=?,result_text=?,result_hash=?,conversation_ref=?,native_run_ref=?,terminal_confirmed=1,terminal_proof=?,evidence_hash=? WHERE event_id=?`)
          .run(result.decision, result.text, hash, result.conversationRef, evidence.data.runRef, JSON.stringify(evidence), evidenceDigest(evidence), r.event_id);
        return { saved: true };
      });
    },
    finish(connectionId: string, ticket: NativeTicket) {
      let published: ReturnType<typeof ports.messaging.send> | undefined;
      const receipt = tx(() => {
        const r = claimed(connectionId, ticket, 'native:complete');
        if (r.state === 'done') return view(r).receipt!;
        if (r.state !== 'result_saved' || !r.terminal_confirmed) throw fail();
        if (r.owner_suppressed) { finishSuppressed(r); return view(row(r.event_id)!).receipt!; }
        enabled(r.binding_id);
        if (r.decision === 'reply') published = ports.messaging.send({ author: { kind: 'agent', id: r.agent_id }, groupId: r.group_id, text: r.result_text!, idempotencyKey: nativePublicationKey(r.event_id) });
        ports.inbox.acknowledge({ agentId: r.agent_id, eventId: r.event_id });
        sqlite.prepare(`UPDATE native_deliveries SET state='done',disposition=?,message_id=?,completed_at=? WHERE event_id=?`)
          .run(r.decision === 'reply' ? 'published' : 'no_reply', published?.message.id ?? null, now(), r.event_id);
        return view(row(r.event_id)!).receipt!;
      });
      if (published && !published.replayed) ports.hub.publishMessage(published.message);
      return receipt;
    },
    get(connectionId: string, eventId: string) {
      const r = row(eventId); if (!r) throw fail('forbidden'); authorize(connectionId, r, 'native:read'); return view(r);
    },
    suppressOwner(owner: string, eventId: string) {
      return tx(() => {
        const r = row(eventId); if (!r || !access.repository.findBinding(owner, r.binding_id)) throw fail('forbidden');
        if (r.state === 'done') return { state: r.state, receipt: view(r).receipt };
        // Explicit owner intervention is distinct from a runtime ACK. It never asserts quiescence.
        sqlite.prepare('UPDATE inbox_events SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=?').run(new Date(now()).toISOString(), eventId);
        sqlite.prepare("UPDATE native_deliveries SET owner_suppressed=1,state='needs_review' WHERE event_id=?").run(eventId);
        if (!r.started || r.terminal_confirmed) finishSuppressed(r);
        return { state: row(eventId)!.state, receipt: view(row(eventId)!).receipt };
      });
    },
    reconcile(evidence: NativeTerminalProof) {
      return tx(() => {
        const r = row(evidence.data.eventId); if (!r) throw fail('forbidden'); proof(r, evidence);
        if (r.result_hash && evidence.data.resultHash !== r.result_hash) throw fail();
        sqlite.prepare('UPDATE native_deliveries SET terminal_confirmed=1,native_run_ref=?,terminal_proof=?,evidence_hash=? WHERE event_id=?')
          .run(evidence.data.runRef, JSON.stringify(evidence), evidenceDigest(evidence), r.event_id);
        if (r.state !== 'done' && r.owner_suppressed) finishSuppressed(r);
        return { reconciled: true, closed: row(r.event_id)!.state === 'done' };
      });
    },
    retain() {
      // Pending/uncertain/results awaiting ACK are deliberately excluded.
      sqlite.prepare("UPDATE native_deliveries SET result_text=NULL,terminal_proof=NULL WHERE state='done' AND completed_at<?").run(now() - 7 * 86400_000);
      // The minimal receipt/digest stays tied to the inbox event; an old replay never generates again.
      sqlite.prepare("UPDATE native_deliveries SET proof_public_key=NULL WHERE state='done' AND completed_at<?").run(now() - 30 * 86400_000);
    },
  };
}
export type NativeDeliveryModule = ReturnType<typeof createNativeDeliveryModule>;
