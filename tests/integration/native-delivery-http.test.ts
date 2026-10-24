import { expect, it } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { GROUP_PATHS, MESSAGE_PATHS, nativeResultPayload, nativeProofPayload, type NativeDeliveryView, type NativeTerminalProof } from '@agent-chat/contracts';
import { startHarness, ownerWithAgent, call, connect } from '../helpers/agent-harness';
import { createServices } from '../../apps/server/src/services';
function data<T>(value: unknown): T {
  const result = value as { content: { text: string }[]; isError?: boolean };
  expect(result.isError).toBeUndefined(); return JSON.parse(result.content[0]!.text) as T;
}
it('accepts only signed, content-free reconciliation after OAuth and grant revocation, and preserves manual suppression', async () => {
  const h = await startHarness(); const owner = await ownerWithAgent(h, 'native-proof@example.com', 'Native');
  const current = createServices(h.database);
  const claims = JSON.parse(Buffer.from(owner.token.split('.')[1]!, 'base64url').toString()) as { connection_id: string };
  const group = await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.collection, payload: { name: 'Proof group' } });
  const groupId = group.json().group.id as string;
  await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(groupId, owner.agentId) });
  const keys = generateKeyPairSync('ed25519'); const targetId = randomUUID();
  const ownerId = current.agents.resolveActiveConnection(claims.connection_id).agent.ownerUserId;
  current.nativeAccess.repository.registerTarget({ id: targetId, ownerUserId: ownerId, provider: 'hermes', connectorId: 'fixture', nativeRef: 'fixture', contextMode: 'native_per_group' });
  current.nativeAccess.setProofKey(ownerId, targetId, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  h.database.sqlite.prepare('UPDATE native_runtime_targets SET capabilities_json=? WHERE id=?').run(JSON.stringify({ groupIsolation: 'verified', durableResults: 'verified', approvals: 'verified', toolCatalog: 'verified', nativeVisibility: 'verified' }), targetId);
  const binding = current.nativeAccess.createOwnedBinding(ownerId, { agentId: owner.agentId, targetId, groupIds: [groupId] });
  const challenge = await call(h, owner.jar, { method: 'POST', url: '/api/native/pairings', payload: { kind: 'automatic', connectionId: claims.connection_id, targetId, bindingId: binding.id, revision: 1, scopes: ['native:read','native:claim','native:start','native:complete'] } });
  const client = await connect(owner.token, h);
  try {
    data(await client.client.callTool({ name: 'pair_native', arguments: { challenge: challenge.json().challenge, target_id: targetId, binding_id: binding.id, revision: 1 } }));
    current.nativeDelivery.configureOwner(ownerId, binding.id, 1, true);
    const controllerId = randomUUID(); const { epoch } = data<{ epoch: number }>(await client.client.callTool({ name: 'native_open', arguments: { controllerId } }));
    const cancel = new AbortController();
    const closed = new Promise<void>(resolve => h.app.server.once('request', (_request, response) => response.once('close', () => resolve())));
    const abandoned = fetch(`${h.origin}/mcp`, { method: 'POST', signal: cancel.signal, headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'tools/call', params: { name: 'native_next', arguments: { controllerId, epoch, waitMs: 10000 } } }) }).then(response => response.text()).catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 50)); cancel.abort(); await abandoned; await closed;
    await call(h, owner.jar, { method: 'POST', url: MESSAGE_PATHS.collection(groupId), payload: { text: 'Pending', idempotencyKey: 'pending' } });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(h.database.sqlite.prepare('SELECT count(*) AS n FROM native_deliveries').get()).toEqual({ n: 0 });
    const { delivery: d } = data<{ delivery: NativeDeliveryView }>(await client.client.callTool({ name: 'native_next', arguments: { controllerId, epoch } }));
    data(await client.client.callTool({ name: 'native_begin', arguments: { ticket: d.ticket } }));
    await call(h, owner.jar, { method: 'DELETE', url: `/api/agent-connections/${claims.connection_id}` });
    const suppressed = await call(h, owner.jar, { method: 'POST', url: `/api/native/deliveries/${d.ticket.eventId}/suppress` });
    expect(suppressed.json()).toEqual({ state: 'needs_review', receipt: null });
    const result = { decision: 'reply' as const, text: 'Never publish after suppression', conversationRef: 'native-thread' };
    const body = { eventId: d.ticket.eventId, targetId, startKey: d.startKey, runRef: 'native-run', terminal: 'completed' as const, resultHash: createHash('sha256').update(nativeResultPayload(result)).digest('hex') };
    const proof: NativeTerminalProof = { data: body, signature: sign(null, Buffer.from(nativeProofPayload(body)), keys.privateKey).toString('base64url') };
    const callback = (evidence: NativeTerminalProof) => h.app.inject({ method: 'POST', url: '/native/reconcile', payload: evidence });
    expect((await callback({ ...proof, signature: 'invalid' })).statusCode).toBe(403);
    const complete = await callback(proof); expect(complete.statusCode).toBe(200); expect(complete.json()).toEqual({ reconciled: true, closed: true });
    expect((await callback(proof)).json()).toEqual({ reconciled: true, closed: true });
    const changed = { ...body, resultHash: '0'.repeat(64) };
    expect((await callback({ data: changed, signature: sign(null, Buffer.from(nativeProofPayload(changed)), keys.privateKey).toString('base64url') })).statusCode).toBe(409);
    expect(h.database.sqlite.prepare("SELECT count(*) AS n FROM messages WHERE author_kind='agent'").get()).toEqual({ n: 0 });
  } finally { await client.close(); }
});
