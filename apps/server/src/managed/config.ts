import type { JWK } from 'jose';
import { X509Certificate } from 'node:crypto';
import { ConfigError } from '../config/env.js';

export interface ManagedConfig {
  databaseUrl: string;
  databaseCa?: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  jwks: { keys: JWK[] };
  cookieKeys: string[];
}

/** Never include a supplied credential or connection URL in a validation error. */
export function readManagedConfig(env: Record<string, string | undefined>): ManagedConfig | undefined {
  if (env['STORAGE_MODE'] !== 'supabase') {
    if (env['VERCEL'] === '1') throw new ConfigError('Vercel requires STORAGE_MODE=supabase');
    return undefined;
  }
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new ConfigError(`Missing ${name}`);
    return value;
  };
  const databaseUrl = required('DATABASE_URL');
  const supabaseUrl = required('SUPABASE_URL');
  try {
    if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) throw new Error();
  } catch { throw new ConfigError('Invalid DATABASE_URL'); }
  const databaseCa = env['DATABASE_SSL_CA']?.trim();
  if (databaseCa) {
    try {
      if (!new X509Certificate(databaseCa).ca) throw new Error();
    } catch { throw new ConfigError('Invalid DATABASE_SSL_CA'); }
  }
  try {
    const url = new URL(supabaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error();
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error();
  } catch { throw new ConfigError('Invalid SUPABASE_URL'); }
  let jwks: ManagedConfig['jwks'];
  let cookieKeys: string[];
  try {
    jwks = JSON.parse(required('OIDC_JWKS_JSON')) as ManagedConfig['jwks'];
    if (!Array.isArray(jwks.keys) || !jwks.keys.length || !jwks.keys.every((key) => typeof key.d === 'string' && key.alg === 'EdDSA' && key.crv === 'Ed25519')) throw new Error();
  } catch { throw new ConfigError('Invalid or missing OIDC_JWKS_JSON'); }
  try {
    cookieKeys = JSON.parse(required('OIDC_COOKIE_KEYS')) as string[];
    if (!Array.isArray(cookieKeys) || cookieKeys.length < 2 || !cookieKeys.every((key) => typeof key === 'string' && key.length >= 32)) throw new Error();
  } catch { throw new ConfigError('Invalid or missing OIDC_COOKIE_KEYS'); }
  return { databaseUrl, ...(databaseCa ? { databaseCa } : {}), supabaseUrl, supabaseAnonKey: required('SUPABASE_ANON_KEY'), supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'), jwks, cookieKeys };
}
