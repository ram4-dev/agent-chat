import { createServer, type RequestListener } from 'node:http';
import { afterEach, describe, it, expect } from 'vitest';
import { HermesRunsProbe } from '../../apps/bridge/src/adapters/hermes-runs';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function endpoint(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
  return `http://127.0.0.1:${address.port}`;
}

describe('native Hermes run contract over HTTP', () => {
  it('keeps explicit session and idempotency key, leaves native configuration intact and waits for a terminal', async () => {
    let calls = 0;
    const origin = await endpoint(async (request, response) => {
      response.setHeader('content-type', 'application/json');
      expect(request.headers.authorization).toBe('Bearer fixture-only');
      if (request.method === 'POST') {
        expect(request.headers['idempotency-key']).toBe('event-one');
        const buffers = []; for await (const part of request) buffers.push(part);
        expect(JSON.parse(Buffer.concat(buffers).toString())).toEqual({ session_id: 'group-one', input: 'hello' });
        response.writeHead(202).end(JSON.stringify({ run_id: 'native-one', status: 'started' }));
      } else {
        calls++;
        response.end(JSON.stringify({ run_id: 'native-one', session_id: 'group-one', status: calls === 1 ? 'running' : 'completed', ...(calls === 1 ? {} : { output: 'native reply' }) }));
      }
    });
    const probe = new HermesRunsProbe(origin, 'fixture-only');
    const id = await probe.start('group-one', 'hello', 'event-one');
    expect((await probe.status(id)).status).toBe('running');
    expect(await probe.status(id)).toMatchObject({ status: 'completed', output: 'native reply', sessionId: 'group-one' });
  });
  it('does not repeat an ambiguous start or disclose a provider body', async () => {
    let calls = 0;
    const origin = await endpoint((_request, response) => { calls++; response.destroy(); });
    await expect(new HermesRunsProbe(origin, 'private-fixture').start('group', 'private-input', 'key')).rejects.toThrow('do not retry');
    expect(calls).toBe(1);
    const rejected = await endpoint((_request, response) => { response.writeHead(403).end('private provider information'); });
    await expect(new HermesRunsProbe(rejected, 'private-fixture').start('group', 'input', 'key')).rejects.toThrow('Native request rejected (403)');
  });
  it('does not treat a malformed acceptance, unknown state or silence as successful completion', async () => {
    const origin = await endpoint((_request, response) => response.end(JSON.stringify({ status: 'unknown' })));
    const probe = new HermesRunsProbe(origin, 'fixture');
    await expect(probe.start('group', 'input', 'key')).rejects.toThrow('unconfirmed');
    await expect(probe.status('one')).rejects.toThrow('Unknown native status');
    await expect(probe.start('', 'input', 'key')).rejects.toThrow('Explicit session');
  });
  it('refuses redirects instead of sending the credential to another destination', async () => {
    let calls = 0;
    const other = await endpoint((_request, response) => { calls++; response.end('{}'); });
    const origin = await endpoint((_request, response) => { response.writeHead(307, { location: `${other}/v1/runs` }).end(); });
    await expect(new HermesRunsProbe(origin, 'fixture').start('group', 'input', 'key')).rejects.toThrow('unconfirmed');
    expect(calls).toBe(0);
  });
  it('preserves the native approval wait as a non-terminal state', async () => {
    const origin = await endpoint((_request, response) => response.end(JSON.stringify({ status: 'waiting_for_approval', session_id: 'group-one' })));
    expect(await new HermesRunsProbe(origin, 'fixture').status('one')).toEqual({ runId: 'one', status: 'waiting_for_approval', sessionId: 'group-one', output: null });
  });
});
