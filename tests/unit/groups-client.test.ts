import { describe, expect, it } from 'vitest';
import { GROUP_PATHS, DOMAIN_ERROR_CODES } from '@agent-chat/contracts';
import {
  createInvitation,
  loadGroupDetail,
  loadGroups,
} from '../../apps/web/src/features/groups/transport';
import type { JsonFetch, JsonFetchInit } from '../../apps/web/src/shared/http';

const GROUP = { id: 'group-1', name: 'Research', createdAt: '2026-01-01T00:00:00.000Z' };

interface Call {
  url: string;
  init: JsonFetchInit | undefined;
}

function fakeFetch(
  responses: Array<{ status: number; body: unknown }>,
): { calls: Call[]; fetch: JsonFetch } {
  const calls: Call[] = [];
  let index = 0;

  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const response = responses[Math.min(index, responses.length - 1)]!;
      index += 1;
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body,
      };
    },
  };
}

describe('loadGroups', () => {
  it('reads the shared collection path and projects the list', async () => {
    const client = fakeFetch([{ status: 200, body: { groups: [{ ...GROUP, role: 'admin' }] } }]);

    await expect(loadGroups(client.fetch)).resolves.toEqual({
      status: 'ready',
      groups: [{ ...GROUP, role: 'admin' }],
    });
    expect(client.calls.map((call) => call.url)).toEqual([GROUP_PATHS.collection]);
  });

  it('reports a body that is not the shared shape as an error', async () => {
    const client = fakeFetch([{ status: 200, body: { groups: [{ id: 'group-1' }] } }]);

    await expect(loadGroups(client.fetch)).resolves.toEqual({
      status: 'error',
      httpStatus: 200,
    });
  });

  it('reports an unreachable server without throwing', async () => {
    const fetchImpl: JsonFetch = () => Promise.reject(new Error('offline'));

    await expect(loadGroups(fetchImpl)).resolves.toEqual({ status: 'error', httpStatus: 0 });
  });
});

describe('loadGroupDetail', () => {
  it('keeps the shared not_found code so a private group stays unnamed', async () => {
    const client = fakeFetch([
      { status: 404, body: { error: { code: DOMAIN_ERROR_CODES.not_found } } },
    ]);

    await expect(loadGroupDetail('group-1', client.fetch)).resolves.toEqual({
      status: 'rejected',
      code: DOMAIN_ERROR_CODES.not_found,
    });
    expect(client.calls[0]!.url).toBe(GROUP_PATHS.one('group-1'));
  });

  it('returns members with kind and role for a member', async () => {
    const members = [
      { kind: 'human', id: 'u1', displayName: 'Ada', email: 'a@example.com', role: 'admin', joinedAt: 'x' },
    ];
    const client = fakeFetch([{ status: 200, body: { group: GROUP, role: 'admin', members } }]);

    await expect(loadGroupDetail('group-1', client.fetch)).resolves.toEqual({
      status: 'ready',
      detail: { group: GROUP, role: 'admin', members },
    });
  });
});

describe('invitations and membership', () => {
  it('posts an invitation without a JSON body and keeps the token', async () => {
    const client = fakeFetch([
      { status: 201, body: { token: 't'.repeat(43), expiresAt: '2026-01-08T00:00:00.000Z' } },
    ]);

    await expect(createInvitation('group-1', client.fetch)).resolves.toEqual({
      status: 'ready',
      invitation: { token: 't'.repeat(43), expiresAt: '2026-01-08T00:00:00.000Z' },
    });
    expect(client.calls[0]!.url).toBe(GROUP_PATHS.invitations('group-1'));
    expect(client.calls[0]!.init?.method).toBe('POST');
    // No content type: a bodyless POST with one is rejected by the server.
    expect(client.calls[0]!.init?.headers).toBeUndefined();
    expect(client.calls[0]!.init?.body).toBeUndefined();
  });

  it('reports an admin-only refusal with the shared code', async () => {
    const client = fakeFetch([
      { status: 403, body: { error: { code: DOMAIN_ERROR_CODES.forbidden } } },
    ]);

    await expect(createInvitation('group-1', client.fetch)).resolves.toEqual({
      status: 'rejected',
      code: DOMAIN_ERROR_CODES.forbidden,
    });
  });
});
