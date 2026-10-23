import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  DOMAIN_ERROR_CODES,
  GROUP_PATHS,
  parseAcceptInvitationRequest,
  parseCreateGroupRequest,
  type AcceptedInvitationResponse,
  type CreateGroupResponse,
  type GroupDetailResponse,
  type GroupListResponse,
  type InvitationResponse,
  type OkResponse,
} from '@agent-chat/contracts';
import type { AuthModule } from '../../modules/auth/index.js';
import type { LiveDeliveryHub } from '../../realtime/hub.js';
import type { GroupsModule } from '../../modules/groups/index.js';
import { DomainError } from '../../modules/errors.js';
import { readCookie } from './cookie.js';
import { sendError } from './error-envelope.js';
import { SESSION_COOKIE_NAME } from '@agent-chat/contracts';

export interface GroupRoutesDependencies {
  auth: AuthModule;
  groups: GroupsModule;
  hub: LiveDeliveryHub;
}

/**
 * The private-group routes.
 *
 * Every route resolves the session first, then delegates the authorization
 * decision to the module: the adapter never decides whether a caller may see a
 * group, so a new route cannot forget a membership check.
 */
export function registerGroupRoutes(
  app: FastifyInstance,
  { auth, groups, hub }: GroupRoutesDependencies,
): void {
  const session = (request: { headers: { cookie?: string } }): string =>
    auth.resolveSession(readCookie(request.headers.cookie, SESSION_COOKIE_NAME)).id;

  app.post(GROUP_PATHS.collection, (request, reply) =>
    run(reply, () => {
      const body = parseCreateGroupRequest(request.body);
      if (!body.ok) {
        return sendInvalidInput(reply);
      }

      const created = groups.createGroup({ userId: session(request), name: body.value.name });
      return reply.code(201).send({
        group: {
          id: created.group.id,
          name: created.group.name,
          createdAt: created.group.createdAt,
        },
        role: created.role,
      } satisfies CreateGroupResponse);
    }),
  );

  app.get(GROUP_PATHS.collection, (request, reply) =>
    run(reply, () => {
      const userId = session(request);
      return reply.send({
        groups: groups.listGroups(userId).map(({ group, role }) => ({
          id: group.id,
          name: group.name,
          createdAt: group.createdAt,
          role,
        })),
      } satisfies GroupListResponse);
    }),
  );

  app.get<{ Params: { groupId: string } }>(
    '/api/groups/:groupId',
    (request, reply) =>
      run(reply, () => {
        const userId = session(request);
        const detail = groups.getGroupDetail({ userId, groupId: request.params.groupId });
        return reply.send({
          group: {
            id: detail.group.id,
            name: detail.group.name,
            createdAt: detail.group.createdAt,
          },
          members: detail.members.map((member) => member.kind === 'agent'
            ? { ...member, receiverConnected: hub.receiverIsConnected(member.id) } : member),
          role: detail.role,
        } satisfies GroupDetailResponse);
      }),
  );

  app.post<{ Params: { groupId: string } }>(
    '/api/groups/:groupId/invitations',
    (request, reply) =>
      run(reply, () => {
        const userId = session(request);
        const invitation = groups.createInvitation({ userId, groupId: request.params.groupId });
        return reply.code(201).send(invitation satisfies InvitationResponse);
      }),
  );

  app.post(GROUP_PATHS.acceptInvitation, (request, reply) =>
    run(reply, () => {
      const body = parseAcceptInvitationRequest(request.body);
      if (!body.ok) {
        return sendInvalidInput(reply);
      }

      const accepted = groups.acceptInvitation({
        userId: session(request),
        token: body.value.token,
      });
      return reply.send({
        group: {
          id: accepted.group.id,
          name: accepted.group.name,
          createdAt: accepted.group.createdAt,
        },
        role: accepted.role,
      } satisfies AcceptedInvitationResponse);
    }),
  );

  app.post<{ Params: { groupId: string; agentId: string } }>(
    '/api/groups/:groupId/agents/:agentId',
    (request, reply) =>
      run(reply, () => {
        const userId = session(request);
        const admitted = groups.admitAgent({
          userId,
          groupId: request.params.groupId,
          agentId: request.params.agentId,
        });
        return reply.code(admitted.alreadyMember ? 200 : 201).send(admitted);
      }),
  );

  app.delete<{ Params: { groupId: string; agentId: string } }>(
    '/api/groups/:groupId/agents/:agentId',
    (request, reply) =>
      run(reply, () => {
        const userId = session(request);
        groups.removeAgentMember({
          userId,
          groupId: request.params.groupId,
          agentId: request.params.agentId,
        });
        return reply.send({ status: 'ok' } satisfies OkResponse);
      }),
  );

  app.delete<{ Params: { groupId: string; memberId: string } }>(
    '/api/groups/:groupId/members/:memberId',
    (request, reply) =>
      run(reply, () => {
        const userId = session(request);
        groups.removeHumanMember({
          userId,
          groupId: request.params.groupId,
          memberId: request.params.memberId,
        });
        return reply.send({ status: 'ok' } satisfies OkResponse);
      }),
  );
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
