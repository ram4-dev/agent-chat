import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { NativeDeliveryView } from '@agent-chat/contracts';
import { acquireProcessLock } from '../process-lock.js';
import type { NativeRuntimePort } from './runtime.js';

export interface NativeCallPort { call<T>(name: string, args: object, signal?: AbortSignal): Promise<T> }
export interface StartJournal { consume(startKey: string): boolean }
export async function processNativeNext(control: NativeCallPort, runtime: NativeRuntimePort, journal: StartJournal,
  controllerId: string, epoch: number, targetId: string, signal: AbortSignal): Promise<'idle' | 'processed' | 'blocked'> {
  if (signal.aborted) return 'idle';
  const next = await control.call<{ delivery: NativeDeliveryView | null; blocked?: boolean }>('native_next', { controllerId, epoch, waitMs: 10000 }, signal);
  if (signal.aborted) return 'idle';
  const d = next.delivery;
  if (!d) return next.blocked ? 'blocked' : 'idle';
  if (d.targetId !== targetId) throw new Error('Native target mismatch');
  if (d.state === 'result_saved') {
    await control.call('native_finish', { ticket: d.ticket }, signal);
    await runtime.confirmedReceipt?.(d.ticket.eventId, d.startKey);
    return 'processed';
  }
  if (!d.started && d.state === 'cancel_requested') return 'blocked';
  if (!d.started) {
    const history = await control.call<{ messages: unknown[] }>('read_messages', { as_agent_id: d.agentId, group_id: d.groupId, limit: 12 }, signal);
    if (signal.aborted) return 'idle';
    if (!d.incoming) throw new Error('Incoming event unavailable');
    await control.call('native_begin', { ticket: d.ticket }, signal);
    if (signal.aborted) return 'idle';
    d.started = true; d.state = 'start_uncertain';
    // Durable CAS before dispatch. Replays from this process also cannot call start again.
    if (!journal.consume(d.startKey)) throw new Error('Start authorization already consumed locally');
    if (signal.aborted) return 'idle';
    const accepted = await runtime.start({ delivery: d, history: history.messages, trustedInbound: false }, signal);
    if (signal.aborted) return 'idle';
    await control.call('native_running', { ticket: d.ticket, runRef: accepted.runRef }, signal);
    d.runRef = accepted.runRef;
  }
  if (signal.aborted) return 'idle';
  const query = { eventId: d.ticket.eventId, targetId: d.targetId, startKey: d.startKey, runRef: d.runRef, bindingId: d.bindingId, groupId: d.groupId, conversationGeneration: d.conversationGeneration, conversationRef: d.conversationRef, incoming: d.incoming };
  if (d.state === 'cancel_requested' && !d.cancelStarted && runtime.cancel) {
    await control.call('native_cancel_begin', { ticket: d.ticket }, signal);
    if (signal.aborted) return 'idle';
    await runtime.cancel(query, signal);
  }
  const observation = await runtime.observe(query, signal);
  if (signal.aborted) return 'idle';
  if (observation.state !== 'terminal') {
    if (observation.state !== 'active' && d.state !== 'cancel_requested') await control.call('native_pending', { ticket: d.ticket, state: observation.state === 'awaiting_approval' ? 'awaiting_approval' : 'needs_review' }, signal);
    return 'blocked';
  }
  if (observation.proof.data.terminal !== 'completed' || d.state === 'cancel_requested') {
    await control.call('native_reconcile', { proof: observation.proof }, signal);
    return 'blocked';
  }
  const result = await runtime.recoverResult(query, signal);
  if (signal.aborted) return 'idle';
  await control.call('native_save', { ticket: d.ticket, result, proof: observation.proof }, signal);
  await control.call('native_finish', { ticket: d.ticket }, signal);
  await runtime.confirmedReceipt?.(d.ticket.eventId, d.startKey);
  return 'processed';
}

