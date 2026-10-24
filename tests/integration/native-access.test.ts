import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { expect, it } from 'vitest';
import { GROUP_PATHS, MESSAGE_PATHS, type NativeConsent, type NativeGrant } from '@agent-chat/contracts';
import { startHarness, ownerWithAgent, call, connect, type Harness, type CookieJar } from '../helpers/agent-harness';
import { createNativeRuntimeRepository } from '../../apps/server/src/persistence/native-runtime-repository';
import { parseRequestedScopes } from '../../apps/server/src/modules/agents/contracts';

function data<T>(result: unknown): T {
  const value = result as { isError?: boolean; content: { text: string }[] };
  expect(value.isError).toBeUndefined();
  return JSON.parse(value.content[0]!.text) as T;
}
async function setup() {
  const h = await startHarness();
  const owner = await ownerWithAgent(h, 'native-access@example.com', 'Native');
  const claims = JSON.parse(Buffer.from(owner.token.split('.')[1]!, 'base64url').toString()) as { connection_id: string };
  const groups: string[] = [];
  for (const name of ['A', 'B']) {
    const created = await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.collection, payload: { name } });
    const id = created.json().group.id as string;
    await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(id, owner.agentId) });
    groups.push(id);
  }
  const targetResponse = await call(h, owner.jar, { method: 'POST', url: '/api/native/targets', payload: {
    provider: 'hermes', connectorId: 'local-host', nativeRef: 'profile-one', contextMode: 'native_per_group',
  } });
  expect(targetResponse.statusCode).toBe(201);
  const targetId = targetResponse.json().target.id as string;
  const bindingResponse = await call(h, owner.jar, { method: 'POST', url: '/api/native/bindings', payload: { agentId: owner.agentId, targetId, groupIds: groups } });
  expect(bindingResponse.statusCode).toBe(201);
  const bindingId = bindingResponse.json().binding.id as string;
  const interactive: NativeConsent = { kind: 'interactive', connectionId: claims.connection_id, scopes: ['native:read', 'native:send'], selections: [{ agentId: owner.agentId, groupIds: [groups[0]!] }] };
  const automatic: NativeConsent = { kind: 'automatic', connectionId: claims.connection_id, scopes: ['native:read', 'native:claim', 'native:start', 'native:complete'], bindingId, revision: 1, targetId };
  const challenge = async (consent: NativeConsent = interactive) => {
    const response = await call(h, owner.jar, { method: 'POST', url: '/api/native/pairings', payload: consent });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; challenge: string; expiresAt: number };
  };
  const client = await connect(owner.token, h);
  const pair = (secret: string, expected = {}) => client.client.callTool({ name: 'pair_native', arguments: { challenge: secret, ...expected } });
  return { h, owner, groupA: groups[0]!, groupB: groups[1]!, connectionId: claims.connection_id, targetId, bindingId, interactive, automatic, challenge, client, pair };
}
async function patch(h: Harness, jar: CookieJar, id: string, payload: unknown) {
  return h.app.inject({ method: 'PATCH', url: `/api/native/grants/${id}`, headers: { cookie: jar.header()!, origin: h.origin, host: new URL(h.origin).host }, payload: payload as object });
}
async function socketRejected(h: Harness, token: string) {
  const socket = new WebSocket(`${h.origin.replace('http', 'ws')}/ws/agent`, { headers: { authorization: `Bearer ${token}` } });
  socket.on('error', () => {});
  const [, response] = await once(socket, 'unexpected-response');
  expect(response.statusCode).toBe(403); response.resume(); socket.terminate();
}

