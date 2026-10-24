import { expect, it } from 'vitest';
import { AUTH_PATHS } from '@agent-chat/contracts';
import { startHarness, CookieJar, call } from '../helpers/agent-harness';
it('native status requires both identity ownership and current human group membership', async () => {
  const h = await startHarness(); const owner = new CookieJar(); const other = new CookieJar();
  for (const [jar, email] of [[owner, 'status-owner@example.com'], [other, 'status-other@example.com']] as const) {
    expect((await call(h, jar, { method: 'POST', url: AUTH_PATHS.register, payload: { email, displayName: 'Owner', password: 'a-sufficiently-long-password' } })).statusCode).toBe(201);
  }
  const agent = (await call(h, owner, { method: 'POST', url: '/api/agents', payload: { name: 'Native' } })).json().agent;
  const group = (await call(h, owner, { method: 'POST', url: '/api/groups', payload: { name: 'Private' } })).json().group;
  const endpoint = `/api/agents/${agent.id}/native-status/${group.id}`;
  const read = await call(h, owner, { method: 'GET', url: endpoint });
  expect(read.statusCode).toBe(200); expect(read.json()).toEqual({ native: null });
  expect(read.headers['cache-control']).toBe('private, no-store');
  expect((await call(h, other, { method: 'GET', url: endpoint })).statusCode).toBe(404);
  expect((await call(h, new CookieJar(), { method: 'GET', url: endpoint })).statusCode).toBe(401);
  const foreign = (await call(h, other, { method: 'POST', url: '/api/groups', payload: { name: 'Foreign' } })).json().group;
  expect((await call(h, owner, { method: 'GET', url: `/api/agents/${agent.id}/native-status/${foreign.id}` })).statusCode).toBe(404);
});
