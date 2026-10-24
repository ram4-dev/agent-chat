import { expect, it } from 'vitest';
import type { NativeDeliveryView } from '@agent-chat/contracts';
import { processNativeNext, type NativeCallPort } from '../../apps/bridge/src/native/receiver';
import type { NativeRuntimePort } from '../../apps/bridge/src/native/runtime';
const delivery: NativeDeliveryView = { bindingRevision: 1, ticket: { eventId: 'e', claim: 'c', controllerId: 'controller', epoch: 1 }, bindingId: 'b', conversationGeneration: 1, targetId: 't', groupId: 'g', agentId: 'a', state: 'claimed', started: false, cancelStarted: false, startKey: 'key', runRef: null, conversationRef: null, incoming: { id: 'm', groupId: 'g', text: 'Incoming', createdAt: '', author: { kind: 'human', id: 'u', displayName: 'User' } }, result: null, receipt: null };
function fixture(onCall?: (name: string) => void) {
  const calls: string[] = []; let starts = 0;
  const control: NativeCallPort = { async call<T>(name: string): Promise<T> { calls.push(name); onCall?.(name); return (name === 'native_next' ? { delivery: { ...delivery } } : name === 'read_messages' ? { messages: [] } : {}) as T; } };
  const runtime: NativeRuntimePort = { async describe() { return { targetId: 't', durableResults: true, observeByStartKey: true, cancel: false, approvals: false }; }, async start() { starts++; return { runRef: 'r' }; }, async observe() { return { state: 'unknown' }; }, async recoverResult() { throw new Error('No result'); }, async close() {} };
  return { control, runtime, calls, starts: () => starts };
}
it('does not start after shutdown wakes a pending next call', async () => {
  const stop = new AbortController(); const s = fixture(name => { if (name === 'native_next') stop.abort(); });
  await processNativeNext(s.control, s.runtime, { consume: () => true }, 'controller', 1, 't', stop.signal);
  expect(s.calls).toEqual(['native_next']); expect(s.starts()).toBe(0);
});
it('does not dispatch after shutdown during begin', async () => {
  const stop = new AbortController(); const s = fixture(name => { if (name === 'native_begin') stop.abort(); });
  await processNativeNext(s.control, s.runtime, { consume: () => true }, 'controller', 1, 't', stop.signal);
  expect(s.starts()).toBe(0);
});
it('refuses a local replay after consuming server begin and never calls start', async () => {
  const s = fixture();
  await expect(processNativeNext(s.control, s.runtime, { consume: () => false }, 'controller', 1, 't', new AbortController().signal)).rejects.toThrow('consumed locally');
  expect(s.starts()).toBe(0);
});
it('only observes a started delivery even with an empty local journal', async () => {
  const s = fixture();
  const control: NativeCallPort = { async call<T>(name: string): Promise<T> { s.calls.push(name); return { delivery: { ...delivery, started: true, state: 'start_uncertain' } } as T; } };
  expect(await processNativeNext(control, s.runtime, { consume: () => { throw new Error('Must not consume again'); } }, 'controller', 1, 't', new AbortController().signal)).toBe('blocked');
  expect(s.starts()).toBe(0); expect(s.calls).not.toContain('native_begin');
});
it('confirms a local result only after the server has returned its durable receipt', async () => {
  const calls: string[] = [];
  const s = fixture();
  s.runtime.confirmedReceipt = async (eventId, startKey) => { expect([eventId, startKey]).toEqual(['e', 'key']); calls.push('confirmed'); };
  const control: NativeCallPort = { async call<T>(name: string): Promise<T> { calls.push(name); return (name === 'native_next' ? { delivery: { ...delivery, state: 'result_saved' } } : {}) as T; } };
  await processNativeNext(control, s.runtime, { consume: () => false }, 'controller', 1, 't', new AbortController().signal);
  expect(calls).toEqual(['native_next', 'native_finish', 'confirmed']);
  calls.length = 0;
  const failed: NativeCallPort = { async call<T>(name: string): Promise<T> { if (name === 'native_finish') throw new Error('lost response'); return { delivery: { ...delivery, state: 'result_saved' } } as T; } };
  await expect(processNativeNext(failed, s.runtime, { consume: () => false }, 'controller', 1, 't', new AbortController().signal)).rejects.toThrow('lost response');
  expect(calls).toEqual([]);
});
