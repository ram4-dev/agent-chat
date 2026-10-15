import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  DOMAIN_ERROR_CODES,
  MESSAGE_PATHS,
  parsePageSize,
  parseSendMessageRequest,
  SESSION_COOKIE_NAME,
  type MessagePage,
} from '@agent-chat/contracts';
import type { AuthModule } from '../../modules/auth/index.js';
import type { MessagingModule } from '../../modules/messaging/index.js';
import type { LiveDeliveryHub } from '../../realtime/hub.js';
import { DomainError } from '../../modules/errors.js';
import { readCookie } from './cookie.js';
import { sendError } from './error-envelope.js';

export interface MessageRoutesDependencies {
  auth: AuthModule;
  messaging: MessagingModule;
  hub: LiveDeliveryHub;
}

/**
 * Human chat routes.
 *
 * The adapter resolves the session and then hands a principal to the module; it
 * never decides membership itself. Live fan-out happens only after the module
 * reports a committed message.
 */
export function registerMessageRoutes(
  app: FastifyInstance,
  { auth, messaging, hub }: MessageRoutesDependencies,
): void {
  app.get<{ Params: { groupId: string }; Querystring: { limit?: string; before?: string } }>(
    '/api/groups/:groupId/messages',
    (request, reply) =>
      run(reply, () => {
        const user = auth.resolveSession(sessionToken(request.headers.cookie));
        const limit = parsePageSize(request.query.limit);
        if (!limit.ok) {
          return sendInvalidInput(reply);
        }

        const before = request.query.before;
        const page = messaging.list({
          author: { kind: 'human', id: user.id },
          groupId: request.params.groupId,
          limit: limit.value,
          ...(before === undefined || before === '' ? {} : { before }),
        });

        return reply.send(page satisfies MessagePage);
      }),
  );

  app.post<{ Params: { groupId: string } }>(
    '/api/groups/:groupId/messages',
    (request, reply) =>
      run(reply, () => {
        const user = auth.resolveSession(sessionToken(request.headers.cookie));
        const body = parseSendMessageRequest(request.body);
        if (!body.ok) {
          return sendInvalidInput(reply);
        }

        const { message, replayed } = messaging.send({
          author: { kind: 'human', id: user.id },
          groupId: request.params.groupId,
          text: body.value.text,
          idempotencyKey: body.value.idempotencyKey,
        });

        // A replayed send already fanned out once; publishing again would show
        // the same message twice in every open socket.
        if (!replayed) {
          hub.publishMessage(message);
        }

        return reply.code(replayed ? 200 : 201).send({ message });
      }),
  );
}

function sessionToken(cookieHeader: string | undefined): string | undefined {
  return readCookie(cookieHeader, SESSION_COOKIE_NAME);
}

async function run<T>(
  reply: FastifyReply,
  handler: () => T | Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof DomainError) {
      return sendError(reply, error.statusCode, error.code);
    }
    throw error;
  }
}

function sendInvalidInput(reply: FastifyReply): FastifyReply {
  return sendError(reply, 400, DOMAIN_ERROR_CODES.invalid_input);
}

export { MESSAGE_PATHS };
