import { createPublicKey } from 'node:crypto';
import { nativeProofSchema } from '../../modules/native-delivery/schema.js';
import { z } from 'zod';
import { NATIVE_AUTOMATIC_SCOPES, NATIVE_INTERACTIVE_SCOPES, NATIVE_PROVIDERS, SESSION_COOKIE_NAME } from '@agent-chat/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ApplicationServices } from '../../services.js';
import { DomainError } from '../../modules/errors.js';
import { readCookie } from './cookie.js';
import { sendError } from './error-envelope.js';

const selection = z.object({ agentId: z.string().uuid(), groupIds: z.array(z.string().uuid()).min(1).max(20) }).strict();
const consentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('automatic'), connectionId: z.string().uuid(), bindingId: z.string().uuid(),
    revision: z.number().int().positive(), targetId: z.string().uuid(), scopes: z.array(z.enum(NATIVE_AUTOMATIC_SCOPES)).min(1) }).strict(),
  z.object({ kind: z.literal('interactive'), connectionId: z.string().uuid(),
    selections: z.array(selection).min(1).max(20), scopes: z.array(z.enum(NATIVE_INTERACTIVE_SCOPES)).min(1) }).strict(),
]);
const targetSchema = z.object({ provider: z.enum(NATIVE_PROVIDERS).exclude(['legacy_codex']), connectorId: z.string().trim().min(1).max(200),
  nativeRef: z.string().trim().min(1).max(500), contextMode: z.enum(['native_per_group', 'shared_bot_context', 'unsupported']), proofPublicKey: z.string().max(1000).optional() }).strict();
const bindingSchema = z.object({ agentId: z.string().uuid(), targetId: z.string().uuid(), groupIds: z.array(z.string().uuid()).min(1).max(20) }).strict();
const restrictSchema = z.object({ scopes: z.array(z.enum([...NATIVE_AUTOMATIC_SCOPES, 'native:send'])), selections: z.array(selection).max(20) }).strict();

export function registerNativeAccessRoutes(app: FastifyInstance, { auth, nativeAccess, nativeDelivery }: Pick<ApplicationServices, 'auth'> & Required<Pick<ApplicationServices, 'nativeAccess' | 'nativeDelivery'>>): void {
  const owner = async (cookie?: string) => (await auth.resolveSession(readCookie(cookie, SESSION_COOKIE_NAME))).id;
  app.patch<{ Params: { bindingId: string } }>('/api/native/bindings/:bindingId', (request, reply) => run(reply, async () => {
    const parsed = z.object({ enabled: z.boolean(), revision: z.number().int().positive() }).strict().safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_input');
    return nativeDelivery.configureOwner(await owner(request.headers.cookie), request.params.bindingId, parsed.data.revision, parsed.data.enabled);
  }));
  app.post<{ Params: { eventId: string } }>('/api/native/deliveries/:eventId/cancel', (request, reply) => run(reply, async () => nativeDelivery.cancelOwner(await owner(request.headers.cookie), request.params.eventId)));
  app.post<{ Params: { eventId: string } }>('/api/native/deliveries/:eventId/suppress', (request, reply) => run(reply, async () => nativeDelivery.suppressOwner(await owner(request.headers.cookie), request.params.eventId)));
  // Provider-signed evidence is the sole authority here: no read, publish or generation operation.
  app.post('/native/reconcile', (request, reply) => run(reply, async () => {
    const parsed = nativeProofSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_input');
    return nativeDelivery.reconcile(parsed.data);
  }));
  app.post('/api/native/targets', (request, reply) => run(reply, async () => {
    const ownerUserId = await owner(request.headers.cookie);
    const parsed = targetSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_input');
    if (parsed.data.proofPublicKey) {
      try { if (createPublicKey(parsed.data.proofPublicKey).asymmetricKeyType !== 'ed25519') return sendError(reply, 400, 'invalid_input'); }
      catch { return sendError(reply, 400, 'invalid_input'); }
    }
    const id = crypto.randomUUID();
    nativeAccess.repository.registerTarget({ ...parsed.data, id, ownerUserId });
    if (parsed.data.proofPublicKey) nativeAccess.setProofKey(ownerUserId, id, parsed.data.proofPublicKey);
    return reply.code(201).send({ target: nativeAccess.repository.findTarget(ownerUserId, id) });
  }));
  app.post('/api/native/bindings', (request, reply) => run(reply, async () => {
    const ownerUserId = await owner(request.headers.cookie);
    const parsed = bindingSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_input');
    const input = parsed.data;
    return reply.code(201).send({ binding: nativeAccess.createOwnedBinding(ownerUserId, input) });
  }));
  app.post('/api/native/pairings', (request, reply) => run(reply, async () => {
    const ownerUserId = await owner(request.headers.cookie);
    const parsed = consentSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_input');
    return reply.code(201).send(nativeAccess.createChallenge(ownerUserId, parsed.data));
  }));
  app.patch<{ Params: { grantId: string } }>('/api/native/grants/:grantId', (request, reply) => run(reply, async () => {
    const ownerUserId = await owner(request.headers.cookie);
    const parsed = restrictSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_input');
    return { grant: nativeAccess.restrict(ownerUserId, request.params.grantId, parsed.data.scopes, parsed.data.selections) };
  }));
  app.delete<{ Params: { grantId: string } }>('/api/native/grants/:grantId', (request, reply) => run(reply, async () => {
    nativeAccess.revoke(await owner(request.headers.cookie), request.params.grantId);
    return { status: 'revoked' };
  }));
}
async function run<T>(reply: FastifyReply, operation: () => T | Promise<T>): Promise<T | FastifyReply> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof DomainError) return sendError(reply, error.statusCode, error.code);
    if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT')) return sendError(reply, 409, 'conflict');
    throw error;
  }
}
