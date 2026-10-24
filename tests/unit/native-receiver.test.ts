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

it.each([
  ['awaiting_approval', 'awaiting_approval'],
  ['start_uncertain', 'unknown'],
  ['cancel_requested', 'unknown'],
] as const)('keeps %s blocked without generation, result recovery or publication', async (state, observed) => {
  const s=fixture();const operations:{name:string;args:object}[]=[];
  const control:NativeCallPort={async call<T>(name:string,args:object):Promise<T>{operations.push({name,args});return {delivery:{...delivery,started:true,state}} as T;}};
  s.runtime.observe=async()=>({state:observed});
  s.runtime.recoverResult=async()=>{throw new Error('Nonterminal observation must not recover output');};
  const result=await processNativeNext(control,s.runtime,{consume:()=>{throw new Error('Spent authorization must not be consumed again');}},'controller',1,'t',new AbortController().signal);
  expect(result).toBe('blocked');expect(s.starts()).toBe(0);
  expect(operations.some(o=>['native_begin','native_running','native_save','native_finish','native_reconcile'].includes(o.name))).toBe(false);
  if(state==='awaiting_approval')expect(operations).toContainEqual({name:'native_pending',args:{ticket:delivery.ticket,state:'awaiting_approval'}});
  if(state==='cancel_requested')expect(operations.some(o=>o.name==='native_pending')).toBe(false);
});
it('reconciles terminal evidence after cancellation without publishing a completed reply',async()=>{
 const s=fixture();const operations:string[]=[];
 const control:NativeCallPort={async call<T>(name:string):Promise<T>{operations.push(name);return {delivery:{...delivery,started:true,cancelStarted:true,state:'cancel_requested'}} as T;}};
 s.runtime.observe=async()=>({state:'terminal',proof:{data:{eventId:'e',targetId:'t',startKey:'key',runRef:'native-run',terminal:'completed',resultHash:'synthetic-result-digest'},signature:'synthetic-proof-forwarded-to-server-validation'}});
 s.runtime.recoverResult=async()=>{throw new Error('Cancellation must not publish a result');};
 expect(await processNativeNext(control,s.runtime,{consume:()=>false},'controller',1,'t',new AbortController().signal)).toBe('blocked');
 expect(operations).toContain('native_reconcile');expect(operations).not.toContain('native_save');expect(operations).not.toContain('native_finish');expect(s.starts()).toBe(0);
});
