import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isPlainObject, validateEmail, validatePassword } from '@agent-chat/contracts';
import { sendError } from '../adapters/http/error-envelope.js';
import type { SupabaseAuthConfig } from './human-auth.js';
import type { ManagedDatabase } from './database.js';

export function registerManagedRecovery(app: FastifyInstance, db: ManagedDatabase, config: SupabaseAuthConfig) {
  const headers = { apikey: config.anonKey, 'content-type': 'application/json' };
  app.post('/api/auth/recover', async (request, reply) => {
    const parsed = validateEmail(isPlainObject(request.body) ? request.body['email'] : undefined);
    if (!parsed.ok) return sendError(reply, 400, 'invalid_input');
    try {
      const response = await fetch(`${config.url}/auth/v1/recover?redirect_to=${encodeURIComponent(`${config.publicOrigin}/?recovery=1`)}`, {
        method: 'POST', headers, body: JSON.stringify({ email: parsed.value }), signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 429) return sendError(reply, 429, 'rate_limited');
      if (!response.ok && response.status >= 500) return sendError(reply, 503, 'temporarily_unavailable');
      // Do not distinguish nonexistent accounts or their confirmation state.
      return { status: 'sent_if_registered' };
    } catch { return sendError(reply, 503, 'temporarily_unavailable'); }
  });
  app.post('/api/auth/reset-password', async (request, reply) => {
    if (!isPlainObject(request.body)) return sendError(reply, 400, 'invalid_input');
    const password = validatePassword(request.body['password']);
    const token = request.body['accessToken'];
    if (!password.ok || typeof token !== 'string' || token.length > 20_000) return sendError(reply, 400, 'invalid_input');
    const authenticated = { ...headers, authorization: `Bearer ${token}` };
    try {
      const verified = await fetch(`${config.url}/auth/v1/user`, { headers: authenticated, signal: AbortSignal.timeout(10_000) });
      if (!verified.ok) return sendError(reply, 401, 'unauthenticated');
      const user = await verified.json() as { id?: string };
      if (typeof user.id !== 'string') return sendError(reply, 401, 'unauthenticated');
      const claimed = await db.transaction(async () => {
        const use = await db.one('INSERT INTO password_reset_uses(token_hash,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING token_hash', [createHash('sha256').update(token).digest('hex'), user.id]);
        if (!use) return false;
        // Revoke application sessions before the remote mutation. An ambiguous network
        // failure can require another recovery link, but cannot retain an old session.
        await db.rows('UPDATE human_sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL', [user.id, new Date().toISOString()]);
        return true;
      });
      if (!claimed) return sendError(reply, 401, 'unauthenticated');
      const updated = await fetch(`${config.url}/auth/v1/user`, {
        method: 'PUT', headers: authenticated, body: JSON.stringify({ password: password.value }), signal: AbortSignal.timeout(10_000),
      });
      if (!updated.ok) return sendError(reply, updated.status >= 500 ? 503 : 400, updated.status >= 500 ? 'temporarily_unavailable' : 'invalid_input');
      return { status: 'password_updated' };
    } catch { return sendError(reply, 503, 'temporarily_unavailable'); }
  });
}
