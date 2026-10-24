import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { SignJWT, importJWK } from 'jose';
import { readConfig } from '../../apps/server/src/config/env';
import { createManagedApp } from '../../apps/server/src/managed/runtime';
import { ManagedDatabase } from '../../apps/server/src/managed/database';
import { createManagedServices } from '../../apps/server/src/managed/services';
import { createManagedOAuthStore } from '../../apps/server/src/managed/oauth-store';
import { AGENT_SCOPES } from '../../apps/server/src/modules/agents';

const config = readConfig({ env: { ...process.env, LOG_LEVEL: 'silent', NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://127.0.0.1:4319' }, repoRoot: process.cwd() });
if (!config.managed || !['127.0.0.1', 'localhost'].includes(new URL(config.managed.databaseUrl).hostname)) {
  throw new Error('Managed integration tests require the disposable local Supabase environment.');
}
const db = new ManagedDatabase(config.managed.databaseUrl);
const services = createManagedServices(db, { url: config.managed.supabaseUrl, anonKey: config.managed.supabaseAnonKey, publicOrigin: config.publicOrigin });
let app1: Awaited<ReturnType<typeof createManagedApp>>;
let app2: typeof app1;
let first: string;
let second: string;
const sockets = new Set<WebSocket>();

beforeAll(async () => {
  app1 = await createManagedApp(config);
  app2 = await createManagedApp(config);
  first = await app1.listen({ host: '127.0.0.1', port: 0 });
  second = await app2.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  await Promise.all([app1?.close(), app2?.close()]);
  await db.close();
});

async function account() {
  return services.auth.register({ email: `managed-${randomUUID()}@example.com`, password: 'managed-test-password-strong', displayName: 'Managed QA' });
}
async function post(origin: string, path: string, cookie: string, body: object) {
  return fetch(`${origin}${path}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function agentFixture() {
  const owner = await account();
  const { group } = await services.groups.createGroup({ userId: owner.user.id, name: 'Distributed QA' });
  const agent = await services.agents.createAgent({ ownerUserId: owner.user.id, name: 'Distributed agent' });
  const client = randomUUID();
  await db.rows("INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES($1,'QA client','[]')", [client]);
  const connection = await services.agents.createConnection({ agentId: agent.id, oauthClientId: client });
  await services.groups.admitAgent({ userId: owner.user.id, groupId: group.id, agentId: agent.id });
  const key = await importJWK(config.managed!.jwks.keys[0]!, 'EdDSA');
  const token = await new SignJWT({ agent_id: agent.id, connection_id: connection.id, scope: AGENT_SCOPES.join(' ') })
    .setProtectedHeader({ alg: 'EdDSA', kid: config.managed!.jwks.keys[0]!.kid }).setIssuer(config.publicOrigin).setAudience(config.publicOrigin).setIssuedAt().setExpirationTime('10m').sign(key);
  return { owner, group, agent, connection, token, cookie: `agent_chat_session=${owner.sessionToken}` };
}
function open(origin: string, path: string, headers: Record<string, string>) {
  const socket = new WebSocket(origin.replace('http', 'ws') + path, { headers });
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  return socket;
}
function frame(socket: WebSocket, type: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Missing ${type} frame`)); }, 8000);
    const receive = (raw: Buffer) => {
      const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (parsed['type'] === type) { cleanup(); resolve(parsed); }
    };
    const error = () => { cleanup(); reject(new Error('Socket transport failed')); };
    function cleanup() { clearTimeout(timer); socket.off('message', receive); socket.off('error', error); }
    socket.on('message', receive); socket.once('error', error);
  });
}

it('shares sessions and delivers a committed message to a browser on another instance', async () => {
  const f = await agentFixture();
  const browser = open(second, '/ws/browser', { origin: second, cookie: f.cookie });
  await frame(browser, 'ready');
  const incoming = frame(browser, 'message.created');
  const response = await post(first, `/api/groups/${f.group.id}/messages`, f.cookie, { text: 'Across instances', idempotencyKey: randomUUID() });
  expect(response.status).toBe(201);
  expect((await incoming)['message']).toMatchObject({ text: 'Across instances', author: { id: f.owner.user.id } });
  browser.close();
});

