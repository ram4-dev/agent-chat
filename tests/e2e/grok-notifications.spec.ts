import type { ChildProcess } from 'node:child_process';
import { child, stop } from '../helpers/native-process';
import { createInterface } from 'node:readline';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createDatabase } from '../../apps/server/src/persistence/client';
import { authorizeAgent, mcpClient, payload } from './helpers/agent';
import { signUp, createGroup, addAgent, send, agents, selectGroup } from './helpers/ui';

test('Grok wake-up from the browser waits for callback, survives restart and lost replies, and publishes only once', async ({ page }) => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), 'grok-notifications-e2e-'));
  const children: ChildProcess[] = [];
  let client: Awaited<ReturnType<typeof mcpClient>> | undefined;
  const serverDb = join(root, 'server.db'); const providerDb = join(root, 'provider.db');
  try {
    const oidcKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    await writeFile(join(root, 'oidc-jwks.json'), JSON.stringify({ keys: [{ ...oidcKey, alg: 'EdDSA', use: 'sig', kid: 'fixture' }] }), { mode: 0o600 });
    const server = child('portless', [`native-delivery-${randomUUID().slice(0,8)}`, process.execPath, 'tests/fixtures/native-delivery/server.mjs'], { ...process.env, DATABASE_PATH: serverDb, OIDC_JWKS_PATH: join(root, 'oidc-jwks.json'), LOG_LEVEL: 'warn' }); children.push(server.process);
    await expect.poll(() => server.output()).toMatch(/PORTLESS_URL=https?:\/\//);
    await expect.poll(() => server.output()).toContain('fixtureServerReady');
    const origin = /PORTLESS_URL=(https?:\/\/\S+)/.exec(server.output())![1]!;
    await expect.poll(async () => { try { return (await page.request.get(`${origin}/liveness`)).ok(); } catch { return false; } }).toBe(true);
    await page.goto(origin); await signUp(page, 'native-supervisor@example.com', 'Native E2E');
    const identity = await authorizeAgent(page, origin);
    await page.goto(origin); const groupId = await createGroup(page, 'Supervisor nativo'); await addAgent(page, 'Scout');
    const botRef = randomUUID();
    const keys = generateKeyPairSync('ed25519'); const keyFile = join(root, 'fixture-key');
    await writeFile(keyFile, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    const post = async (path: string, data: unknown) => { const response = await page.request.post(`${origin}${path}`, { headers: { origin }, data }); expect(response.status()).toBe(201); return response.json(); };
    const { target } = await post('/api/native/targets', { provider: 'grok_bot', connectorId: 'fixture-only', nativeRef: botRef, contextMode: 'shared_bot_context', proofPublicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }) });
    const { binding } = await post('/api/native/bindings', { agentId: identity.agentId, targetId: target.id, groupIds: [groupId] });
    const challenge = await post('/api/native/pairings', { kind: 'automatic', connectionId: identity.connectionId, bindingId: binding.id, revision: 1, targetId: target.id, scopes: ['native:read','native:claim','native:start','native:complete'] });
    client = await mcpClient(origin, identity.token);
    payload(await client.callTool({ name: 'pair_native', arguments: { challenge: challenge.challenge, binding_id: binding.id, revision: 1, target_id: target.id } }));
    // Fixture verification applies only to this test's temporary database and signer.
    const db = createDatabase({ path: serverDb, busyTimeoutMs: 1000 });
    try { db.sqlite.prepare('UPDATE native_runtime_targets SET capabilities_json=? WHERE id=?').run(JSON.stringify({ groupIsolation: 'verified', durableResults: 'verified', approvals: 'verified', toolCatalog: 'verified', nativeVisibility: 'verified' }), target.id); } finally { db.close(); }
    const configure = async (enabled: boolean) => { const response = await page.request.patch(`${origin}/api/native/bindings/${binding.id}`, { headers: { origin }, data: { revision: 1, enabled } }); expect(response.ok()).toBe(true); };
    await configure(true);
    const release = join(root, 'provider-release'); const lost = join(root, 'callback-response-lost');
    const wakeToken = randomUUID();
    const proxy = child('portless', [`grok-callback-loss-${randomUUID().slice(0,8)}`, process.execPath, 'tests/fixtures/native-delivery/proxy.mjs'], { ...process.env, NATIVE_UPSTREAM: origin, NATIVE_LOST_RESPONSE: lost, NATIVE_DROP_TOOL: 'native_save' }); children.push(proxy.process);
    await expect.poll(() => /PORTLESS_URL=(https?:\/\/\S+)/.exec(proxy.output())?.[1]).toBeTruthy();
    const proxyOrigin = /PORTLESS_URL=(https?:\/\/\S+)/.exec(proxy.output())![1]!;
    const webhook = child('portless', [`grok-fake-webhook-${randomUUID().slice(0,8)}`, process.execPath, 'tests/fixtures/grok/webhook.mjs'], { ...process.env, AGENT_CHAT_MCP_URL: proxyOrigin, AGENT_CHAT_MCP_TOKEN: identity.token, GROK_FIXTURE_AGENT_ID: identity.agentId, GROK_FIXTURE_GROUP_ID: groupId, GROK_FIXTURE_DB: providerDb, GROK_FIXTURE_RELEASE: release, GROK_FIXTURE_SIGNER: keyFile, GROK_FIXTURE_WAKE_TOKEN: wakeToken }); children.push(webhook.process);
    await expect.poll(() => /PORTLESS_URL=(https?:\/\/\S+)/.exec(webhook.output())?.[1]).toBeTruthy();
    const webhookOrigin = /PORTLESS_URL=(https?:\/\/\S+)/.exec(webhook.output())![1]!;
    await expect.poll(async () => { try { return (await page.request.get(webhookOrigin)).status(); } catch { return 0; } }).toBe(403);
    const config = join(root, 'grok-fixture.json');
    await writeFile(config, JSON.stringify({ selection: { targetId: target.id, bindingId: binding.id, revision: 1, groupId, botRef, webhookUrl: 'https://synthetic.grok.example/wake', approvedHosts: ['synthetic.grok.example'] }, fixtureUrl: webhookOrigin }), { mode: 0o600 });
    const ready: number[] = [];
    const launch = (state: string) => {
      const supervisor = child(process.execPath, ['apps/bridge/dist/supervisor.js', '--native-adapter', resolve('tests/fixtures/grok/adapter.mjs'), '--state', join(root, state)], { ...process.env, AGENT_CHAT_MCP_URL: origin, AGENT_CHAT_MCP_TOKEN: identity.token, GROK_FIXTURE_CONFIG: config, GROK_FIXTURE_WAKE_TOKEN: wakeToken });
      children.push(supervisor.process);
      createInterface({ input: supervisor.process.stdout! }).on('line', line => { try { const event = JSON.parse(line); if (event.type === 'native.ready') ready.push(event.pid); } catch { /* Structured readiness only. */ } });
      return supervisor;
    };
    const rows = () => { const db = createDatabase({ path: serverDb, busyTimeoutMs: 1000 }); try { return db.sqlite.prepare('SELECT event_id,state,started,provider_started,message_id FROM native_deliveries ORDER BY created_at').all() as { event_id: string; state: string; started: number; provider_started: number; message_id: string | null }[]; } finally { db.close(); } };
    const provider = () => { const db = createDatabase({ path: providerDb, busyTimeoutMs: 1000 }); try { return { requests: db.sqlite.prepare('SELECT body FROM requests').all() as { body: string }[], runs: db.sqlite.prepare('SELECT result,identity_verified FROM runs').all() as { result: string | null; identity_verified: number }[] }; } finally { db.close(); } };
    const receiver = launch('controller-A'); await expect.poll(() => ready.length).toBe(1);
    await send(page, 'Uno'); await expect.poll(() => provider().requests.length).toBe(1);
    expect(rows()[0]).toMatchObject({ started: 1, provider_started: 0, message_id: null });
    expect(provider().runs[0]?.result).toBeNull();
    expect(payload<{ receipt: unknown }>(await client.callTool({ name: 'native_delivery', arguments: { eventId: rows()[0]!.event_id } })).receipt).toBeNull();
    await agents(page);
    const nativePanel = page.getByRole('region', { name: 'Receptor nativo de Scout', exact: true });
    await expect(nativePanel.getByRole('status')).toHaveText('Notificación aceptada; inicio del bot pendiente');
    await nativePanel.getByText('Ver actividad nativa', { exact: true }).click();
    await expect(nativePanel.getByText('Respuesta publicada', { exact: true })).toHaveCount(0);
    await selectGroup(page, 'Supervisor nativo');
    const envelope = JSON.parse(provider().requests[0]!.body) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual(['bindingId','eventId','revision','startKey','targetId','version']);
    // Restart the real supervisor with an empty store while the provider has accepted but not executed.
    await stop(receiver.process); const before = ready.length; launch('controller-B-empty');
    await expect.poll(() => ready.length).toBeGreaterThan(before);
    expect(provider().requests).toHaveLength(1);
    await writeFile(release, 'release');
    await expect(page.getByText('Grok simulado: Uno', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => existsSync(lost)).toBe(true);
    await expect.poll(() => rows()[0]?.state).toBe('done');
    expect(rows()[0]?.provider_started).toBe(1);
    expect(provider().runs.filter(r => r.result)).toHaveLength(1);
    await agents(page);
    await nativePanel.getByText('Ver actividad nativa', { exact: true }).click();
    await expect(nativePanel.getByText('Respuesta publicada', { exact: true })).toBeVisible();
    await expect(nativePanel.getByText('Salida: Grok simulado: Uno', { exact: true })).toBeVisible();
    await page.screenshot({ path: '.local-state/native-status-published.png', fullPage: true });
    await selectGroup(page, 'Supervisor nativo');
    // Duplicate webhook: the provider's durable result is reused, not regenerated.
    expect((await page.request.post(webhookOrigin, { headers: { authorization: `Bearer ${wakeToken}` }, data: envelope })).status()).toBe(200);
    await send(page, 'Dos'); await expect(page.getByText('Grok simulado: Dos', { exact: true })).toBeVisible();
    await send(page, 'SILENCIO'); await expect.poll(() => rows().filter(r => r.state === 'done').length).toBe(3);
    expect(rows().at(-1)?.message_id).toBeNull(); expect(provider().runs.filter(r => r.result)).toHaveLength(3);
    await configure(false); const pausedReady = ready.length; await send(page, 'PAUSADO');
    await expect.poll(() => ready.length, { timeout: 10000 }).toBeGreaterThan(pausedReady);
    expect(provider().requests).toHaveLength(4); // Three deliveries plus the duplicate wake.
    await configure(true); await expect(page.getByText('Grok simulado: PAUSADO', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => rows().filter(r => r.state === 'done').length).toBe(4);
    expect(provider().runs.filter(r => r.result)).toHaveLength(4);
    expect(provider().runs.every(r => r.identity_verified === 1)).toBe(true);
    await page.screenshot({ path: '.local-state/grok-notifications-e2e.png', fullPage: true });
  } finally { await page.close(); await client?.close(); for (const process of children.reverse()) await stop(process); await rm(root, { recursive: true, force: true }); }
});
