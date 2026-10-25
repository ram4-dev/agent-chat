import { expect, it } from 'vitest';
import type { OwnedAgentsResponse } from '@agent-chat/contracts';
import { ensureClientRegistered } from '../../apps/server/src/persistence/oauth-clients-repository';
import { agentToken, call, startHarness } from '../helpers/agent-harness';

it('returns registered application names in owner lists without disclosing client metadata or weakening ownership/revocation', async () => {
  const h = await startHarness();
  const owner = await agentToken(h, 'named-owner@example.com', 'Scout');
  const listing = await call(h, owner.jar, { method: 'GET', url: '/api/agents' });
  const agent = (listing.json() as OwnedAgentsResponse).agents[0]!;
  const connection = agent.connections[0]!;
  expect(connection.clientName).toBe('MCP test client');
  expect(connection.createdAt).toEqual(expect.any(String));
  expect(connection.revokedAt).toBeNull();
  expect(connection).not.toHaveProperty('metadata');
  expect(connection).not.toHaveProperty('client_secret');
  expect(listing.body).not.toContain(owner.token);
  expect(listing.body).not.toContain(owner.refreshToken);
  const second = await call(h, owner.jar, { method: 'POST', url: '/reg', payload: { client_name: 'Second workstation', redirect_uris: [h.origin + '/callback'], token_endpoint_auth_method: 'none' } });
  expect(second.statusCode).toBe(201);
  ensureClientRegistered(h.database.sqlite, second.json().client_id);
  h.database.sqlite.prepare('INSERT INTO agent_connections(id,agent_id,oauth_client_id,scopes,created_at) VALUES(?,?,?,?,?)')
    .run('second-connection', agent.id, second.json().client_id, 'agent:read', '2026-10-25T10:00:00Z');
  const connections = (await call(h, owner.jar, { method: 'GET', url: `/api/agents/${agent.id}/connections` })).json().connections;
  expect(connections.map((item: { clientName: string }) => item.clientName).sort()).toEqual(['MCP test client', 'Second workstation']);
  const other = await agentToken(h, 'named-other@example.com', 'Other');
  expect((await call(h, other.jar, { method: 'GET', url: `/api/agents/${agent.id}/connections` })).statusCode).toBe(404);
  expect((await call(h, other.jar, { method: 'DELETE', url: `/api/agent-connections/${connection.id}` })).statusCode).toBe(404);
  expect((await call(h, owner.jar, { method: 'DELETE', url: `/api/agent-connections/${connection.id}` })).statusCode).toBe(200);
  const after = (await call(h, owner.jar, { method: 'GET', url: `/api/agents/${agent.id}/connections` })).json().connections;
  expect(after.find((item: { id: string }) => item.id === connection.id)).toMatchObject({ clientName: 'MCP test client', revokedAt: expect.any(String) });
  expect(after.find((item: { id: string }) => item.id === 'second-connection')).toMatchObject({ clientName: 'Second workstation', revokedAt: null });
});
