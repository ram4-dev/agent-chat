import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { generateKeyPair, exportJWK } = await import(require.resolve('jose'));
const target = new URL('../.local-state/managed.env', import.meta.url);
mkdirSync(new URL('../.local-state/', import.meta.url), { recursive: true });
if (existsSync(target)) {
  log('Local managed environment already prepared; signing keys preserved.');
  process.exit(0);
}
const result = spawnSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' });
if (result.status !== 0) throw new Error('Start the local Supabase project first.');
const status = JSON.parse(result.stdout);
for (const key of ['DB_URL', 'API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']) {
  if (typeof status[key] !== 'string') throw new Error(`Local Supabase omitted ${key}`);
}
if (!['localhost', '127.0.0.1'].includes(new URL(status.DB_URL).hostname)) throw new Error('This command only prepares local environments.');
const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
const key = { ...await exportJWK(privateKey), alg: 'EdDSA', use: 'sig', kid: 'agent-chat-local' };
const values = {
  STORAGE_MODE: 'supabase', DATABASE_URL: status.DB_URL, SUPABASE_URL: status.API_URL,
  SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  OIDC_JWKS_JSON: JSON.stringify({ keys: [key] }),
  OIDC_COOKIE_KEYS: JSON.stringify([randomBytes(48).toString('base64url'), randomBytes(48).toString('base64url')]),
};
writeFileSync(target, Object.entries(values).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
log(`Prepared ${Object.keys(values).length} local environment variables; values were not printed.`);
