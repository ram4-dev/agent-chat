import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GROUP_PATHS, MESSAGE_PATHS } from '@agent-chat/contracts';
import { startHarness, ownerWithAgent, call, connect } from '../helpers/agent-harness';
import { createServices } from '../../apps/server/src/services';
import type { AgentCredential } from '../../apps/server/src/adapters/mcp/auth';

async function setup() {
  const h = await startHarness();
  const owner = await ownerWithAgent(h, 'runtime@example.com', 'Scout');
  const create = await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.collection, payload: { name: 'Automático' } });
  const groupId = (JSON.parse(create.body) as { group: { id: string } }).group.id;
  await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(groupId, owner.agentId) });
  const connection = h.database.sqlite.prepare('SELECT id FROM agent_connections WHERE agent_id=?').get(owner.agentId) as { id: string };
  const c: AgentCredential = { agentId: owner.agentId, connectionId: connection.id, scopes: ['agent:read', 'agent:inbox', 'agent:send'], expiresAt: Date.now() + 60_000 };
  const services = createServices(h.database);
  const runtime = services.automation;
  runtime.configureForAgent(c, groupId, true, 'gpt-6.1-sol');
  const instance = randomUUID();
  const send = async (text = 'hola') => call(h, owner.jar, { method: 'POST', url: MESSAGE_PATHS.collection(groupId), payload: { text, idempotencyKey: randomUUID() } });
  return { h, owner, groupId, c, services, runtime, instance, send };
}