it('commits one message and one inbox event under retries across instances', async () => {
  const f = await agentFixture();
  const key = randomUUID();
  const responses = await Promise.all(Array.from({ length: 8 }, (_, n) => post(n % 2 ? first : second, `/api/groups/${f.group.id}/messages`, f.cookie, { text: 'Only once', idempotencyKey: key })));
  expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
  const messages = await services.messaging.list({ author: { kind: 'human', id: f.owner.user.id }, groupId: f.group.id, limit: 100 });
  expect(messages.messages).toHaveLength(1);
  expect((await services.inbox.listPending({ agentId: f.agent.id })).events).toHaveLength(1);
  const conflict = await post(second, `/api/groups/${f.group.id}/messages`, f.cookie, { text: 'Different', idempotencyKey: key });
  expect(conflict.status).toBe(409);
});

it('revocation denies new MCP calls and closes an idle receiver on another instance', async () => {
  const f = await agentFixture();
  const receiver = open(second, '/ws/agent', { authorization: `Bearer ${f.token}` });
  await frame(receiver, 'receiver.ready');
  const closed = once(receiver, 'close');
  await services.agents.revokeConnection(f.connection.id, f.owner.user.id);
  const refused = await fetch(`${second}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expect(refused.status).toBe(401);
  expect((await closed)[0]).toBe(4401);
});

it('enforces receiver capacity across instances and releases slots', async () => {
  const f = await agentFixture();
  const a = open(first, '/ws/agent', { authorization: `Bearer ${f.token}` }); await frame(a, 'receiver.ready');
  const b = open(second, '/ws/agent', { authorization: `Bearer ${f.token}` }); await frame(b, 'receiver.ready');
  const c = open(first, '/ws/agent', { authorization: `Bearer ${f.token}` });
  const rejected = await new Promise<number>((resolve) => { c.once('unexpected-response', (_req, response) => { response.resume(); c.terminate(); resolve(response.statusCode!); }); c.on('error', () => {}); });
  expect(rejected).toBe(429);
  a.close(); b.close();
});

it('keeps provider artifacts shared, hashed and single-use under concurrent redemption', async () => {
  const f = await agentFixture();
  const store = createManagedOAuthStore(db);
  let reuse = 0;
  const adapter = store.adapterFactory(async () => { reuse++; })('RefreshToken') as {
    upsert(id: string, payload: Record<string, unknown>, expiry: number): Promise<void>;
    find(id: string): Promise<Record<string, unknown> | undefined>;
    consume(id: string): Promise<void>;
  };
  const id = randomUUID();
  await adapter.upsert(id, { jti: id, grantId: f.connection.id, iat: Math.floor(Date.now() / 1000) }, 600);
  expect(await db.one('SELECT id FROM oidc_artifacts WHERE id=$1', [id])).toBeUndefined();
  expect(await adapter.find(id)).toMatchObject({ jti: id });
  const results = await Promise.allSettled([adapter.consume(id), adapter.consume(id)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(reuse).toBe(1);
});

it('does not grant REST/database access to anon or human Auth JWT roles', async () => {
  await expect(db.transaction(async () => {
    await db.rows('SET LOCAL ROLE anon');
    await db.rows('SELECT id FROM agent_chat.messages');
  })).rejects.toMatchObject({ code: '42501' });
  await expect(db.transaction(async () => {
    await db.rows('SET LOCAL ROLE authenticated');
    await db.rows('SELECT id FROM agent_chat.agent_connections');
  })).rejects.toMatchObject({ code: '42501' });
});

it('rolls back message, idempotency and inbox when the real audit insert fails', async () => {
  const f = await agentFixture();
  await db.rows(`CREATE FUNCTION agent_chat.test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF current_setting('agent_chat.fail_audit',true)='on' THEN RAISE EXCEPTION 'test audit fault'; END IF; RETURN NEW; END $$`);
  await db.rows('CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION agent_chat.test_audit_failure()');
  try {
    await expect(db.transaction(async () => {
      await db.rows("SET LOCAL agent_chat.fail_audit='on'");
      await services.messaging.send({ author: { kind: 'human', id: f.owner.user.id }, groupId: f.group.id, text: 'Must roll back', idempotencyKey: randomUUID() });
    })).rejects.toThrow('test audit fault');
    expect(await db.rows('SELECT id FROM messages WHERE group_id=$1', [f.group.id])).toHaveLength(0);
    expect(await db.rows('SELECT id FROM inbox_events WHERE group_id=$1', [f.group.id])).toHaveLength(0);
    expect(await db.rows('SELECT message_id FROM message_idempotency WHERE human_author_id=$1', [f.owner.user.id])).toHaveLength(0);
  } finally {
    await db.rows('DROP TRIGGER test_audit_failure ON audit_events');
    await db.rows('DROP FUNCTION agent_chat.test_audit_failure()');
  }
});
