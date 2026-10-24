import type { PublicUser } from '@agent-chat/contracts';
import { DomainError } from '../modules/errors.js';
import { ConfirmationRequiredError, type AuthModule, type AuthenticatedUser } from '../modules/auth/index.js';
import { createSessionToken, hashSessionToken, isPlausibleSessionToken, sessionExpiryFrom } from '../modules/auth/session.js';
import type { AsyncPort } from '../services.js';
import type { ManagedDatabase } from './database.js';

export interface SupabaseAuthConfig { url: string; anonKey: string; publicOrigin: string }
interface SupabaseUser { id: string; email?: string; user_metadata?: { display_name?: string }; created_at: string }
interface SupabaseAuthResponse { user?: SupabaseUser; access_token?: string }

export function createManagedHumanAuth(db: ManagedDatabase, config: SupabaseAuthConfig): AsyncPort<AuthModule> {
  async function request(path: string, body: object): Promise<SupabaseAuthResponse> {
    let response: Response;
    try {
      response = await fetch(`${config.url}/auth/v1/${path}`, {
        method: 'POST', headers: { apikey: config.anonKey, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new DomainError('temporarily_unavailable', 503, 'Identity service unavailable'); }
    if (!response.ok) {
      if (response.status === 429) throw new DomainError('rate_limited', 429, 'Identity rate limit');
      throw new DomainError('unauthenticated', 401, 'Credentials rejected');
    }
    return await response.json() as SupabaseAuthResponse;
  }

  async function issue(result: SupabaseAuthResponse, displayName?: string): Promise<AuthenticatedUser> {
    // Supabase deliberately returns no authenticated session before email confirmation.
    if (!result.access_token || !result.user) throw new ConfirmationRequiredError();
    const account = result.user;
    if (!account.email) throw new DomainError('unauthenticated', 401, 'Identity incomplete');
    const email = account.email.toLowerCase();
    const token = createSessionToken();
    const user = await db.transaction(async () => {
      const row = await db.one<PublicUser>(`INSERT INTO users(id,email,password_hash,display_name,created_at)
        VALUES($1,$2,'!supabase-managed!',$3,$4) ON CONFLICT(id) DO UPDATE SET email=excluded.email
        RETURNING id,email,display_name AS "displayName",created_at AS "createdAt"`,
      [account.id, email, displayName ?? account.user_metadata?.display_name ?? 'Miembro', account.created_at]);
      await db.rows('INSERT INTO human_sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [hashSessionToken(token), account.id, sessionExpiryFrom(new Date())]);
      return row!;
    });
    return { user, sessionToken: token };
  }
  async function resolve(token: string | undefined): Promise<PublicUser> {
    if (!token || !isPlausibleSessionToken(token)) throw new DomainError('unauthenticated', 401, 'Session required');
    const user = await db.one<PublicUser>(`SELECT u.id,u.email,u.display_name AS "displayName",u.created_at AS "createdAt"
      FROM human_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at>$2`, [hashSessionToken(token), new Date().toISOString()]);
    if (!user) throw new DomainError('unauthenticated', 401, 'Session expired');
    return user;
  }
  return {
    register: async (input) => issue(await request(`signup?redirect_to=${encodeURIComponent(config.publicOrigin)}`, {
      email: input.email, password: input.password, data: { display_name: input.displayName },
    }), input.displayName),
    login: async (input) => issue(await request('token?grant_type=password', input)),
    async logout(token) {
      if (!token || !isPlausibleSessionToken(token)) return;
      await db.rows('UPDATE human_sessions SET revoked_at=$2 WHERE id=$1', [hashSessionToken(token), new Date().toISOString()]);
    },
    async currentUser(token) {
      const user = await resolve(token);
      await db.rows('UPDATE human_sessions SET expires_at=$2 WHERE id=$1 AND revoked_at IS NULL', [hashSessionToken(token!), sessionExpiryFrom(new Date())]);
      return user;
    },
    resolveSession: resolve,
  };
}
