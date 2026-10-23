import type { FastifyInstance } from 'fastify';
import {
  BROWSER_SOCKET_PATH,
  SESSION_COOKIE_NAME,
  type BrowserEvent,
  type PublicUser,
} from '@agent-chat/contracts';
import type { WebSocket } from 'ws';
import type { AuthModule } from '../../modules/auth/index.js';
import type { GroupsModule } from '../../modules/groups/index.js';
import type { LiveDeliveryHub } from '../../realtime/hub.js';
import { isSameOriginRequest } from '../http/origin-guard.js';
import { sendError } from '../http/error-envelope.js';
import { readCookie } from '../http/cookie.js';

export interface BrowserSocketDependencies {
  auth: AuthModule;
  groups: GroupsModule;
  hub: LiveDeliveryHub;
  /** Maximum concurrent sockets for one human session. */
  maxSocketsPerSession: number;
}

/**
 * Browser realtime socket.
 *
 * Origin is checked before upgrade. An invalid session is closed without a
 * private frame. Every delivery rechecks the session and current membership;
 * no client-supplied group subscription can grant access.
 *
 * The socket is an optimization over HTTP: a client that reconnects catches up
 * with a cursor read, so a dropped frame is never lost data.
 */
export function registerBrowserSocket(
  app: FastifyInstance,
  { auth, groups, hub, maxSocketsPerSession }: BrowserSocketDependencies,
): void {
  const openSockets = new Map<string, number>();

  app.get(BROWSER_SOCKET_PATH, { websocket: true, preValidation: async (request, reply) => {
    if (!isSameOriginRequest({ method: 'POST', origin: request.headers.origin, host: request.headers.host })) {
      return sendError(reply, 403, 'forbidden');
    }
  } }, (socket, request) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);

    let user: PublicUser;
    try {
      user = auth.resolveSession(token);
    } catch {
      // Closing without a frame keeps an unauthenticated handshake from
      // learning anything about the endpoint.
      socket.close(4401, 'unauthenticated');
      return;
    }

    const open = openSockets.get(token!) ?? 0;
    if (open >= maxSocketsPerSession) {
      socket.close(4429, 'too many sockets');
      return;
    }
    openSockets.set(token!, open + 1);

    const memberships = groups.listGroups(user.id);
    const groupIds = memberships.map(({ group }) => group.id);
    const authorized = (groupId: string) => {
      try {
        auth.resolveSession(token);
        groups.getGroupDetail({ userId: user.id, groupId });
        return true;
      } catch { return false; }
    };
    const unsubscribers = [
      hub.subscribeMessages((message) => {
        if (authorized(message.groupId)) send(socket, { type: 'message.created', message });
      }),
      hub.subscribeAgentState((agentId) => {
        for (const { group } of groups.listGroups(user.id)) {
          if (authorized(group.id) && groups.getGroupDetail({ userId: user.id, groupId: group.id })
            .members.some((member) => member.kind === 'agent' && member.id === agentId)) {
            send(socket, { type: 'agent.connection.changed', agentId });
            break;
          }
        }
      }),
    ];

    socket.on('close', () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      const remaining = (openSockets.get(token!) ?? 1) - 1;
      if (remaining <= 0) {
        openSockets.delete(token!);
      } else {
        openSockets.set(token!, remaining);
      }
    });

    // The ready frame tells the client which groups it will receive, so the UI
    // never has to guess whether a silent socket is connected or empty.
    send(socket, { type: 'ready', groupIds });
  });
}

function send(socket: WebSocket, event: BrowserEvent): void {
  // 1 is OPEN; anything else would throw and must not break the fan-out.
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(event));
  }
}
