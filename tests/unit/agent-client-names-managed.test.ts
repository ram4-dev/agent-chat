import { expect, it, vi } from 'vitest';
import { createManagedServices } from '../../apps/server/src/managed/services';
import type { ManagedDatabase } from '../../apps/server/src/managed/database';
import type { SupabaseAuthConfig } from '../../apps/server/src/managed/human-auth';

it('loads Supabase application names in the connection list query, after checking ownership', async () => {
  const rows = vi.fn().mockResolvedValue([
    { id: 'one', agentId: 'agent', oauthClientId: 'app-one', clientName: 'Notebook', scopes: 'agent:read agent:inbox', revokedAt: null, createdAt: '2026-10-25' },
    { id: 'two', agentId: 'agent', oauthClientId: 'app-two', clientName: null, scopes: '', revokedAt: '2026-10-25', createdAt: '2026-10-24' },
  ]);
  const one = vi.fn().mockResolvedValue({ id: 'agent', ownerUserId: 'owner' });
  const db = { rows, one } as unknown as ManagedDatabase;
  const services = createManagedServices(db, {} as SupabaseAuthConfig);
  const result = await services.agents.listConnections('agent', 'owner');
  expect(one).toHaveBeenCalledWith(expect.stringContaining('owner_user_id=$2'), ['agent', 'owner']);
  expect(rows).toHaveBeenCalledTimes(1);
  expect(rows).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN oauth_clients'), ['agent']);
  expect(result).toMatchObject([{ clientName: 'Notebook', scopes: ['agent:read', 'agent:inbox'] }, { clientName: null, scopes: [], revokedAt: '2026-10-25' }]);
  one.mockResolvedValueOnce(undefined);
  await expect(services.agents.listConnections('agent', 'stranger')).rejects.toThrow();
  expect(rows).toHaveBeenCalledTimes(1);
});
