import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { processNext, configureBindings, type CallPort } from '../../apps/bridge/src/receiver';
import { CodexWorker, restrictCatalog } from '../../apps/bridge/src/codex/worker';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function dir() { const d = await mkdtemp(join(tmpdir(), 'receiver-test-')); dirs.push(d); return d; }

it('excludes capabilities from catalog and applies the same restriction on resume', () => {
  const catalog = restrictCatalog({ models: [{ slug: 'gpt-6.1-sol', shell_type: 'unified_exec', tool_mode: 'code_mode_only', apply_patch_tool_type: 'freeform' }] }, 'gpt-6.1-sol');
  expect(catalog).toMatchObject({ models: [{ shell_type: 'disabled', tool_mode: 'direct', apply_patch_tool_type: null, experimental_supported_tools: [] }] });
  const worker = new CodexWorker('/tmp/worker-config');
  expect(worker.arguments('dedicated-thread')).toContain('--ignore-user-config');
  expect(worker.arguments('dedicated-thread')).toContain('features.shell_tool=false');
  expect(worker.arguments('dedicated-thread')).toContain('resume');
});
it('a lost save result retries persisted output without another model generation', async () => {
  const directory = await dir(); let fresh = true; let saveLost = true;
  const worker = { run: vi.fn(async () => ({ decision: 'reply' as const, text: 'Hola', threadId: 'dedicated-thread' })) };
  const calls: string[] = [];
  const control: CallPort = { async call<T>(tool: string): Promise<T> {
    calls.push(tool);
    if (tool === 'runtime_next') {
      const result = { job: { eventId: 'event', groupId: 'group', claim: 'claim', state: 'running' }, ...(fresh ? { event: { message: { text: 'hola' } } } : {}) };
      fresh = false; return result as T;
    }
    if (tool === 'read_messages') return { messages: [] } as T;
    if (tool === 'runtime_save' && saveLost) { saveLost = false; throw new Error('response lost'); }
    return {} as T;
  } };
  await expect(processNext(control, worker, 'instance', ['group'], directory)).rejects.toThrow('lost');
  expect(await processNext(control, worker, 'instance', ['group'], directory)).toBe('processed');
  expect(worker.run).toHaveBeenCalledTimes(1);
  expect(calls.at(-1)).toBe('runtime_finish');
});
it('does not regenerate a running claim after a crash without output', async () => {
  const calls: string[] = [];
  const control: CallPort = { async call<T>(tool: string): Promise<T> { calls.push(tool); return (tool === 'runtime_next' ? { job: { eventId: 'event', groupId: 'group', claim: 'claim', state: 'running' } } : {}) as T; } };
  const worker = { run: vi.fn() };
  expect(await processNext(control, worker, 'instance', ['group'], await dir())).toBe('blocked');
  expect(worker.run).not.toHaveBeenCalled(); expect(calls).toEqual(['runtime_next', 'runtime_fail']);
});

it('startup ignores a removed group and still configures the authorized group', async () => {
  const configured: object[] = [];
  const control: CallPort = { async call<T>(tool: string, args: object): Promise<T> {
    if (tool === 'list_groups') return { groups: [{ id: 'valid' }] } as T;
    configured.push(args); return {} as T;
  } };
  expect(await configureBindings(control, ['removed', 'valid'], 'gpt-6.1-sol')).toEqual(['valid']);
  expect(configured).toEqual([{ group_id: 'valid', enabled: true, model: 'gpt-6.1-sol', if_unconfigured: true }]);
});

it('shutdown while waiting never starts a new model turn', async () => {
  const stop = new AbortController(); const worker = { run: vi.fn() };
  const control: CallPort = { async call<T>(): Promise<T> { stop.abort(); return { job: { eventId: 'event', groupId: 'group', claim: 'claim', state: 'running' }, event: { message: { text: 'arrived during shutdown' } } } as T; } };
  expect(await processNext(control, worker, 'instance', ['group'], await dir(), 'controller', stop.signal)).toBe('idle');
  expect(worker.run).not.toHaveBeenCalled();
});
