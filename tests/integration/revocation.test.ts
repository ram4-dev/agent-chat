import { once } from 'node:events';
import { expect, it } from 'vitest';
import WebSocket from 'ws';
import { GROUP_PATHS, MESSAGE_PATHS } from '@agent-chat/contracts';
import { agentToken, call, connect, startHarness } from '../helpers/agent-harness';

async function setup() {
  const h = await startHarness();
  const owner = await agentToken(h, 'revoke@example.com', 'Scout');
  const { client, close } = await connect(owner.token, h);
  const identity = await client.callTool({ name: 'get_identity', arguments: {} });
  const detail = JSON.parse((identity.content as { text: string }[])[0]!.text) as { agent: { id: string }; connection: { id: string } };
  const group = await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.collection, payload: { name: 'History' } });
  const groupId = group.json().group.id as string;
  await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(groupId, detail.agent.id) });
  return { h, owner, client, close, agentId: detail.agent.id, connectionId: detail.connection.id, groupId };
}

it.each(['connection', 'agent'])('revokes a %s immediately, preserving history and bounded audit data', async (kind) => {
  const { h, owner, client, close, agentId, connectionId, groupId } = await setup();
  const socket = new WebSocket(`${h.origin.replace('http', 'ws')}/ws/agent`, { headers: { authorization: `Bearer ${owner.token}` } });
  try {
    await once(socket, 'message');
    await client.callTool({ name: 'send_message', arguments: { group_id: groupId, text: 'Historical body stays private', idempotency_key: 'before' } });
    const closed = once(socket, 'close');
    const revoked = await call(h, owner.jar, { method: 'DELETE', url: kind === 'connection' ? `/api/agent-connections/${connectionId}` : `/api/agents/${agentId}` });
    expect(revoked.statusCode).toBe(200);
    expect((await closed)[0]).toBe(4401);
    for (const name of ['get_identity', 'read_messages', 'send_message', 'get_inbox', 'ack_inbox']) {
      await expect(client.callTool({ name, arguments: { group_id: groupId, text: 'blocked', idempotency_key: 'after', event_id: 'any' } })).rejects.toThrow('unauthenticated');
    }
    const refresh = await call(h, owner.jar, { method: 'POST', url: '/token', payload: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: owner.refreshToken, client_id: owner.clientId }).toString() });
    expect(refresh.statusCode).toBe(400);
    expect(refresh.json().error).toBe('invalid_grant');
    const history = await call(h, owner.jar, { method: 'GET', url: MESSAGE_PATHS.collection(groupId) });
    expect(history.json().messages[0]).toMatchObject({ text: 'Historical body stays private', author: { kind: 'agent', id: agentId, displayName: 'Scout', ownerDisplayName: 'Owner' } });
    const audit = h.database.sqlite.prepare('SELECT * FROM audit_events').all();
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: `${kind}.revoked`, outcome: 'allowed' })]));
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain('Historical body');
    expect(serialized).not.toContain(owner.token);
    expect(serialized).not.toContain(owner.refreshToken);
    expect(serialized).not.toContain(owner.jar.header());
  } finally { socket.terminate(); await close(); }
});

it('does not reveal or revoke another owner\'s agent or connection', async () => {
  const { h, client, close, agentId, connectionId } = await setup();
  try {
    const other = await agentToken(h, 'other@example.com', 'Other');
    for (const url of [`/api/agents/${agentId}`, `/api/agents/${agentId}/connections`, `/api/agent-connections/${connectionId}`]) {
      const response = await call(h, other.jar, { method: url.endsWith('/connections') ? 'GET' : 'DELETE', url });
      expect(response.statusCode).toBe(404);
    }
    const identity = await client.callTool({ name: 'get_identity', arguments: {} });
    expect(identity.isError).toBeUndefined();
  } finally { await close(); }
});

it('rotates hashed refresh tokens and revokes the connection on reuse', async () => {
  const { h, owner, client, close, connectionId } = await setup();
  try {
    const refresh = (token: string) => call(h, owner.jar, { method: 'POST', url: '/token', payload: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: owner.clientId }).toString() });
    const rotated = await refresh(owner.refreshToken);
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json().refresh_token as string;
    expect(next).not.toBe(owner.refreshToken);
    const stored = JSON.stringify(h.database.sqlite.prepare('SELECT * FROM oidc_artifacts').all());
    expect(stored.includes(owner.refreshToken)).toBe(false);
    expect(stored.includes(next)).toBe(false);
    const reused = await refresh(owner.refreshToken);
    expect(reused.statusCode).toBe(400);
    expect(h.database.sqlite.prepare('SELECT revoked_at FROM agent_connections WHERE id = ?').get(connectionId)).toEqual({ revoked_at: expect.any(String) });
    expect((await refresh(next)).statusCode).toBe(400);
    await expect(client.callTool({ name: 'get_identity', arguments: {} })).rejects.toThrow('unauthenticated');
  } finally { await close(); }
});

it('rolls back message and inbox if its audit write fails', async () => {
  const { h, owner, close, groupId } = await setup();
  try {
    h.database.sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    const sent = await call(h, owner.jar, { method: 'POST', url: MESSAGE_PATHS.collection(groupId), payload: { text: 'Must roll back', idempotencyKey: 'audit-failure' } });
    expect(sent.statusCode).toBe(500);
    expect(h.database.sqlite.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 });
    expect(h.database.sqlite.prepare('SELECT count(*) AS n FROM inbox_events').get()).toEqual({ n: 0 });
  } finally { await close(); }
});

it('rejects concurrent refresh reuse and leaves no usable agent credential', async () => {
  const { h, owner, client, close, connectionId } = await setup();
  try {
    const request = () => call(h, owner.jar, { method: 'POST', url: '/token', payload: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: owner.refreshToken, client_id: owner.clientId }).toString() });
    const results = await Promise.all([request(), request()]);
    expect(results.filter((r) => r.statusCode === 200).length).toBeLessThanOrEqual(1);
    expect(results.some((r) => r.statusCode === 400)).toBe(true);
    expect(h.database.sqlite.prepare('SELECT revoked_at FROM agent_connections WHERE id = ?').get(connectionId)).toEqual({ revoked_at: expect.any(String) });
    await expect(client.callTool({ name: 'get_identity', arguments: {} })).rejects.toThrow('unauthenticated');
  } finally { await close(); }
});

it('revocation is atomic with its audit record', async () => {
  const { h, owner, close, client, connectionId } = await setup();
  try {
    h.database.sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    expect((await call(h, owner.jar, { method: 'DELETE', url: `/api/agent-connections/${connectionId}` })).statusCode).toBe(500);
    expect(h.database.sqlite.prepare('SELECT revoked_at FROM agent_connections WHERE id = ?').get(connectionId)).toEqual({ revoked_at: null });
    expect((await client.callTool({ name: 'get_identity', arguments: {} })).isError).toBeUndefined();
  } finally { await close(); }
});

it('keeps owner-approved agent access independent of the browser session', async () => {
  const { h, owner, close } = await setup();
  try {
    h.database.sqlite.prepare("DELETE FROM oidc_artifacts WHERE model = 'Session'").run();
    const refreshed = await call(h, owner.jar, { method: 'POST', url: '/token', payload: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: owner.refreshToken, client_id: owner.clientId }).toString() });
    expect(refreshed.statusCode).toBe(200);
  } finally { await close(); }
});