describe('automatic inbox processing', () => {
  it('claims once, rejects another instance and publishes/ACKs atomically without duplicate output', async () => {
    const s = await setup(); await s.send();
    const first = s.runtime.next(s.c, s.instance, [s.groupId]);
    expect(first.event?.message.text).toBe('hola');
    s.runtime.begin(s.c, s.instance, first.job!.eventId, first.job!.claim);
    expect(() => s.runtime.begin(s.c, s.instance, first.job!.eventId, first.job!.claim)).toThrow('already consumed');
    const again = s.runtime.next(s.c, s.instance, [s.groupId]);
    expect(again.event).toBeUndefined();
    expect(again.job?.claim).toBe(first.job?.claim);
    expect(() => s.runtime.next(s.c, randomUUID(), [s.groupId])).toThrow('Another runtime');
    const j = first.job!;
    expect(() => s.runtime.finish(s.c, s.instance, j.eventId, j.claim)).toThrow('No durable result');
    s.runtime.save(s.c, s.instance, j.eventId, j.claim, { decision: 'reply', text: 'Recibido', threadId: 'thread-one' });
    expect(() => s.runtime.save(s.c, s.instance, j.eventId, j.claim, { decision: 'reply', text: 'Otro texto', threadId: 'thread-one' })).toThrow('immutable');
    const published = s.runtime.finish(s.c, s.instance, j.eventId, j.claim);
    expect(published.messageId).toBeTruthy();
    expect(s.runtime.finish(s.c, s.instance, j.eventId, j.claim).messageId).toBe(published.messageId);
    expect(s.services.inbox.listPending({ agentId: s.owner.agentId }).events).toHaveLength(0);
    const messages = s.h.database.sqlite.prepare('SELECT text FROM messages').all();
    expect(messages).toHaveLength(2);
  });
  it('pause blocks publication and restarting config does not override the pause', async () => {
    const s = await setup(); await s.send();
    const j = s.runtime.next(s.c, s.instance, [s.groupId]).job!;
    s.runtime.configureForOwner(s.services.agents.resolveActiveConnection(s.c.connectionId).agent.ownerUserId, s.c.agentId, s.groupId, false);
    s.runtime.save(s.c, s.instance, j.eventId, j.claim, { decision: 'reply', text: 'Recibido', threadId: 'thread-one' });
    expect(() => s.runtime.finish(s.c, s.instance, j.eventId, j.claim)).toThrow('paused');
    expect(s.runtime.configureForAgent(s.c, s.groupId, true, 'gpt-6.1-sol', true).enabled).toBe(false);
    expect(() => s.runtime.configureForAgent(s.c, s.groupId, true, 'gpt-6.1-sol')).toThrow('Only the owner');
    s.runtime.configureForOwner(s.services.agents.resolveActiveConnection(s.c.connectionId).agent.ownerUserId, s.c.agentId, s.groupId, true);
    s.runtime.finish(s.c, s.instance, j.eventId, j.claim);
  });
  it('no_reply is durable and ACKs without publishing; manual ACK prevents late publication', async () => {
    const s = await setup(); await s.send();
    const a = s.runtime.next(s.c, s.instance, [s.groupId]).job!;
    s.runtime.save(s.c, s.instance, a.eventId, a.claim, { decision: 'no_reply', text: '', threadId: 'thread-one' });
    s.runtime.finish(s.c, s.instance, a.eventId, a.claim);
    expect(s.h.database.sqlite.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 1 });
    await s.send('segundo');
    const b = s.runtime.next(s.c, s.instance, [s.groupId]).job!;
    s.runtime.save(s.c, s.instance, b.eventId, b.claim, { decision: 'reply', text: 'Tarde', threadId: 'thread-one' });
    s.services.inbox.acknowledge({ agentId: s.owner.agentId, eventId: b.eventId });
    expect(s.runtime.finish(s.c, s.instance, b.eventId, b.claim).messageId).toBeNull();
  });
  it('revocation and reduced scopes prevent processing, even after reading the event', async () => {
    const s = await setup(); await s.send();
    expect(() => s.runtime.next({ ...s.c, scopes: ['agent:read'] }, s.instance, [s.groupId])).toThrow();
    const j = s.runtime.next(s.c, s.instance, [s.groupId]).job!;
    const owner = s.services.agents.resolveActiveConnection(s.c.connectionId).agent.ownerUserId;
    s.services.agents.revokeConnection(s.c.connectionId, owner);
    expect(() => s.runtime.save(s.c, s.instance, j.eventId, j.claim, { decision: 'reply', text: 'No', threadId: 'one' })).toThrow();
    expect(s.services.inbox.listPending({ agentId: s.owner.agentId }).events).toHaveLength(1);
  });
  it('an ambiguous turn blocks further generation and the runtime cannot use legacy ACK/send', async () => {
    const s = await setup(); await s.send();
    const j = s.runtime.next(s.c, s.instance, [s.groupId]).job!;
    s.runtime.fail(s.c, s.instance, j.eventId, j.claim);
    await s.send('otro');
    expect(s.runtime.next(s.c, s.instance, [s.groupId]).job?.state).toBe('needs_review');
    const { client, close } = await connect(s.owner.token, s.h);
    try {
      expect((await client.callTool({ name: 'ack_inbox', arguments: { event_id: j.eventId } })).isError).toBe(true);
      expect((await client.callTool({ name: 'send_message', arguments: { group_id: s.groupId, text: 'No', idempotency_key: 'bypass' } })).isError).toBe(true);
    } finally { await close(); }
  });  it('never discloses a revoked group job while preserving the global execution block', async () => {
    const s = await setup(); await s.send('private group input');
    const j = s.runtime.next(s.c, s.instance, [s.groupId]).job!;
    s.runtime.fail(s.c, s.instance, j.eventId, j.claim);
    const created = await call(s.h, s.owner.jar, { method: 'POST', url: GROUP_PATHS.collection, payload: { name: 'Second' } });
    const other = (JSON.parse(created.body) as { group: { id: string } }).group.id;
    await call(s.h, s.owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(other, s.owner.agentId) });
    s.h.database.sqlite.prepare('DELETE FROM group_agent_memberships WHERE group_id=? AND agent_id=?').run(s.groupId, s.c.agentId);
    expect(s.runtime.next(s.c, s.instance, [other])).toEqual({ job: null, blocked: true });
  });
  it('filters removed groups and tracks actual receiver coverage per group', async () => {
    const s = await setup();
    const created = await call(s.h, s.owner.jar, { method: 'POST', url: GROUP_PATHS.collection, payload: { name: 'Second' } });
    const other = (JSON.parse(created.body) as { group: { id: string } }).group.id;
    await call(s.h, s.owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(other, s.owner.agentId) });
    s.runtime.configureForAgent(s.c, other, true, 'gpt-6.1-sol');
    s.runtime.next(s.c, s.instance, [s.groupId]);
    expect(s.runtime.groupConnected(s.c.agentId, other)).toBe(false);
    s.h.database.sqlite.prepare('DELETE FROM group_agent_memberships WHERE group_id=? AND agent_id=?').run(other, s.c.agentId);
    expect(s.runtime.next(s.c, s.instance, [s.groupId, other])).toEqual({ job: null });
  });
  it('owner can recover a revoked idle connection but cannot force an ambiguous claim', async () => {
    const s = await setup(); s.runtime.next(s.c, s.instance, [s.groupId]);
    const old = s.services.agents.resolveActiveConnection(s.c.connectionId);
    const replacementClient = randomUUID();
    s.h.database.sqlite.prepare("INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES(?, 'Recovery', '[]')").run(replacementClient);
    const replacement = s.services.agents.createConnection({ agentId: s.c.agentId, oauthClientId: replacementClient });
    expect(() => s.runtime.recoverForOwner(old.agent.ownerUserId, s.c.agentId, replacement.id, s.instance)).toThrow('Revoke');
    s.services.agents.revokeConnection(s.c.connectionId, old.agent.ownerUserId);
    expect(s.runtime.recoverForOwner(old.agent.ownerUserId, s.c.agentId, replacement.id, s.instance)).toEqual({ recovered: true });
    const credential = { ...s.c, connectionId: replacement.id };
    await s.send(); const j = s.runtime.next(credential, s.instance, [s.groupId]).job!;
    s.runtime.fail(credential, s.instance, j.eventId, j.claim);
    const thirdClient = randomUUID();
    s.h.database.sqlite.prepare("INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES(?, 'Recovery', '[]')").run(thirdClient);
    const third = s.services.agents.createConnection({ agentId: s.c.agentId, oauthClientId: thirdClient });
    s.services.agents.revokeConnection(replacement.id, old.agent.ownerUserId);
    expect(() => s.runtime.recoverForOwner(old.agent.ownerUserId, s.c.agentId, third.id, s.instance)).toThrow('ambiguous');
  });
  it('recovery rejects a malformed UUID with 400 and does not mutate runtime ownership', async () => {
    const s = await setup(); s.runtime.next(s.c, s.instance, [s.groupId]);
    const before = s.h.database.sqlite.prepare('SELECT instance_id,connection_id FROM agent_runtimes WHERE agent_id=?').get(s.c.agentId);
    const response = await call(s.h, s.owner.jar, { method: 'POST', url: `/api/agents/${s.c.agentId}/automation/recover`, payload: { connectionId: s.c.connectionId, instanceId: '0'.repeat(36) } });
    expect(response.statusCode).toBe(400);
    expect(s.h.database.sqlite.prepare('SELECT instance_id,connection_id FROM agent_runtimes WHERE agent_id=?').get(s.c.agentId)).toEqual(before);
  });
  it('a stale long poll cannot claim the next message after the controller restarts', async () => {
    const s = await setup(); const firstController = randomUUID(); const secondController = randomUUID();
    s.runtime.open(s.c, s.instance, firstController);
    expect(s.runtime.next(s.c, s.instance, [s.groupId], firstController)).toEqual({ job: null });
    s.runtime.open(s.c, s.instance, secondController);
    await s.send('after reconnect');
    expect(() => s.runtime.next(s.c, s.instance, [s.groupId], firstController)).toThrow('Controller was replaced');
    expect(s.runtime.next(s.c, s.instance, [s.groupId], secondController).event?.message.text).toBe('after reconnect');
  });
  it('activation cap preserves backlog and exposes the pause reason to the owner', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) {
      await s.send(`message ${i}`); const j = s.runtime.next(s.c, s.instance, [s.groupId]).job!;
      s.runtime.save(s.c, s.instance, j.eventId, j.claim, { decision: 'no_reply', text: '', threadId: 'test-thread' });
      s.runtime.finish(s.c, s.instance, j.eventId, j.claim);
    }
    await s.send('keep pending');
    expect(s.runtime.next(s.c, s.instance, [s.groupId])).toEqual({ job: null, blocked: true });
    const ownerId = s.services.agents.resolveActiveConnection(s.c.connectionId).agent.ownerUserId;
    expect(s.runtime.ownerState(ownerId, s.c.agentId, s.groupId).binding?.lastError).toContain('30 activaciones');
    expect(s.services.inbox.listPending({ agentId: s.c.agentId }).events).toHaveLength(1);
  });
  it('recovers an orphan reservation without inference, but never reuses a consumed start ticket', async () => {
    const s = await setup(); const old = randomUUID(); const fresh = randomUUID();
    s.runtime.open(s.c, s.instance, old); await s.send();
    const reserved = s.runtime.next(s.c, s.instance, [s.groupId], old).job!;
    s.runtime.open(s.c, s.instance, fresh);
    const recovered = s.runtime.next(s.c, s.instance, [s.groupId], fresh);
    expect(recovered.event).toBeDefined(); expect(recovered.job?.eventId).toBe(reserved.eventId);
    expect(() => s.runtime.begin(s.c, s.instance, reserved.eventId, reserved.claim, old)).toThrow('replaced');
    s.runtime.begin(s.c, s.instance, reserved.eventId, reserved.claim, fresh);
    expect(s.runtime.next(s.c, s.instance, [s.groupId], fresh).event).toBeUndefined();
  });
  it('HTTP disconnect cancels a long poll before it can claim a later message', async () => {
    const s = await setup(); const cancel = new AbortController();
    const closed = new Promise<void>((resolve) => s.h.app.server.once('connection', (socket) => socket.once('close', () => resolve())));
    const waiting = fetch(`${s.h.origin}/mcp`, {
      method: 'POST', signal: cancel.signal,
      headers: { authorization: `Bearer ${s.owner.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 111, method: 'tools/call', params: { name: 'runtime_next', arguments: { instance_id: s.instance, group_ids: [s.groupId], wait_ms: 10_000 } } }),
    }).then((response) => response.text());
    // Wait until the server has registered the consumer, then disconnect it.
    await expect.poll(() => s.h.database.sqlite.prepare('SELECT 1 FROM agent_runtimes WHERE agent_id=?').get(s.c.agentId)).toBeDefined();
    cancel.abort(); await expect(waiting).rejects.toThrow(); await closed;
    await s.send('after socket close');
    expect(s.h.database.sqlite.prepare('SELECT count(*) AS n FROM agent_automation_jobs').get()).toEqual({ n: 0 });
    expect(s.runtime.next(s.c, s.instance, [s.groupId]).event?.message.text).toBe('after socket close');
  });

});