export async function runNativeReceiver(modulePath: string, directory: string): Promise<void> {
  const url = process.env['AGENT_CHAT_MCP_URL']; const token = process.env['AGENT_CHAT_MCP_TOKEN'];
  if (!url || !token) throw new Error('Explicit native MCP connection required');
  const root = resolve(directory); await mkdir(root, { recursive: true, mode: 0o700 });
  const shutdown = new AbortController();
  const release = await acquireProcessLock(join(root, 'native.flock'), () => shutdown.abort());
  const client = new Client({ name: 'agent-chat-native-controller', version: '1.0.0' });
  let journal: Database.Database | undefined;
  let runtime: NativeRuntimePort | undefined;
  const halt = () => { shutdown.abort(); void client.close(); };
  process.once('SIGTERM', halt); process.once('SIGINT', halt);
  try {
    journal = new Database(join(root, 'native-controller.db'));
    journal.pragma('journal_mode=WAL'); journal.pragma('synchronous=FULL');
    journal.exec('CREATE TABLE IF NOT EXISTS consumed_starts(start_key TEXT PRIMARY KEY)');
    const adapter = await import(pathToFileURL(resolve(modulePath)).href) as { createNativeRuntime?: (directory: string) => Promise<NativeRuntimePort> };
    if (typeof adapter.createNativeRuntime !== 'function') throw new Error('Native runtime factory missing');
    runtime = await adapter.createNativeRuntime(root);
    const description = await runtime.describe();
    if (!description.durableResults || !description.observeByStartKey || (description.cancel && !runtime.cancel)) throw new Error('Native recovery capabilities missing');
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const control: NativeCallPort = { async call<T>(name: string, args: object, signal?: AbortSignal): Promise<T> {
      if (name === 'native_reconcile') {
        const response = await fetch(new URL('/native/reconcile', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify((args as { proof: unknown }).proof), ...(signal ? { signal } : {}) });
        if (!response.ok) throw new Error('Reconciliation refused');
        return await response.json() as T;
      }
      const response = await client.callTool({ name, arguments: args as Record<string, unknown> }, undefined, signal ? { signal } : undefined);
      if (response.isError) throw new Error('Native operation refused');
      const content = response.content as { type: string; text?: string }[];
      if (content[0]?.type !== 'text' || !content[0].text) throw new Error('Invalid native response');
      return JSON.parse(content[0].text) as T;
    } };
    const controllerId = randomUUID();
    const { epoch } = await control.call<{ epoch: number }>('native_open', { controllerId });
    for (const item of await runtime.unconfirmedResults?.() ?? []) {
      if (shutdown.signal.aborted) break;
      try {
        const current = await control.call<{ receipt: unknown }>('native_delivery', { eventId: item.eventId }, shutdown.signal);
        if (current.receipt) await runtime.confirmedReceipt?.(item.eventId, item.startKey);
      } catch { /* Revoked/unavailable content retains its unconfirmed local result. */ }
    }
    console.log(JSON.stringify({ type: 'native.ready', controllerId, epoch, pid: process.pid }));
    while (!shutdown.signal.aborted) {
      const status = await processNativeNext(control, runtime, { consume: (key) => journal!.prepare('INSERT OR IGNORE INTO consumed_starts(start_key) VALUES(?)').run(key).changes === 1 }, controllerId, epoch, description.targetId, shutdown.signal);
      if (status !== 'idle') console.log(JSON.stringify({ type: `native.${status}` }));
      if (status === 'blocked') await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); shutdown.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 1000); shutdown.signal.addEventListener('abort', done, { once: true }); if (shutdown.signal.aborted) done();
      });
    }
  } catch (error) { if (!shutdown.signal.aborted) throw error; }
  finally {
    shutdown.abort();
    const closed = await Promise.allSettled([client.close(), runtime?.close()]);
    try { journal?.close(); } finally { await release(); }
    if (closed.some(result => result.status === 'rejected')) process.exitCode = 1;
    process.removeListener('SIGTERM', halt); process.removeListener('SIGINT', halt);
  }
}
