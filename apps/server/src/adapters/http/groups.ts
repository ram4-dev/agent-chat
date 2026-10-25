import type { AutomationModule } from '../../modules/automation/index.js';
import type { NativeStatusModule } from '../../modules/native-status/index.js';
import type { NotificationsModule } from '../../notifications/module.js';
import type { AsyncPort } from "../../services.js";
import type { FastifyInstance, FastifyReply } from 'fastify';
import { DOMAIN_ERROR_CODES, GROUP_PATHS, parseAcceptInvitationRequest, parseCreateGroupRequest, parseGroupReadRequest, type AcceptedInvitationResponse, type CreateGroupResponse, type GroupDetailResponse, type GroupListResponse, type InvitationResponse, type OkResponse, } from '@agent-chat/contracts';
import type { AuthModule } from '../../modules/auth/index.js';
import type { ApplicationHub } from '../../services.js';
import type { GroupsModule } from '../../modules/groups/index.js';
import { DomainError } from '../../modules/errors.js';
import { readCookie } from './cookie.js';
import { sendError } from './error-envelope.js';
import { SESSION_COOKIE_NAME } from '@agent-chat/contracts';
export interface GroupRoutesDependencies {
    auth: AsyncPort<AuthModule>;
    groups: AsyncPort<GroupsModule>;
    hub: ApplicationHub;
    automation?: AutomationModule;
    nativeStatus?: NativeStatusModule; notifications?: NotificationsModule;
}
/**
 * The private-group routes.
 *
 * Every route resolves the session first, then delegates the authorization
 * decision to the module: the adapter never decides whether a caller may see a
 * group, so a new route cannot forget a membership check.
 */
export function registerGroupRoutes(app: FastifyInstance, { auth, groups, hub, automation, nativeStatus, notifications }: GroupRoutesDependencies): void {
    const session = async (request: {
        headers: {
            cookie?: string;
        };
    }): Promise<string> => (await auth.resolveSession(readCookie(request.headers.cookie, SESSION_COOKIE_NAME))).id;
    app.post(GROUP_PATHS.collection, (request, reply) => run(reply, async () => {
        const body = parseCreateGroupRequest(request.body);
        if (!body.ok) {
            return sendInvalidInput(reply);
        }
        const created = await groups.createGroup({ userId: await session(request), name: body.value.name });
        return reply.code(201).send({
            group: {
                id: created.group.id,
                name: created.group.name,
                createdAt: created.group.createdAt,
            },
            role: created.role,
        } satisfies CreateGroupResponse);
    }));
    app.get(GROUP_PATHS.collection, (request, reply) => run(reply, async () => {
        const userId = await session(request);
        return reply.send({
            groups: await (await groups.listGroups(userId)).map(({ group, role, activity }) => ({
                id: group.id,
                name: group.name,
                createdAt: group.createdAt,
                role,
                ...(activity ? { activity } : {}),
            })),
        } satisfies GroupListResponse);
    }));
    app.post<{ Params: { groupId: string } }>('/api/groups/:groupId/read', (request, reply) => run(reply, async () => {
        const userId = await session(request);
        const parsed = parseGroupReadRequest(request.body);
        if (!parsed.ok) return sendInvalidInput(reply);
        await groups.markMessagesRead({ userId, groupId: request.params.groupId, messageIds: parsed.value.messageIds });
        return reply.send({ status: 'ok' } satisfies OkResponse);
    }));
    app.get<{
        Params: {
            groupId: string;
        };
    }>('/api/groups/:groupId', (request, reply) => run(reply, async () => {
        const userId = await session(request);
        const detail = await groups.getGroupDetail({ userId, groupId: request.params.groupId });
        return reply.send({
            group: {
                id: detail.group.id,
                name: detail.group.name,
                createdAt: detail.group.createdAt,
            },
            members: await Promise.all(detail.members.map(async (member) => member.kind === 'agent'
                ? { ...member, ...(notifications?{notificationActive:await notifications.isActive(member.id)}:{}), ...(nativeStatus?.hasBinding(member.id) ? { nativeReceiverConfigured: true } : {}), receiverConnected: await hub.receiverIsConnected(member.id) || automation?.groupConnected(member.id, request.params.groupId) === true } : member)),
            role: detail.role,
        } satisfies GroupDetailResponse);
    }));
    app.post<{
        Params: {
            groupId: string;
        };
    }>('/api/groups/:groupId/invitations', (request, reply) => run(reply, async () => {
        const userId = await session(request);
        const invitation = await groups.createInvitation({ userId, groupId: request.params.groupId });
        return reply.code(201).send(invitation satisfies InvitationResponse);
    }));
    app.post(GROUP_PATHS.acceptInvitation, (request, reply) => run(reply, async () => {
        const body = parseAcceptInvitationRequest(request.body);
        if (!body.ok) {
            return sendInvalidInput(reply);
        }
        const accepted = await groups.acceptInvitation({
            userId: await session(request),
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
    }));
    app.post<{
        Params: {
            groupId: string;
            agentId: string;
        };
    }>('/api/groups/:groupId/agents/:agentId', (request, reply) => run(reply, async () => {
        const userId = await session(request);
        const admitted = await groups.admitAgent({
            userId,
            groupId: request.params.groupId,
            agentId: request.params.agentId,
        });
        return reply.code(admitted.alreadyMember ? 200 : 201).send(admitted);
    }));
    app.delete<{
        Params: {
            groupId: string;
            agentId: string;
        };
    }>('/api/groups/:groupId/agents/:agentId', (request, reply) => run(reply, async () => {
        const userId = await session(request);
        await groups.removeAgentMember({
            userId,
            groupId: request.params.groupId,
            agentId: request.params.agentId,
        });
        return reply.send({ status: 'ok' } satisfies OkResponse);
    }));
    app.delete<{
        Params: {
            groupId: string;
            memberId: string;
        };
    }>('/api/groups/:groupId/members/:memberId', (request, reply) => run(reply, async () => {
        const userId = await session(request);
        await groups.removeHumanMember({
            userId,
            groupId: request.params.groupId,
            memberId: request.params.memberId,
        });
        return reply.send({ status: 'ok' } satisfies OkResponse);
    }));
}
async function run<T>(reply: FastifyReply, handler: () => T | Promise<T>): Promise<T | FastifyReply> {
    try {
        return await handler();
    }
    catch (error) {
        if (error instanceof DomainError) {
            return sendError(reply, error.statusCode, error.code);
        }
        throw error;
    }
}
function sendInvalidInput(reply: FastifyReply): FastifyReply {
    return sendError(reply, 400, DOMAIN_ERROR_CODES.invalid_input);
}
