import { createServer } from 'node:http';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from '../../apps/server/src/persistence/client';
import { expect, it, vi } from 'vitest';
import { nativeProofPayload, type NativeDeliveryView } from '@agent-chat/contracts';
import { createHermesRuntime } from '../../apps/bridge/src/native/hermes';

it('Hermes adapter preserves native configuration, recovers with an empty journal, and purges only receipted results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hermes-adapter-'));
  const keys = generateKeyPairSync('ed25519');
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  let state = 'unknown'; let profileRef = 'alpha';
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    requests.push({ method: request.method!, path: request.url!, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url?.endsWith('/capabilities') ? { protocol: 1, profileRef, supportedSource: true, durable: true, readOnlyKeyLookup: true, normalCompletionQuiescent: true, cancelQuiescence: false }
      : request.method === 'POST' ? { run_id: 'run-one' } : { state, profileRef, runRef: 'run-one', decision: 'reply', text: 'Native answer' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test endpoint');
  const config = { targetId: 'target', profileRef: 'alpha', origin: `http://127.0.0.1:${address.port}`, token: 'synthetic', signingKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const delivery: NativeDeliveryView = { bindingRevision: 1, ticket: { eventId: 'event', controllerId: 'controller', claim: 'claim', epoch: 1 }, targetId: 'target', bindingId: 'binding', agentId: 'agent', groupId: 'group', conversationGeneration: 2, conversationRef: null, state: 'start_uncertain', started: true, cancelStarted: false, startKey: 'start-one', runRef: null, result: null, receipt: null, incoming: { id: 'message', groupId: 'group', text: 'hello', createdAt: '', author: { kind: 'human', id: 'human', displayName: 'Person' } } };
  const query = { ...delivery, eventId: 'event' };
  const signal = new AbortController().signal;
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  let runtime = await createHermesRuntime(config, root);
  try {
    expect((await runtime.describe()).cancel).toBe(false);
    await runtime.start({ delivery, history: [], trustedInbound: false }, signal);
    const sent = requests.find(r => r.method === 'POST')!;
    expect(sent.path).toBe('/p/alpha/v1/runs');
    expect(Object.keys(sent.body).sort()).toEqual(['author', 'input', 'session_id']);
    expect(sent.body.session_id).toBe('agent-chat:binding:group:2');
    expect(sent.body.author).toMatchObject({ id: 'agent-chat:human:human', is_bot: false });
    await expect(runtime.start({ delivery, history: [], trustedInbound: false }, signal)).rejects.toThrow();
    expect(await runtime.observe(query, signal)).toEqual({ state: 'unknown' });
    state = 'completed';
    const observation = await runtime.observe(query, signal);
    if (observation.state !== 'terminal') throw new Error('Missing terminal');
    expect(verify(null, Buffer.from(nativeProofPayload(observation.proof.data)), keys.publicKey, Buffer.from(observation.proof.signature, 'base64url'))).toBe(true);
    await runtime.close();
    // Remove local state: native read-only lookup still recovers without POST replay.
    await rm(join(root, 'hermes-runtime.db'), { force: true });
    runtime = await createHermesRuntime(config, root);
    expect((await runtime.observe(query, signal)).state).toBe('terminal');
    expect(await runtime.recoverResult(query, signal)).toMatchObject({ text: 'Native answer' });
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(await runtime.unconfirmedResults!()).toEqual([{ eventId: 'event', startKey: 'start-one' }]);
    await runtime.confirmedReceipt!('event', 'start-one');
    const db = createDatabase({ path: join(root, 'hermes-runtime.db'), busyTimeoutMs: 1000 });
    db.sqlite.exec("INSERT INTO runs(start_key,event_id,session_id,fingerprint,result_json,proof_json) SELECT 'pending-key','pending-event',session_id,fingerprint,result_json,proof_json FROM runs WHERE start_key='start-one'");
    // Keep this runtime alive and idle: expiry must not require restart/receipt activity.
    await vi.advanceTimersByTimeAsync(8 * 86400000);
    expect(db.sqlite.prepare('SELECT result_json,proof_json FROM runs WHERE start_key=?').get('start-one')).toEqual({ result_json: null, proof_json: null });
    expect((db.sqlite.prepare('SELECT result_json FROM runs WHERE start_key=?').get('pending-key') as { result_json: string }).result_json).toBeTruthy();
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 2 });
    db.close();
    await expect(runtime.recoverResult(query, signal)).rejects.toThrow('unavailable');
    await expect(runtime.start({ delivery, history: [], trustedInbound: false }, signal)).rejects.toThrow();
    profileRef = 'wrong-profile'; await expect(runtime.describe()).rejects.toThrow('not verified');
  } finally { await runtime.close(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
