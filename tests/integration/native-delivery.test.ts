import { afterEach, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { nativeProofPayload, nativeResultPayload, type NativeDeliveryView, type NativeResult, type NativeTerminalProof } from '@agent-chat/contracts';
import { createDatabase, type DatabaseHandle } from '../../apps/server/src/persistence/client';
import { migrateFromDirectory } from '../../apps/server/src/persistence/migrate';
import { createServices } from '../../apps/server/src/services';
import { createNativeDeliveryModule } from '../../apps/server/src/modules/native-delivery';
const databases: DatabaseHandle[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = createDatabase({ path: ':memory:', busyTimeoutMs: 1000 }); databases.push(db);
  migrateFromDirectory(db.sqlite, resolve('db/migrations'));
  const owner = randomUUID();
  db.sqlite.prepare('INSERT INTO users(id,email,password_hash,display_name) VALUES(?,?,?,?)').run(owner, `${owner}@example.com`, 'fixture', 'Owner');
  const services = createServices(db);
  const groupA = services.groups.createGroup({ userId: owner, name: 'A' }).group.id;
  const groupB = services.groups.createGroup({ userId: owner, name: 'B' }).group.id;
  const keys = generateKeyPairSync('ed25519'); const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const targetId = randomUUID();
  services.nativeAccess.repository.registerTarget({ id: targetId, ownerUserId: owner, provider: 'hermes', connectorId: 'fixture', nativeRef: 'profile', contextMode: 'native_per_group' });
  services.nativeAccess.setProofKey(owner, targetId, publicKey);
  db.sqlite.prepare('UPDATE native_runtime_targets SET capabilities_json=? WHERE id=?').run(JSON.stringify({ groupIsolation: 'verified', durableResults: 'verified', approvals: 'verified', toolCatalog: 'verified', nativeVisibility: 'verified' }), targetId);
  let time = Date.now(); const delivery = createNativeDeliveryModule(db.sqlite, services.nativeAccess, services, () => time);
  function identity() {
    const agent = services.agents.createAgent({ ownerUserId: owner, name: 'Fixture' });
    for (const groupId of [groupA, groupB]) services.groups.admitAgent({ userId: owner, groupId, agentId: agent.id });
    const client = randomUUID(); db.sqlite.prepare('INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES(?,?,?)').run(client, 'fixture', '[]');
    const connection = services.agents.createConnection({ agentId: agent.id, oauthClientId: client });
    const binding = services.nativeAccess.createOwnedBinding(owner, { agentId: agent.id, targetId, groupIds: [groupA, groupB] });
    const challenge = services.nativeAccess.createChallenge(owner, { kind: 'automatic', connectionId: connection.id, bindingId: binding.id, revision: 1, targetId, scopes: ['native:read','native:claim','native:start','native:complete'] });
    const grant = services.nativeAccess.consumeChallenge(connection.id, challenge.challenge, { bindingId: binding.id, revision: 1, targetId });
    delivery.configureOwner(owner, binding.id, 1, true);
    const controllerId = randomUUID(); const { epoch } = delivery.open(connection.id, controllerId);
    return { agentId: agent.id, connectionId: connection.id, bindingId: binding.id, grantId: grant.id, controllerId, epoch,
      next: () => delivery.next(connection.id, controllerId, epoch) };
  }
  const first = identity();
  const send = (text = 'hello', groupId = groupA) => services.messaging.send({ author: { kind: 'human', id: owner }, groupId, text, idempotencyKey: randomUUID() });
  const result = (d: NativeDeliveryView, text = 'Native answer'): NativeResult => ({ decision: text ? 'reply' : 'no_reply', text, conversationRef: d.conversationRef ?? `conversation:${d.groupId}` });
  const proof = (d: NativeDeliveryView, r?: NativeResult): NativeTerminalProof => {
    const data = { eventId: d.ticket.eventId, targetId, startKey: d.startKey, runRef: d.runRef ?? `run:${d.startKey}`, terminal: r ? 'completed' as const : 'cancelled' as const,
      resultHash: r ? createHash('sha256').update(nativeResultPayload(r)).digest('hex') : null };
    return { data, signature: sign(null, Buffer.from(nativeProofPayload(data)), keys.privateKey).toString('base64url') };
  };
  const claim = () => { send(); return first.next().delivery!; };
  return { db, owner, services, delivery, targetId, groupA, groupB, first, identity, send, result, proof, claim, advance: (days: number) => { time += days * 86400_000; } };
}
it('requires verified capabilities and an owner-approved enable; grants cannot activate a target', () => {
  const s = setup();
  s.db.sqlite.prepare("UPDATE native_runtime_targets SET capabilities_json='{}' WHERE id=?").run(s.targetId);
  expect(() => s.delivery.configureOwner(s.owner, s.first.bindingId, 1, true)).toThrow();
  expect(() => s.delivery.configureOwner(randomUUID(), s.first.bindingId, 1, true)).toThrow();
});
it('consumes start exactly once and reconciles a started claim after a new epoch without restarting', () => {
  const s = setup(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  expect(() => s.delivery.begin(s.first.connectionId, d.ticket)).toThrow();
  const controller = randomUUID(); const { epoch } = s.delivery.open(s.first.connectionId, controller);
  const recovered = s.delivery.next(s.first.connectionId, controller, epoch).delivery!;
  expect(recovered.started).toBe(true); expect(recovered.startKey).toBe(d.startKey);
  expect(() => s.delivery.begin(s.first.connectionId, recovered.ticket)).toThrow();
  const r = s.result(recovered);
  expect(() => s.delivery.save(s.first.connectionId, d.ticket, r, s.proof(d, r))).toThrow();
  s.delivery.save(s.first.connectionId, recovered.ticket, r, s.proof(recovered, r));
  expect(s.delivery.finish(s.first.connectionId, recovered.ticket).disposition).toBe('published');
});
it('recovers unstarted work, fences its old controller, and shares one slot across bindings and groups', () => {
  const s = setup(); const second = s.identity(); s.send('A'); s.send('B', s.groupB);
  const d = s.first.next().delivery!;
  expect(second.next()).toEqual({ delivery: null, blocked: true });
  const controller = randomUUID(); const { epoch } = s.delivery.open(s.first.connectionId, controller);
  const recovered = s.delivery.next(s.first.connectionId, controller, epoch).delivery!;
  expect(recovered.started).toBe(false);
  expect(() => s.delivery.begin(s.first.connectionId, d.ticket)).toThrow();
  s.delivery.begin(s.first.connectionId, recovered.ticket);
  expect(second.next()).toEqual({ delivery: null, blocked: true });
});
it('recovers immutable output and a lost publication response from a completely new controller', () => {
  const s = setup(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  const r = s.result(d); s.delivery.save(s.first.connectionId, d.ticket, r, s.proof(d, r));
  const controller = randomUUID(); const { epoch } = s.delivery.open(s.first.connectionId, controller);
  const recovered = s.delivery.next(s.first.connectionId, controller, epoch).delivery!;
  expect(recovered.result).toEqual(r);
  const receipt = s.delivery.finish(s.first.connectionId, recovered.ticket);
  const newController = randomUUID(); s.delivery.open(s.first.connectionId, newController);
  expect(s.delivery.get(s.first.connectionId, d.ticket.eventId).receipt).toEqual(receipt);
  expect(s.delivery.get(s.first.connectionId, d.ticket.eventId).result).toEqual(r);
  expect(s.db.sqlite.prepare("SELECT count(*) AS n FROM messages WHERE author_kind='agent'").get()).toEqual({ n: 1 });
  expect(s.db.sqlite.prepare('SELECT acknowledged_at FROM inbox_events WHERE id=?').get(d.ticket.eventId)).not.toEqual({ acknowledged_at: null });
});
it('rejects forged terminal proofs, changed output and unrelated run references', () => {
  const s = setup(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  const r = s.result(d); const p = s.proof(d, r);
  expect(() => s.delivery.save(s.first.connectionId, d.ticket, r, { ...p, signature: 'forged' })).toThrow();
  s.delivery.running(s.first.connectionId, d.ticket, p.data.runRef);
  const wrong = s.proof({ ...d, runRef: 'other-run' }, r);
  expect(() => s.delivery.save(s.first.connectionId, d.ticket, r, wrong)).toThrow();
  s.delivery.save(s.first.connectionId, d.ticket, r, p);
  const changed = s.result(d, 'Changed');
  expect(() => s.delivery.save(s.first.connectionId, d.ticket, changed, s.proof(d, changed))).toThrow();
  expect(s.delivery.get(s.first.connectionId, d.ticket.eventId).result).toEqual(r);
});
it('keeps publication and ACK atomic if the ACK fails', () => {
  const s = setup(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  const r = s.result(d); s.delivery.save(s.first.connectionId, d.ticket, r, s.proof(d, r));
  const broken = createNativeDeliveryModule(s.db.sqlite, s.services.nativeAccess, { ...s.services, inbox: { ...s.services.inbox, acknowledge() { throw new Error('fixture ACK failure'); } } });
  expect(() => broken.finish(s.first.connectionId, d.ticket)).toThrow();
  expect(s.db.sqlite.prepare("SELECT count(*) AS n FROM messages WHERE author_kind='agent'").get()).toEqual({ n: 0 });
  expect(s.delivery.get(s.first.connectionId, d.ticket.eventId).state).toBe('result_saved');
});
it('retains output through pause and finishes without regeneration after resuming', () => {
  const s = setup(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  const r = s.result(d); s.delivery.save(s.first.connectionId, d.ticket, r, s.proof(d, r));
  s.delivery.configureOwner(s.owner, s.first.bindingId, 1, false);
  expect(() => s.delivery.finish(s.first.connectionId, d.ticket)).toThrow();
  s.advance(45); s.delivery.retain(); expect(s.delivery.get(s.first.connectionId, d.ticket.eventId).result).toEqual(r);
  s.delivery.configureOwner(s.owner, s.first.bindingId, 1, true);
  expect(s.delivery.finish(s.first.connectionId, d.ticket).disposition).toBe('published');
});
it('keeps an uncertain slot after manual ACK and revocation until signed terminal evidence arrives', () => {
  const s = setup(); const second = s.identity(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  s.services.groups.removeAgentMember({ userId: s.owner, groupId: s.groupA, agentId: s.first.agentId });
  expect(s.first.next()).toEqual({ delivery: null, blocked: true });
  expect(() => s.delivery.get(s.first.connectionId, d.ticket.eventId)).toThrow();
  s.services.nativeAccess.revoke(s.owner, s.first.grantId);
  expect(s.delivery.suppressOwner(s.owner, d.ticket.eventId)).toEqual({ state: 'needs_review', receipt: null });
  expect(second.next()).toEqual({ delivery: null, blocked: true });
  expect(() => s.delivery.reconcile({ ...s.proof(d), signature: 'fake' })).toThrow();
  expect(s.delivery.reconcile(s.proof(d))).toEqual({ reconciled: true, closed: true });
  expect(second.next().delivery).not.toBeNull();
  expect(s.db.sqlite.prepare("SELECT count(*) AS n FROM messages WHERE author_kind='agent'").get()).toEqual({ n: 0 });
});
it('closes an unstarted suppressed claim without permitting a delayed begin', () => {
  const s = setup(); const d = s.claim();
  expect(s.delivery.suppressOwner(s.owner, d.ticket.eventId).receipt?.disposition).toBe('suppressed');
  expect(() => s.delivery.begin(s.first.connectionId, d.ticket)).toThrow();
});
it('acknowledges intentional no_reply once without creating an agent message', () => {
  const s = setup(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  const r = s.result(d, ''); s.delivery.save(s.first.connectionId, d.ticket, r, s.proof(d, r));
  expect(s.delivery.finish(s.first.connectionId, d.ticket)).toEqual({ disposition: 'no_reply', messageId: null });
  expect(s.delivery.finish(s.first.connectionId, d.ticket)).toEqual({ disposition: 'no_reply', messageId: null });
});
it('purges only terminal bodies and preserves tombstones through late notification replay', () => {
  const s = setup(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  const r = s.result(d); s.delivery.save(s.first.connectionId, d.ticket, r, s.proof(d, r));
  const receipt = s.delivery.finish(s.first.connectionId, d.ticket);
  s.advance(31); s.delivery.retain();
  expect(s.delivery.get(s.first.connectionId, d.ticket.eventId).result).toBeNull();
  expect(s.delivery.get(s.first.connectionId, d.ticket.eventId).receipt).toEqual(receipt);
  s.db.sqlite.prepare('UPDATE inbox_events SET acknowledged_at=NULL WHERE id=?').run(d.ticket.eventId);
  expect(s.first.next()).toEqual({ delivery: null });
});
it('rechecks the real sender membership before dispatch and preserves the exact queued input', () => {
  const s = setup(); const sender = randomUUID();
  s.db.sqlite.prepare('INSERT INTO users(id,email,password_hash,display_name) VALUES(?,?,?,?)').run(sender, `${sender}@example.com`, 'fixture', 'Sender');
  s.db.sqlite.prepare("INSERT INTO group_human_memberships(group_id,user_id,role) VALUES(?,?,'member')").run(s.groupA, sender);
  s.services.messaging.send({ author: { kind: 'human', id: sender }, groupId: s.groupA, text: 'First queued message', idempotencyKey: randomUUID() });
  s.send('Later message');
  const d = s.first.next().delivery!;
  expect(d.incoming?.text).toBe('First queued message');
  s.services.groups.removeHumanMember({ userId: s.owner, groupId: s.groupA, memberId: sender });
  expect(() => s.delivery.begin(s.first.connectionId, d.ticket)).toThrow();
});
it('retains an awaiting approval slot and accepts only a signed terminal result afterwards', () => {
  const s = setup(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  s.delivery.pending(s.first.connectionId, d.ticket, 'awaiting_approval');
  expect(s.first.next().delivery!.state).toBe('awaiting_approval');
  const r = s.result(d); s.delivery.save(s.first.connectionId, d.ticket, r, s.proof(d, r));
  expect(s.delivery.finish(s.first.connectionId, d.ticket).disposition).toBe('published');
});
it('does not expand activation to agent messages and does not let them starve human input', () => {
  const s = setup(); const sender = s.identity();
  s.services.messaging.send({ author: { kind: 'agent', id: sender.agentId }, groupId: s.groupA, text: 'Agent echo', idempotencyKey: randomUUID() });
  expect(s.first.next().delivery).toBeNull();
  s.send('Human trigger'); expect(s.first.next().delivery?.incoming?.text).toBe('Human trigger');
});
it('bounds new activations per target while leaving pending messages recoverable', () => {
  const s = setup();
  for (let i = 0; i < 30; i++) {
    const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
    const r = s.result(d, ''); s.delivery.save(s.first.connectionId, d.ticket, r, s.proof(d, r)); s.delivery.finish(s.first.connectionId, d.ticket);
  }
  s.send('Leave pending'); expect(s.first.next()).toEqual({ delivery: null, blocked: true });
  expect(s.services.inbox.listPending({ agentId: s.first.agentId }).events).toHaveLength(1);
  s.advance(1); expect(s.first.next().delivery?.incoming?.text).toBe('Leave pending');
});
it('dispatches cancellation once without equating its acceptance with quiescence or ACK', () => {
  const s = setup(); const d = s.claim(); s.delivery.begin(s.first.connectionId, d.ticket);
  expect(s.delivery.cancelOwner(s.owner, d.ticket.eventId)).toEqual({ state: 'cancel_requested' });
  s.delivery.cancelBegin(s.first.connectionId, d.ticket);
  expect(() => s.delivery.cancelBegin(s.first.connectionId, d.ticket)).toThrow();
  expect(s.delivery.get(s.first.connectionId, d.ticket.eventId).cancelStarted).toBe(true);
  expect(s.services.inbox.listPending({ agentId: s.first.agentId }).events).toHaveLength(1);
  s.delivery.reconcile(s.proof(d));
  expect(s.delivery.get(s.first.connectionId, d.ticket.eventId).state).toBe('cancel_requested');
  expect(s.delivery.suppressOwner(s.owner, d.ticket.eventId).receipt?.disposition).toBe('suppressed');
});
