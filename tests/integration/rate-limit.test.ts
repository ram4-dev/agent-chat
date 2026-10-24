import { expect, it } from 'vitest';
import { startHarness, agentToken, call } from '../helpers/agent-harness';

it('limits unauthenticated requests by IP before doing expensive authentication', async () => {
  const h = await startHarness();
  let last;
  for (let n = 0; n < 121; n++) last = await h.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: h.origin, host: new URL(h.origin).host }, payload: {} });
  expect(last?.statusCode).toBe(429);
  expect(last?.json()).toEqual({ error: { code: 'rate_limited' } });
});

it('keeps authenticated human and agent budgets independent from the IP budget', async () => {
  const h = await startHarness();
  const owner = await agentToken(h, 'rate@example.com', 'Scout');
  for (let n = 0; n < 121; n++) await h.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: h.origin, host: new URL(h.origin).host }, payload: {} });
  expect((await call(h, owner.jar, { method: 'GET', url: '/api/agents' })).statusCode).toBe(200);
  const response = await fetch(`${h.origin}/mcp`, { headers: { authorization: `Bearer ${owner.token}` } });
  expect(response.status).not.toBe(429);
});
