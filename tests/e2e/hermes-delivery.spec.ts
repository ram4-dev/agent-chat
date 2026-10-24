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
import { signUp, createGroup, addAgent, send } from './helpers/ui';

import { nativeHermes } from '../helpers/native-hermes';
import { invitation, joinGroup, selectGroup } from './helpers/ui';
test('Hermes profile receives browser messages through its real supervisor, preserves sessions and recovers without regeneration', async ({ page, browser }) => {
  const source = process.env['AGENT_CHAT_HERMES_SOURCE'];
  test.skip(!source, 'Requires Hermes source and isolated fake provider');
  test.setTimeout(180000);
  const hermes = await nativeHermes(source!, undefined, { mode: 'approval', profileName: 'alpha', plugin: true });
  const root = await mkdtemp(join(tmpdir(), 'hermes-delivery-e2e-'));
  const children: ChildProcess[] = [];
  let client: Awaited<ReturnType<typeof mcpClient>> | undefined;
  const serverDb = join(root, 'server.db');
  try {
    let probe = await hermes.start();
    const oidcKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    await writeFile(join(root, 'oidc-jwks.json'), JSON.stringify({ keys: [{ ...oidcKey, alg: 'EdDSA', use: 'sig', kid: 'fixture' }] }), { mode: 0o600 });
    const server = child('portless', [`native-delivery-${randomUUID().slice(0,8)}`, process.execPath, 'tests/fixtures/native-delivery/server.mjs'], { ...process.env, DATABASE_PATH: serverDb, OIDC_JWKS_PATH: join(root, 'oidc-jwks.json'), LOG_LEVEL: 'warn' }); children.push(server.process);
    await expect.poll(() => server.output()).toMatch(/PORTLESS_URL=https?:\/\//);
    const origin = /PORTLESS_URL=(https?:\/\/\S+)/.exec(server.output())![1]!;
    await expect.poll(async () => { try { return (await page.request.get(`${origin}/liveness`)).ok(); } catch { return false; } }).toBe(true);
    await page.goto(origin); await signUp(page, 'native-supervisor@example.com', 'Native E2E');
    const identity = await authorizeAgent(page, origin);
    await page.goto(origin); const groupId = await createGroup(page, 'Supervisor nativo'); await addAgent(page, 'Scout');
    const invite = await invitation(page);
    const otherGroup = await createGroup(page, 'Otro grupo Hermes'); await addAgent(page, 'Scout');
    await selectGroup(page, 'Supervisor nativo');
    const keys = generateKeyPairSync('ed25519'); const keyFile = join(root, 'fixture-key');
    await writeFile(keyFile, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    const post = async (path: string, data: unknown) => { const response = await page.request.post(`${origin}${path}`, { headers: { origin }, data }); expect(response.status()).toBe(201); return response.json(); };
    const { target } = await post('/api/native/targets', { provider: 'hermes', connectorId: 'fixture-hermes', nativeRef: 'alpha', contextMode: 'native_per_group', proofPublicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }) });
    const { binding } = await post('/api/native/bindings', { agentId: identity.agentId, targetId: target.id, groupIds: [groupId, otherGroup] });
    const challenge = await post('/api/native/pairings', { kind: 'automatic', connectionId: identity.connectionId, bindingId: binding.id, revision: 1, targetId: target.id, scopes: ['native:read','native:claim','native:start','native:complete'] });
    client = await mcpClient(origin, identity.token);
    payload(await client.callTool({ name: 'pair_native', arguments: { challenge: challenge.challenge, binding_id: binding.id, revision: 1, target_id: target.id } }));
    // Fixture verification applies only to this test's temporary database and signer.
    const db = createDatabase({ path: serverDb, busyTimeoutMs: 1000 });
    try { db.sqlite.prepare('UPDATE native_runtime_targets SET capabilities_json=? WHERE id=?').run(JSON.stringify({ groupIsolation: 'verified', durableResults: 'verified', approvals: 'verified', toolCatalog: 'verified', nativeVisibility: 'verified' }), target.id); } finally { db.close(); }
    const configure = async (enabled: boolean) => { const response = await page.request.patch(`${origin}/api/native/bindings/${binding.id}`, { headers: { origin }, data: { revision: 1, enabled } }); expect(response.ok()).toBe(true); };
    await configure(true);
    const config = join(root, 'hermes.json');
    await writeFile(config, JSON.stringify({ targetId: target.id, ...hermes.configuration(), token: undefined }), { mode: 0o600 });
    const marker = join(root, 'running-request-blocked');
    const proxy = child('portless', [`hermes-loss-${randomUUID().slice(0,8)}`, process.execPath, 'tests/fixtures/native-delivery/proxy.mjs'], { ...process.env, NATIVE_UPSTREAM: origin, NATIVE_BLOCK_TOOL: 'native_running', NATIVE_BLOCK_MARKER: marker }); children.push(proxy.process);
    await expect.poll(() => /PORTLESS_URL=(https?:\/\/\S+)/.exec(proxy.output())?.[1]).toBeTruthy();
    const proxyOrigin = /PORTLESS_URL=(https?:\/\/\S+)/.exec(proxy.output())![1]!;
    const ready: number[] = [];
    const launch = (state: string) => {
      const receiver = child(process.execPath, ['apps/bridge/dist/supervisor.js', '--native-adapter', resolve('apps/bridge/dist/native/hermes.js'), '--state', join(root, state)], { ...process.env, AGENT_CHAT_MCP_URL: proxyOrigin, AGENT_CHAT_MCP_TOKEN: identity.token, AGENT_CHAT_HERMES_CONFIG: config, AGENT_CHAT_HERMES_TOKEN: hermes.configuration().token, AGENT_CHAT_HERMES_SIGNING_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
      children.push(receiver.process);
      createInterface({ input: receiver.process.stdout! }).on('line', line => { try { const event = JSON.parse(line); if (event.type === 'native.ready') ready.push(event.pid); } catch { /* Readiness only. */ } });
      return receiver;
    };
    const rows = () => { const db = createDatabase({ path: serverDb, busyTimeoutMs: 1000 }); try { return db.sqlite.prepare('SELECT event_id,state,native_run_ref AS run_ref,start_key,message_id FROM native_deliveries ORDER BY created_at').all() as { event_id: string; state: string; run_ref: string | null; start_key: string; message_id: string | null }[]; } finally { db.close(); } };
    const generated = async () => (await hermes.observations()).requests.filter(r => r.fixture_kind === 'streamed_turn');
    const receiver = launch('A'); await expect.poll(() => ready.length).toBe(1);
    await send(page, 'FIRST_HERMES_CONTEXT');
    await expect.poll(() => existsSync(marker)).toBe(true);
    await expect.poll(async () => (await generated()).length).toBe(1);
    await expect.poll(async () => (await hermes.evidence()).workerCount).toBe(0);
    expect(rows()[0]?.run_ref).toBeNull();
    await stop(receiver.process);
    await hermes.stop(); probe = await hermes.start();
    launch('B-empty'); await expect.poll(() => ready.length).toBe(2);
    await expect.poll(() => rows()[0]?.state).toBe('done');
    expect((await generated()).length).toBe(0); // New provider process: recovery makes no completion.
    expect(rows()[0]?.message_id).toBeTruthy();
    await expect(page.getByRole('list', { name: 'Mensajes' })).toContainText('native fixture reply');
    await page.screenshot({ path: '.local-state/hermes-01-recovered.png', fullPage: true });
    const guestContext = await browser.newContext();
    try {
      const guest = await guestContext.newPage(); await guest.goto(origin); await signUp(guest, 'hermes-guest@example.com', 'Otra persona'); await joinGroup(guest, invite);
      await send(guest, 'SECOND_HUMAN');
      await expect.poll(() => rows().filter(r => r.state === 'done').length).toBe(2);
      const shared = JSON.stringify((await generated())[0]?.messages);
      expect(shared).toContain('FIRST_HERMES_CONTEXT'); expect(shared).toContain('SECOND_HUMAN');
      const session = `agent-chat:${binding.id}:${groupId}:1`;
      expect(JSON.stringify(await probe.history(session))).toContain('SECOND_HUMAN');
      await selectGroup(page, 'Otro grupo Hermes'); await send(page, 'OTHER_GROUP_CONTEXT');
      await expect.poll(() => rows().filter(r => r.state === 'done').length).toBe(3);
      expect(JSON.stringify((await generated()).at(-1)?.messages)).not.toContain('FIRST_HERMES_CONTEXT');
      await selectGroup(page, 'Supervisor nativo'); await send(page, 'APPROVAL_NATIVE');
      await expect.poll(() => rows().at(-1)?.state).toBe('awaiting_approval');
      const approvalRow = rows().at(-1)!;
      expect(approvalRow.message_id).toBeNull();
      const waiting = await probe.status(approvalRow.run_ref!); expect(waiting.approval?.requestId).toBeTruthy();
      await probe.approve(waiting.runId, waiting.approval!.requestId, 'once');
      await expect(page.getByText('Native approval completed', { exact: true })).toBeVisible();
      await send(page, 'SILENT_NATIVE');
      await expect.poll(() => rows().filter(r => r.state === 'done').length).toBe(5);
      expect(rows().at(-1)?.message_id).toBeNull();
      await page.screenshot({ path: '.local-state/hermes-02-approval-silence.png', fullPage: true });
    } finally { await guestContext.close(); }
  } finally { await page.close(); await client?.close(); for (const process of children.reverse()) await stop(process); await hermes.close(); await rm(root, { recursive: true, force: true }); }
});
