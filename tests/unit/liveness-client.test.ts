import { describe, expect, it } from 'vitest';
import { LIVENESS_PATH } from '@agent-chat/contracts';
import { loadLiveness } from '../../apps/web/src/shared/liveness';

describe('loadLiveness', () => {
  it('requests the shared liveness path and reports ok', async () => {
    const requestedPaths: string[] = [];

    const state = await loadLiveness(async (input) => {
      requestedPaths.push(input);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', database: 'ok' }),
      };
    });

    expect(requestedPaths).toEqual([LIVENESS_PATH]);
    expect(state).toEqual({ status: 'ok', database: 'ok' });
  });

  it('reports the http status when the server answers with an error', async () => {
    const state = await loadLiveness(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: 'temporarily_unavailable' } }),
    }));

    expect(state).toEqual({ status: 'error', httpStatus: 503 });
  });

  it('rejects a body that does not match the liveness contract', async () => {
    const state = await loadLiveness(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', database: 'degraded' }),
    }));

    expect(state).toEqual({ status: 'error', httpStatus: 200 });
  });

  it('reports unreachable when the request itself fails', async () => {
    const state = await loadLiveness(async () => {
      throw new Error('network down');
    });

    expect(state).toEqual({ status: 'unreachable' });
  });
});
