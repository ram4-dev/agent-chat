import type { FastifyInstance } from 'fastify';
import {
  BROWSER_SOCKET_PATH,
  SESSION_COOKIE_NAME,
  type BrowserEvent,
} from '@agent-chat/contracts';
import type { AuthModule } from '../../modules/auth/index.js';
import type { GroupsModule } from '../../modules/groups/index.js';
import type { LiveDeliveryHub } from '../../realtime/hub.js';
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
 * Authentication happens on the upgrade, so an unauthenticated socket is never
 * established. The server subscribes only to the groups the session belongs to
 * at connection time and never trusts a client-supplied group id.
 *
 * The socket is an optimization over HTTP: a client that reconnects catches up
 * with a cursor read, so a dropped frame is never lost data.
 */
export function registerBrowserSocket(
  app: FastifyInstance,
  { auth, groups, hub, maxSocketsPerSession }: BrowserSocketDependencies,
): void {
  const openSockets = new Map<string, number>();

  app.get(BROWSER_SOCKET_PATH, { websocket: true }, (socket, request) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);

    let user;
    try {
      user = auth.resolveSession(token);
    } catch {
      // Closing without a frame keeps an unauthenticated handshake from
      // learning anything about the endpoint.
      socket.close(4401, 'unauthenticated');
      return;
    }

    const open = openSockets.get(user.id) ?? 0;
    if (open >= maxSocketsPerSession) {
      socket.close(4429, 'too many sockets');
      return;
    }
    openSockets.set(user.id, open + 1);

    const memberships = groups.listGroups(user.id);
    const groupIds = memberships.map(({ group }) => group.id);
    const unsubscribers = groupIds.map((groupId) =>
      hub.subscribe(groupId, (message) => {
        send(socket, { type: 'message.created', message });
      }),
    );

    socket.on('close', () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      const remaining = (openSockets.get(user.id) ?? 1) - 1;
      if (remaining <= 0) {
        openSockets.delete(user.id);
      } else {
        openSockets.set(user.id, remaining);
      }
    });

    // The ready frame tells the client which groups it will receive, so the UI
    // never has to guess whether a silent socket is connected or empty.
    send(socket, { type: 'ready', groupIds });
  });
}

function send(socket: { send(data: string): void; readyState: number }, event: BrowserEvent): void {
  // 1 is OPEN; anything else would throw and must not break the fan-out.
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(event));
  }
}
