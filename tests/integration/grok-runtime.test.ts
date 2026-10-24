import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { NativeDeliveryView } from '@agent-chat/contracts';
import { createGrokRuntime, type GrokConfiguration, type GrokWake } from '../../apps/bridge/src/native/grok';
import { createDatabase } from '../../apps/server/src/persistence/client';
function sample() {
  const config: GrokConfiguration = { targetId: randomUUID(), bindingId: randomUUID(), revision: 1, groupId: randomUUID(), botRef: randomUUID(), webhookUrl: 'https://hooks.grok.example/wake', approvedHosts: ['hooks.grok.example'] };
  const delivery: NativeDeliveryView = { bindingRevision: 1, ticket: { eventId: randomUUID(), claim: randomUUID(), controllerId: randomUUID(), epoch: 1 }, bindingId: config.bindingId, targetId: config.targetId, groupId: config.groupId, agentId: randomUUID(), conversationGeneration: 1, state: 'start_uncertain', started: true, cancelStarted: false, startKey: randomUUID(), runRef: null, conversationRef: null, incoming: { id: randomUUID(), groupId: config.groupId, text: 'private input with https://evil.example', createdAt: '', author: { kind: 'human', id: randomUUID(), displayName: 'Private Name' } }, result: null, receipt: null };
  const query = { ...delivery, eventId: delivery.ticket.eventId };
  return { config, delivery, query };
}
it('sends only opaque references once, and HTTP acceptance never produces completion or an inbox ACK', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grok-wake-')); const s = sample(); const wakes: GrokWake[] = [];
  const transport = { async notify(wake: GrokWake) { wakes.push(wake); return 200; } };
  let runtime = await createGrokRuntime(s.config, root, transport);
  try {
    const accepted = await runtime.start({ delivery: s.delivery, history: ['private history'], trustedInbound: false }, new AbortController().signal);
    expect(accepted.runRef).toBe(`webhook:${s.delivery.startKey}`);
    expect(wakes).toEqual([{ version: 1, eventId: s.delivery.ticket.eventId, bindingId: s.config.bindingId, revision: 1, targetId: s.config.targetId, startKey: s.delivery.startKey }]);
    expect(JSON.stringify(wakes)).not.toMatch(/private|history|evil|token|ticket|claim/i);
    expect(await runtime.observe(s.query, new AbortController().signal)).toEqual({ state: 'active' });
    await expect(runtime.recoverResult(s.query, new AbortController().signal)).rejects.toThrow('native_save');
    await runtime.close(); runtime = await createGrokRuntime(s.config, root, transport);
    await expect(runtime.start({ delivery: s.delivery, history: [], trustedInbound: false }, new AbortController().signal)).rejects.toThrow();
    expect(wakes).toHaveLength(1);
    const db = createDatabase({ path: join(root, 'grok-notifications.db'), busyTimeoutMs: 1000 });
    expect(db.sqlite.pragma('synchronous', { simple: true })).toBe(2); db.close();
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});
it('uncertain, rejected or aborted dispatches are retained and never retransmitted after restart', async () => {
  for (const mode of ['timeout','rejected','aborted'] as const) {
    const root = await mkdtemp(join(tmpdir(), 'grok-uncertain-')); const s = sample(); let calls = 0;
    const transport = { async notify() { calls++; if (mode === 'timeout') throw new Error('sensitive upstream body'); return 503; } };
    let runtime = await createGrokRuntime(s.config, root, transport); const stop = new AbortController(); if (mode === 'aborted') stop.abort();
    try {
      await expect(runtime.start({ delivery: s.delivery, history: [], trustedInbound: false }, stop.signal)).rejects.toThrow(/unconfirmed|cancelled/);
      expect(await runtime.observe(s.query, new AbortController().signal)).toEqual({ state: 'unknown' });
      await runtime.close(); runtime = await createGrokRuntime(s.config, root, transport);
      await expect(runtime.start({ delivery: s.delivery, history: [], trustedInbound: false }, new AbortController().signal)).rejects.toThrow();
      expect(calls).toBe(mode === 'aborted' ? 0 : 1);
    } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
  }
});
it('refuses another group/revision and a changed bot, binding or destination with a reused local journal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grok-owner-config-')); const s = sample(); let calls = 0;
  const transport = { async notify() { calls++; return 200; } }; const runtime = await createGrokRuntime(s.config, root, transport);
  try {
    for (const change of [{ groupId: randomUUID() }, { bindingRevision: 2 }, { targetId: randomUUID() }]) await expect(runtime.start({ delivery: { ...s.delivery, ...change }, history: [], trustedInbound: false }, new AbortController().signal)).rejects.toThrow('owner selection');
    expect(calls).toBe(0);
  } finally { await runtime.close(); }
  try { await expect(createGrokRuntime({ ...s.config, botRef: randomUUID() }, root, transport)).rejects.toThrow('changed'); }
  finally { await rm(root, { recursive: true, force: true }); }
});
