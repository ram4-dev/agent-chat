import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { cloudWebhookTransport } from '../../apps/bridge/src/native/grok-transport';
const wake = { version: 1 as const, eventId: 'opaque-event', bindingId: 'opaque-binding', revision: 1, targetId: 'opaque-target', startKey: 'opaque-start' };
beforeEach(() => { mocks.lookup.mockReset(); mocks.request.mockReset(); });
it('pins a checked public DNS address and retains Host, TLS servername and certificate verification', async () => {
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); let sent = '';
  mocks.request.mockImplementation((_options: object, callback: (response: { statusCode: number; destroy(): void }) => void) => {
    return Object.assign(new EventEmitter(), { end(body: string) { sent = body; callback({ statusCode: 200, destroy() {} }); } });
  });
  expect(await cloudWebhookTransport('https://approved.example/routine/opaque-id', ['approved.example'], 'synthetic-test-key').notify(wake, new AbortController().signal)).toBe(200);
  const options = mocks.request.mock.calls[0]![0] as Record<string, unknown>;
  expect(options).toMatchObject({ hostname: '8.8.8.8', servername: 'approved.example', port: 443, agent: false, path: '/routine/opaque-id', method: 'POST', headers: { host: 'approved.example', authorization: 'Bearer synthetic-test-key' } });
  expect(options.rejectUnauthorized).not.toBe(false); expect(options.checkServerIdentity).toBeUndefined(); expect(sent).toBe(JSON.stringify(wake));
});
it('rejects a mixed public/private DNS answer before sending a credential', async () => {
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  await expect(cloudWebhookTransport('https://approved.example/routine', ['approved.example'], 'synthetic').notify(wake, new AbortController().signal)).rejects.toThrow('not public');
  expect(mocks.request).not.toHaveBeenCalled();
});
it('does not follow redirects or forward the bearer to their destination', async () => {
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  mocks.request.mockImplementation((_options: object, callback: (response: { statusCode: number; destroy(): void }) => void) => Object.assign(new EventEmitter(), { end() { callback({ statusCode: 302, destroy() {} }); } }));
  expect(await cloudWebhookTransport('https://approved.example/routine', ['approved.example'], 'synthetic').notify(wake, new AbortController().signal)).toBe(302);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('cannot dispatch a delayed DNS result after shutdown', async () => {
  let answer!: (value: object[]) => void;
  mocks.lookup.mockReturnValue(new Promise<object[]>(resolve => { answer = resolve; }));
  const shutdown = new AbortController();
  const pending = cloudWebhookTransport('https://approved.example/routine', ['approved.example'], 'synthetic').notify(wake, shutdown.signal);
  shutdown.abort(); await expect(pending).rejects.toThrow('unconfirmed');
  answer([{ address: '8.8.8.8', family: 4 }]); await Promise.resolve();
  expect(mocks.request).not.toHaveBeenCalled();
});
