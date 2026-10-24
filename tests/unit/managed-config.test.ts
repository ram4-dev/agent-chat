import { expect, it } from 'vitest';
import { readConfig } from '../../apps/server/src/config/env';

it('refuses SQLite fallback on Vercel and reports missing names without their values', () => {
  expect(() => readConfig({ env: { VERCEL: '1' }, repoRoot: '/tmp' })).toThrow('STORAGE_MODE');
  expect(() => readConfig({ env: { STORAGE_MODE: 'supabase', DATABASE_URL: 'postgres://private-password' }, repoRoot: '/tmp' })).toThrow('SUPABASE_URL');
  try { readConfig({ env: { STORAGE_MODE: 'supabase', DATABASE_URL: 'private-value' }, repoRoot: '/tmp' }); }
  catch (error) { expect(String(error)).not.toContain('private-value'); }
});

it('does not generate ephemeral signing keys for managed deployments', () => {
  expect(() => readConfig({ env: {
    STORAGE_MODE: 'supabase', DATABASE_URL: 'postgres://localhost/test', SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'public-test-key', SUPABASE_SERVICE_ROLE_KEY: 'private-test-key',
  }, repoRoot: '/tmp' })).toThrow('OIDC_JWKS_JSON');
});

it('rejects an invalid database CA without echoing its contents', () => {
  expect(() => readConfig({ env: {
    STORAGE_MODE: 'supabase', DATABASE_URL: 'postgres://localhost/test',
    SUPABASE_URL: 'http://127.0.0.1:54321', DATABASE_SSL_CA: 'invalid-private-value',
  }, repoRoot: '/tmp' })).toThrow('Invalid DATABASE_SSL_CA');
});