it('keeps native scopes outside legacy OAuth defaults and rejects unconsented scope requests', () => {
  expect(parseRequestedScopes(undefined)).toEqual({ ok: true, value: ['agent:read', 'agent:send', 'agent:inbox', 'agent:receive'] });
  expect(parseRequestedScopes('native:send').ok).toBe(false);
});
it('requires owner consent and a fresh connection-bound, unexpired single-use challenge', async () => {
  const s = await setup();
  try {
    const anonymous = await s.h.app.inject({ method: 'POST', url: '/api/native/pairings', headers: { origin: s.h.origin, host: new URL(s.h.origin).host }, payload: s.interactive });
    expect(anonymous.statusCode).toBe(401);
    const other = await ownerWithAgent(s.h, 'other-native@example.com', 'Other');
    const wrongOwner = await call(s.h, other.jar, { method: 'POST', url: '/api/native/pairings', payload: s.interactive });
    expect(wrongOwner.statusCode).toBe(403);
    const expired = await s.challenge();
    s.h.database.sqlite.prepare('UPDATE native_pairing_challenges SET expires_at=0 WHERE id=?').run(expired.id);
    expect((await s.pair(expired.challenge)).isError).toBe(true);
    const valid = await s.challenge();
    const otherClient = await connect(other.token, s.h);
    try { expect((await otherClient.client.callTool({ name: 'pair_native', arguments: { challenge: valid.challenge } })).isError).toBe(true); }
    finally { await otherClient.close(); }
    expect(s.h.database.sqlite.prepare('SELECT consumed_at FROM native_pairing_challenges WHERE id=?').get(valid.id)).toEqual({ consumed_at: null });
    data(await s.pair(valid.challenge));
    expect((await s.pair(valid.challenge)).isError).toBe(true);
    expect(s.h.database.sqlite.prepare('SELECT count(*) AS n FROM native_connection_grants').get()).toEqual({ n: 1 });
  } finally { await s.client.close(); }
});
it('requires explicit interactive identity, scopes and group; audits publication without ACK', async () => {
  const s = await setup();
  try {
    await call(s.h, s.owner.jar, { method: 'POST', url: MESSAGE_PATHS.collection(s.groupA), payload: { text: 'Pending', idempotencyKey: 'pending' } });
    const event = s.h.database.sqlite.prepare('SELECT id FROM inbox_events WHERE agent_id=?').get(s.owner.agentId) as { id: string };
    // A paused native binding also protects its inbox from legacy ACK.
    expect((await s.client.client.callTool({ name: 'ack_inbox', arguments: { event_id: event.id } })).isError).toBe(true);
    data(await s.pair((await s.challenge()).challenge));
    for (const args of [
      { group_id: s.groupA }, { as_agent_id: randomUUID(), group_id: s.groupA }, { as_agent_id: s.owner.agentId, group_id: s.groupB },
    ]) expect((await s.client.client.callTool({ name: 'send_message', arguments: { ...args, text: 'Denied', idempotency_key: randomUUID() } })).isError).toBe(true);
    data(await s.client.client.callTool({ name: 'send_message', arguments: { as_agent_id: s.owner.agentId, group_id: s.groupA, text: 'Explicit identity', idempotency_key: 'explicit' } }));
    expect(s.h.database.sqlite.prepare('SELECT acknowledged_at FROM inbox_events WHERE id=?').get(event.id)).toEqual({ acknowledged_at: null });
    expect(s.h.database.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='native.interactive.sent'").get()).toEqual({ n: 1 });
    expect((await s.client.client.callTool({ name: 'get_inbox', arguments: {} })).isError).toBe(true);
    const groups = data<{ groups: { id: string }[] }>(await s.client.client.callTool({ name: 'list_groups', arguments: { as_agent_id: s.owner.agentId } }));
    expect(groups.groups.map(g => g.id)).toEqual([s.groupA]);
  } finally { await s.client.close(); }
});
it('rechecks interactive scope reductions, memberships, revocation and never falls back to legacy', async () => {
  const s = await setup();
  try {
    const { grant } = data<{ grant: NativeGrant }>(await s.pair((await s.challenge()).challenge));
    expect((await patch(s.h, s.owner.jar, grant.id, { scopes: ['native:claim'], selections: grant.selections })).statusCode).toBe(403);
    expect((await patch(s.h, s.owner.jar, grant.id, { scopes: ['native:read'], selections: grant.selections })).statusCode).toBe(200);
    expect((await s.client.client.callTool({ name: 'send_message', arguments: { as_agent_id: s.owner.agentId, group_id: s.groupA, text: 'Denied', idempotency_key: 'reduced' } })).isError).toBe(true);
    await call(s.h, s.owner.jar, { method: 'DELETE', url: GROUP_PATHS.agentMember(s.groupA, s.owner.agentId) });
    expect((await s.client.client.callTool({ name: 'read_messages', arguments: { as_agent_id: s.owner.agentId, group_id: s.groupA } })).isError).toBe(true);
    await call(s.h, s.owner.jar, { method: 'DELETE', url: `/api/native/grants/${grant.id}` });
    expect((await s.client.client.callTool({ name: 'get_identity', arguments: {} })).isError).toBe(true);
    expect((await s.client.client.callTool({ name: 'ack_inbox', arguments: { event_id: randomUUID() } })).isError).toBe(true);
    await socketRejected(s.h, s.owner.token);
  } finally { await s.client.close(); }
});
it('binds automatic pairing to the exact target/revision and blocks old grants after a revision change', async () => {
  const s = await setup();
  try {
    const challenge = await s.challenge(s.automatic);
    expect((await s.pair(challenge.challenge, { binding_id: s.bindingId, revision: 1, target_id: randomUUID() })).isError).toBe(true);
    const { grant } = data<{ grant: NativeGrant }>(await s.pair(challenge.challenge, { binding_id: s.bindingId, revision: 1, target_id: s.targetId }));
    expect(grant.kind).toBe('automatic');
    expect((await s.client.client.callTool({ name: 'send_message', arguments: { as_agent_id: s.owner.agentId, group_id: s.groupA, text: 'No legacy send', idempotency_key: 'auto-denied' } })).isError).toBe(true);
    expect((await s.client.client.callTool({ name: 'configure_runtime', arguments: { group_id: s.groupA, enabled: true, model: 'gpt-6.1-sol' } })).isError).toBe(true);
    await socketRejected(s.h, s.owner.token);
    createNativeRuntimeRepository(s.h.database.sqlite).replaceVersion({ ownerUserId: grant.ownerUserId, bindingId: s.bindingId, expectedRevision: 1, targetId: s.targetId, groupIds: [s.groupA] });
    expect((await s.client.client.callTool({ name: 'read_messages', arguments: { as_agent_id: s.owner.agentId, group_id: s.groupA } })).isError).toBe(true);
    await socketRejected(s.h, s.owner.token);
  } finally { await s.client.close(); }
});
it('invalidates a pending challenge when binding revision changes before pairing', async () => {
  const s = await setup();
  try {
    const challenge = await s.challenge(s.automatic);
    const binding = s.h.database.sqlite.prepare('SELECT owner_user_id FROM native_bindings WHERE id=?').get(s.bindingId) as { owner_user_id: string };
    createNativeRuntimeRepository(s.h.database.sqlite).replaceVersion({ ownerUserId: binding.owner_user_id, bindingId: s.bindingId, expectedRevision: 1, targetId: s.targetId, groupIds: [s.groupA] });
    expect((await s.pair(challenge.challenge, { binding_id: s.bindingId, revision: 1, target_id: s.targetId })).isError).toBe(true);
    expect(s.h.database.sqlite.prepare('SELECT count(*) AS n FROM native_connection_grants').get()).toEqual({ n: 0 });
  } finally { await s.client.close(); }
});
it('closes an already open legacy WebSocket on classification and rejects new sockets for either native class', async () => {
  const s = await setup();
  const socket = new WebSocket(`${s.h.origin.replace('http', 'ws')}/ws/agent`, { headers: { authorization: `Bearer ${s.owner.token}` } });
  try {
    const [ready] = await once(socket, 'message'); expect(JSON.parse(String(ready)).type).toBe('receiver.ready');
    const closed = once(socket, 'close');
    data(await s.pair((await s.challenge()).challenge));
    expect((await closed)[0]).toBe(4401);
    await socketRejected(s.h, s.owner.token);
    await call(s.h, s.owner.jar, { method: 'POST', url: MESSAGE_PATHS.collection(s.groupB), payload: { text: 'Never on native socket', idempotencyKey: 'no-socket' } });
  } finally { socket.terminate(); await s.client.close(); }
});
it('selects between explicitly granted identities and rejects expanding the identity/group matrix', async () => {
  const s = await setup();
  try {
    const second = await call(s.h, s.owner.jar, { method: 'POST', url: '/api/agents', payload: { name: 'Second identity' } });
    const secondId = second.json().agent.id as string;
    await call(s.h, s.owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(s.groupA, secondId) });
    const consent: NativeConsent = { ...s.interactive, kind: 'interactive', selections: [{ agentId: s.owner.agentId, groupIds: [s.groupA] }, { agentId: secondId, groupIds: [s.groupA] }] };
    const { grant } = data<{ grant: NativeGrant }>(await s.pair((await s.challenge(consent)).challenge));
    const { identities } = data<{ identities: { agentId: string }[] }>(await s.client.client.callTool({ name: 'get_identity', arguments: {} }));
    expect(identities.map(identity => identity.agentId)).toEqual([s.owner.agentId, secondId]);
    const sent = data<{ message: { author: { id: string } } }>(await s.client.client.callTool({ name: 'send_message', arguments: { as_agent_id: secondId, group_id: s.groupA, text: 'Second identity output', idempotency_key: 'second-identity' } }));
    expect(sent.message.author.id).toBe(secondId);
    expect((await patch(s.h, s.owner.jar, grant.id, { scopes: grant.scopes, selections: [{ agentId: secondId, groupIds: [s.groupB] }] })).statusCode).toBe(403);
    expect((await patch(s.h, s.owner.jar, grant.id, { scopes: grant.scopes, selections: [] })).statusCode).toBe(200);
    expect((await s.client.client.callTool({ name: 'read_messages', arguments: { as_agent_id: secondId, group_id: s.groupA } })).isError).toBe(true);
  } finally { await s.client.close(); }
});
it('keeps the legacy runtime out of a native binding, including its owner configuration path', async () => {
  const s = await setup();
  try {
    expect((await s.client.client.callTool({ name: 'configure_runtime', arguments: { group_id: s.groupA, enabled: true, model: 'gpt-6.1-sol' } })).isError).toBe(true);
    expect((await s.client.client.callTool({ name: 'runtime_next', arguments: { instance_id: randomUUID(), group_ids: [s.groupA] } })).isError).toBe(true);
    const response = await s.h.app.inject({ method: 'PATCH', url: `/api/agents/${s.owner.agentId}/automation/${s.groupA}`, headers: { cookie: s.owner.jar.header()!, origin: s.h.origin, host: new URL(s.h.origin).host }, payload: { enabled: true } });
    expect(response.statusCode).toBe(409);
    expect(s.h.database.sqlite.prepare('SELECT count(*) AS n FROM agent_automation_jobs').get()).toEqual({ n: 0 });
  } finally { await s.client.close(); }
});
it('requires pausing the legacy receiver before creating a native binding', async () => {
  const s = await setup();
  try {
    const created = await call(s.h, s.owner.jar, { method: 'POST', url: '/api/agents', payload: { name: 'Legacy first' } });
    const agentId = created.json().agent.id as string;
    await call(s.h, s.owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(s.groupA, agentId) });
    const configure = (enabled: boolean) => s.h.app.inject({ method: 'PATCH', url: `/api/agents/${agentId}/automation/${s.groupA}`, headers: { cookie: s.owner.jar.header()!, origin: s.h.origin, host: new URL(s.h.origin).host }, payload: { enabled } });
    expect((await configure(true)).statusCode).toBe(200);
    const payload = { agentId, targetId: s.targetId, groupIds: [s.groupA] };
    expect((await call(s.h, s.owner.jar, { method: 'POST', url: '/api/native/bindings', payload })).statusCode).toBe(409);
    expect((await configure(false)).statusCode).toBe(200);
    expect((await call(s.h, s.owner.jar, { method: 'POST', url: '/api/native/bindings', payload })).statusCode).toBe(201);
  } finally { await s.client.close(); }
});
it('does not reclassify the credential of a legacy runtime controller', async () => {
  const h = await startHarness();
  const owner = await ownerWithAgent(h, 'legacy-pairing@example.com', 'Legacy runtime');
  const group = await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.collection, payload: { name: 'Legacy group' } });
  const groupId = group.json().group.id as string;
  await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(groupId, owner.agentId) });
  const connectionId = (JSON.parse(Buffer.from(owner.token.split('.')[1]!, 'base64url').toString()) as { connection_id: string }).connection_id;
  const client = await connect(owner.token, h);
  try {
    data(await client.client.callTool({ name: 'runtime_open', arguments: { instance_id: randomUUID(), controller_id: randomUUID() } }));
    const response = await call(h, owner.jar, { method: 'POST', url: '/api/native/pairings', payload: { kind: 'interactive', connectionId, scopes: ['native:read'], selections: [{ agentId: owner.agentId, groupIds: [groupId] }] } });
    expect(response.statusCode).toBe(409);
    expect(h.database.sqlite.prepare('SELECT count(*) AS n FROM native_connection_grants').get()).toEqual({ n: 0 });
    data(await client.client.callTool({ name: 'get_identity', arguments: {} }));
  } finally { await client.close(); }
});
