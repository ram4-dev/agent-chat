import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BROWSER_SOCKET_PATH, SESSION_COOKIE_NAME, type BrowserEvent, type PublicUser } from '@agent-chat/contracts';
import type { WebSocket } from 'ws';
import type { AuthModule } from '../../modules/auth/index.js';
import type { GroupsModule } from '../../modules/groups/index.js';
import type { AsyncPort, ApplicationHub, SocketLeases } from '../../services.js';
import { isSameOriginRequest } from '../http/origin-guard.js';
import { sendError } from '../http/error-envelope.js';
import { readCookie } from '../http/cookie.js';

export interface BrowserSocketDependencies {
  auth: AsyncPort<AuthModule>;
  groups: AsyncPort<GroupsModule>;
  hub: ApplicationHub;
  maxSocketsPerSession: number;
  socketLeases?: SocketLeases;
}

/** Authenticate before upgrade; recheck session and membership before every frame. */
export function registerBrowserSocket(app: FastifyInstance, { auth, groups, hub, maxSocketsPerSession, socketLeases }: BrowserSocketDependencies): void {
  const openSockets = new Map<string, number>();
  const approved = new WeakMap<FastifyRequest, { user: PublicUser; token: string; leaseId: string }>();
  app.get(BROWSER_SOCKET_PATH, {
    websocket: true,
    preValidation: async (request, reply) => {
      if (!isSameOriginRequest({ method: 'POST', origin: request.headers.origin, host: request.headers.host })) return sendError(reply, 403, 'forbidden');
      const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
      let user: PublicUser;
      try { user = await auth.resolveSession(token); }
      catch { return; }
      const leaseId = randomUUID();
      if (socketLeases) {
        const principal = `human:${createHash('sha256').update(token!).digest('hex')}`;
        if (!await socketLeases.reserve(principal, leaseId, maxSocketsPerSession)) return sendError(reply, 429, 'rate_limited');
      } else if ((openSockets.get(token!) ?? 0) >= maxSocketsPerSession) return sendError(reply, 429, 'rate_limited');
      openSockets.set(token!, (openSockets.get(token!) ?? 0) + 1);
      approved.set(request, { user, token: token!, leaseId });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const count = (openSockets.get(token!) ?? 1) - 1;
        if (count <= 0) openSockets.delete(token!); else openSockets.set(token!, count);
        void socketLeases?.release(leaseId).catch(() => {});
      };
      request.raw.socket.once('close', release);
      reply.raw.once('finish', release);
    },
  }, (socket, request) => {
    const approval = approved.get(request);
    if (!approval) { socket.close(4401, 'unauthenticated'); return; }
    const { user, token, leaseId } = approval;
    const authorized = async (groupId: string) => {
      try {
        await auth.resolveSession(token);
        await groups.getGroupDetail({ userId: user.id, groupId });
        return true;
      } catch { return false; }
    };
    const unsubscribe = [
      hub.subscribeMessages(async (message) => {
        if (await authorized(message.groupId)) send(socket, { type: 'message.created', message });
      }),
      hub.subscribeAgentState(async (agentId) => {
        for (const { group } of await groups.listGroups(user.id)) {
          if (await authorized(group.id) && (await groups.getGroupDetail({ userId: user.id, groupId: group.id })).members.some((member) => member.kind === 'agent' && member.id === agentId)) {
            send(socket, { type: 'agent.connection.changed', agentId });
            break;
          }
        }
      }),
    ];
    const heartbeat = socketLeases ? setInterval(() => {
      void (async () => {
        try {
          await auth.resolveSession(token);
          if (!await socketLeases.renew(leaseId)) socket.close(4401, 'unauthenticated');
        } catch { socket.close(4401, 'unauthenticated'); }
      })();
    }, 2000) : undefined;
    heartbeat?.unref();
    socket.once('close', () => { for (const stop of unsubscribe) stop(); if (heartbeat) clearInterval(heartbeat); });
    // Async and synchronous modules share the same adapter during migration.
    Promise.resolve(groups.listGroups(user.id)).then((memberships) => {
      send(socket, { type: 'ready', groupIds: memberships.map(({ group }) => group.id) });
    }).catch(() => socket.close(4401, 'unauthenticated'));
  });
}

function send(socket: WebSocket, event: BrowserEvent): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
}
