import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { ManagedAuth } from '../../apps/bridge/src/managed/auth';

it('rejects cross-origin or non-TLS cloud endpoints before using private credentials', () => {
  for (const origin of ['http://public.example', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?query']) {
    expect(() => new ManagedAuth(origin, '/unused')).toThrow('HTTPS server origin');
  }
});

it('protects stored OAuth credentials, keeps them server-bound and sanitizes malformed private state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'managed-auth-'));
  try {
    const provider = new ManagedAuth('https://example.com', directory); await provider.load();
    await provider.saveTokens({ access_token: 'fixture-access', token_type: 'Bearer', refresh_token: 'fixture-refresh' });
    expect((await stat(join(directory, 'oauth.json'))).mode & 0o777).toBe(0o600);
    const loaded = new ManagedAuth('https://example.com', directory); await loaded.load();
    expect(loaded.tokens()?.refresh_token).toBe('fixture-refresh');
    await expect(new ManagedAuth('https://other.example.com', directory).load()).rejects.toThrow('Cannot load private OAuth state');
    await writeFile(join(directory, 'oauth.json'), '{ fixture-private-credential');
    const failure: unknown = await loaded.load().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Cannot load private OAuth state');
    expect(failure).not.toHaveProperty('cause');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
