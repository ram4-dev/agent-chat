import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { GROUP_PATHS, MESSAGE_PATHS } from '@agent-chat/contracts';
import { startHarness, ownerWithAgent, call, connect } from '../helpers/agent-harness';

const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.terminate(); });

function receiver(origin: string, token?: string, query = '') {
  const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws/agent${query}`, {
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
  sockets.push(socket);
  return socket;
}

async function setup() {
  const h = await startHarness();
  const owner = await ownerWithAgent(h, 'receiver@example.com', 'Scout');
  const created = await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.collection, payload: { name: 'Live' } });
  const groupId = created.json().group.id as string;
  await call(h, owner.jar, { method: 'POST', url: GROUP_PATHS.agentMember(groupId, owner.agentId) });
  const send = (text: string) => call(h, owner.jar, { method: 'POST', url: MESSAGE_PATHS.collection(groupId), payload: { text, idempotencyKey: text } });
  return { h, owner, groupId, send };
}

it('delivers committed inbox events, without acknowledgement or automatic replies', async () => {
  const { h, owner, groupId, send } = await setup();
  const socket = receiver(h.origin, owner.token);
  const [raw] = await once(socket, 'message');
  expect(JSON.parse(String(raw))).toEqual({ type: 'receiver.ready', agent_id: owner.agentId, connection_id: expect.any(String) });
  const frame = once(socket, 'message');
  await send('Live event');
  const event = JSON.parse(String((await frame)[0]));
  expect(event).toMatchObject({ type: 'inbox.event', group_id: groupId, message: { text: 'Live event', author: { kind: 'human' } } });
  const stored = h.database.sqlite.prepare('SELECT * FROM inbox_events WHERE id = ?').get(event.event_id) as { acknowledged_at: string | null };
  expect(stored.acknowledged_at).toBeNull();
  expect(h.database.sqlite.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 1 });
  const { client, close } = await connect(owner.token, h);
  try {
    const result = await client.callTool({ name: 'get_inbox', arguments: {} });
    expect(JSON.parse(String((result.content as { text: string }[])[0]?.text)).events).toHaveLength(1);
  } finally { await close(); }
  socket.close();
  await once(socket, 'close');
});

it.each([undefined, 'forged'])('rejects %s credentials during upgrade', async (token) => {
  const h = await startHarness();
  const socket = receiver(h.origin, token);
  socket.on('error', () => {});
  const [, response] = await once(socket, 'unexpected-response');
  expect(response.statusCode).toBe(401);
  response.resume();
});

it('rejects query credentials even with a valid header, and requires receive scope', async () => {
  const { h, owner } = await setup();
  const querySocket = receiver(h.origin, owner.token, '?access_token=forbidden');
  querySocket.on('error', () => {});
  const [, queryResponse] = await once(querySocket, 'unexpected-response');
  expect(queryResponse.statusCode).toBe(400);
  queryResponse.resume();
  h.database.sqlite.prepare("UPDATE agent_connections SET scopes = 'agent:read'").run();
  const socket = receiver(h.origin, owner.token);
  socket.on('error', () => {});
  const [, response] = await once(socket, 'unexpected-response');
  expect(response.statusCode).toBe(403);
  response.resume();
});

it('caps concurrent receivers per connection and releases slots on disconnect', async () => {
  const { h, owner } = await setup();
  const first = receiver(h.origin, owner.token);
  await once(first, 'message');
  const second = receiver(h.origin, owner.token);
  await once(second, 'message');
  const excess = receiver(h.origin, owner.token);
  excess.on('error', () => {});
  const [, response] = await once(excess, 'unexpected-response');
  expect(response.statusCode).toBe(429);
  response.resume();
  first.close(); await once(first, 'close');
  const replacement = receiver(h.origin, owner.token);
  expect(JSON.parse(String((await once(replacement, 'message'))[0])).type).toBe('receiver.ready');
});

it('reauthorizes delivery after membership removal and credential revocation', async () => {
  const { h, owner, groupId, send } = await setup();
  const socket = receiver(h.origin, owner.token);
  await once(socket, 'message');
  const frames: string[] = [];
  socket.on('message', (raw) => frames.push(String(raw)));
  await call(h, owner.jar, { method: 'DELETE', url: GROUP_PATHS.agentMember(groupId, owner.agentId) });
  await send('Private after removal');
  // Protocol ping/pong provides a transport barrier after the attempted delivery.
  socket.ping(); await once(socket, 'pong');
  expect(frames).toEqual([]);
  h.database.sqlite.prepare("UPDATE agent_connections SET revoked_at = ?").run(new Date().toISOString());
  const closed = once(socket, 'close');
  await send('Revoked');
  expect((await closed)[0]).toBe(4401);
});

it('refuses inbound application commands on the receive-only socket', async () => {
  const { h, owner } = await setup();
  const socket = receiver(h.origin, owner.token);
  await once(socket, 'message');
  socket.send(JSON.stringify({ type: 'send_message', text: 'not allowed' }));
  expect((await once(socket, 'close'))[0]).toBe(4400);
  expect(h.database.sqlite.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 });
});

it('exposes receiver state only inside an authorized group', async () => {
  const { h, owner, groupId } = await setup();
  const detail = () => call(h, owner.jar, { method: 'GET', url: GROUP_PATHS.one(groupId) });
  expect((await detail()).json().members.find((m: { kind: string }) => m.kind === 'agent').receiverConnected).toBe(false);
  const socket = receiver(h.origin, owner.token);
  await once(socket, 'message');
  expect((await detail()).json().members.find((m: { kind: string }) => m.kind === 'agent').receiverConnected).toBe(true);
  socket.close(); await once(socket, 'close');
  await expect.poll(async () => (await detail()).json().members.find((m: { kind: string }) => m.kind === 'agent').receiverConnected).toBe(false);
});
