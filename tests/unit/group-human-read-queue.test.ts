import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadQueue } from '../../apps/web/src/features/groups/readQueue';
import { reconcileGroups, refreshingGroups, markDisplayedMessagesRead, loadGroupDetail } from '../../apps/web/src/features/groups/transport';
import { parseGroupListResponse, parseGroupReadRequest } from '@agent-chat/contracts';

afterEach(() => vi.useRealTimers());
const group = { id: 'g', name: 'Grupo', role: 'member' as const, createdAt: '2026-01-01T00:00:00Z' };
describe('human group read queue', () => {
  it('batches exact displayed IDs, deduplicates and bounds writes to 100', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_ids: readonly string[]) => ({ ok: true, httpStatus: 200 }));
    const changed = vi.fn();
    const queue = createReadQueue({ canRead: () => true, send, onChanged: changed, onError: vi.fn() });
    queue.display(Array.from({ length: 205 }, (_, i) => `m${i}`));
    queue.display(['m1', 'm2']);
    await vi.runAllTimersAsync();
    expect(send.mock.calls.map(call => call[0].length)).toEqual([100, 100, 5]);
    queue.display(['m1']);
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenCalledTimes(3);
    queue.display(['new-message']); await vi.runAllTimersAsync(); expect(send).toHaveBeenCalledTimes(4);
    queue.dispose();
  });
  it('does not read hidden/unfocused tabs or carry pending IDs over a blur', async () => {
    vi.useFakeTimers(); let visible = true;
    const send = vi.fn(async (_ids: readonly string[]) => ({ ok: true, httpStatus: 200 }));
    const queue = createReadQueue({ canRead: () => visible, send, onChanged: vi.fn(), onError: vi.fn() });
    queue.display(['visible']); visible = false; queue.pause(); queue.display(['hidden']);
    await vi.runAllTimersAsync(); expect(send).not.toHaveBeenCalled();
    visible = true; queue.display(['visible-again']); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledWith(['visible-again']); queue.dispose();
  });
  it('shows failed writes without a retry loop, and retries only exact pending IDs', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValueOnce({ ok: false, httpStatus: 503 }).mockResolvedValue({ ok: true, httpStatus: 200 });
    const onError = vi.fn(); const changed = vi.fn();
    const queue = createReadQueue({ canRead: () => true, send, onChanged: changed, onError });
    queue.display(['one']); await vi.runAllTimersAsync(); queue.display(['two']); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledWith(true, 503); expect(changed).not.toHaveBeenCalled();
    queue.retry(); await vi.runAllTimersAsync(); expect(send).toHaveBeenLastCalledWith(['one', 'two']); queue.dispose();
  });
  it('discards completions after group/account disposal', async () => {
    vi.useFakeTimers(); let resolve!: (value: { ok: boolean; httpStatus: number }) => void;
    const changed = vi.fn();
    const queue = createReadQueue({ canRead: () => true, send: () => new Promise(r => { resolve = r; }), onChanged: changed, onError: vi.fn() });
    queue.display(['old-group']); await vi.advanceTimersByTimeAsync(250); queue.dispose();
    resolve({ ok: true, httpStatus: 200 }); await Promise.resolve(); expect(changed).not.toHaveBeenCalled();
  });
});
it('preserves stale navigation during refresh/retry and clears it for auth loss', () => {
  const ready = { status: 'ready' as const, groups: [group] };
  expect(refreshingGroups(ready)).toEqual({ status: 'refreshing', groups: [group] });
  expect(reconcileGroups(ready, { status: 'error', httpStatus: 503 })).toEqual({ status: 'stale', groups: [group], httpStatus: 503 });
  for (const httpStatus of [401, 403]) expect(reconcileGroups(ready, { status: 'error', httpStatus })).toEqual({ status: 'forbidden', httpStatus });
  expect(reconcileGroups({ status: 'loading' }, { status: 'error', httpStatus: 503 })).toEqual({ status: 'error', httpStatus: 503 });
});
it('bounds and validates read requests and activity metadata', () => {
  expect(parseGroupReadRequest({ messageIds: ['one', 'one'] })).toEqual({ ok: true, value: { messageIds: ['one'] } });
  for (const messageIds of [[], [''], Array(101).fill('one'), [1], ['x'.repeat(129)]]) expect(parseGroupReadRequest({ messageIds }).ok).toBe(false);
  expect(parseGroupReadRequest({ throughSequence: 500 }).ok).toBe(false);
  const activity = { latestSequence: 5, readSequence: 2, unreadCount: 3, latestMessageAt: group.createdAt };
  expect(parseGroupListResponse({ groups: [{ ...group, activity }] }).ok).toBe(true);
  for (const unreadCount of [-1, NaN, 1.5, '3']) expect(parseGroupListResponse({ groups: [{ ...group, activity: { ...activity, unreadCount } }] }).ok).toBe(false);
});
it('reports transport failures without throwing', async () => {
  expect(await markDisplayedMessagesRead('g', ['one'], () => Promise.reject(new Error('offline')))).toEqual({ ok: false, httpStatus: 0 });
});

it('keeps transient detail failures separate from permission loss, even for malformed error bodies', async () => {
  for (const httpStatus of [401, 403, 404, 503]) {
    const fetchImpl = async () => ({ ok: false, status: httpStatus, json: () => Promise.reject(new Error('not JSON')) });
    expect(await loadGroupDetail('g', fetchImpl)).toEqual({ status: 'error', httpStatus });
  }
  expect(await loadGroupDetail('g', async () => ({ ok: false, status: 503, json: async () => ({ error: { code: 'internal_error' } }) })))
    .toEqual({ status: 'error', httpStatus: 503 });
});
