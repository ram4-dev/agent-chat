import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { JWK } from 'jose';
import type { WebSocket } from 'ws';
import { AGENT_SOCKET_PATH, LIMITS, type AgentReceiverEvent } from '@agent-chat/contracts';
import type { ApplicationServices } from '../../services.js';
import { createMcpAuthenticator, type AgentCredential } from '../mcp/auth.js';
import { sendError } from '../http/error-envelope.js';

export function registerAgentSocket(app: FastifyInstance, options: {
  publicJwk: JWK; issuer: string; audience: string; services: ApplicationServices;
}): void {
  const { agents, inbox, hub } = options.services;
  const authorize = createMcpAuthenticator({ ...options, agents });
  const credentials = new WeakMap<FastifyRequest, AgentCredential>();
  // Reserve a slot before accepting the upgrade, including concurrent upgrades.
  const reservations = new Map<string, number>();

  app.get(AGENT_SOCKET_PATH, {
    websocket: true,
    preValidation: async (request, reply) => {
      // This transport accepts credentials only in the Authorization header.
      if (request.url.includes('?')) return sendError(reply, 400, 'invalid_input');
      let credential: AgentCredential;
      try { credential = await authorize(request.headers.authorization); }
      catch { return sendError(reply, 401, 'unauthenticated'); }
      if (options.services.nativeAccess.classify(credential.connectionId)) return sendError(reply, 403, 'forbidden');
      if (!credential.scopes.includes('agent:receive')) return sendError(reply, 403, 'forbidden');
      const id = credential.connectionId;
      if ((reservations.get(id) ?? 0) >= LIMITS.AGENT_RECEIVER_SOCKETS_MAX_PER_CONNECTION) {
        return sendError(reply, 429, 'rate_limited');
      }
      reservations.set(id, (reservations.get(id) ?? 0) + 1);
      credentials.set(request, credential);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const remaining = (reservations.get(id) ?? 1) - 1;
        if (remaining === 0) reservations.delete(id);
        else reservations.set(id, remaining);
      };
      request.raw.socket.once('close', release);
      // Non-upgrade requests must not hold a socket reservation.
      reply.raw.once('finish', release);
    },
  }, (socket, request) => {
    const credential = credentials.get(request)!;
    const { agentId, connectionId } = credential;
    if (options.services.nativeAccess.classify(connectionId)) { socket.close(4401, 'unauthenticated'); return; }
    const expire = setTimeout(() => socket.close(4401, 'unauthenticated'), Math.max(0, credential.expiresAt - Date.now()));
    expire.unref();
    const detach = hub.attachReceiver(agentId, connectionId, () => socket.close(4401, 'unauthenticated'));
    const unsubscribe = hub.subscribeMessages((message) => {
      try {
        const current = agents.resolveActiveConnection(connectionId);
        if (options.services.nativeAccess.classify(connectionId) || Date.now() >= credential.expiresAt || !current.connection.scopes.includes('agent:receive')) {
          socket.close(4401, 'unauthenticated'); return;
        }
      } catch { socket.close(4401, 'unauthenticated'); return; }
      const event = inbox.eventForMessage(agentId, message.id);
      if (event !== undefined) {
        send(socket, {
          type: 'inbox.event', event_id: event.eventId, sequence: event.sequence,
          group_id: event.groupId, message: event.message, created_at: event.createdAt,
        });
      }
    });
    socket.on('message', () => socket.close(4400, 'receive-only transport'));
    socket.on('close', () => { clearTimeout(expire); unsubscribe(); detach(); });
    send(socket, { type: 'receiver.ready', agent_id: agentId, connection_id: connectionId });
  });
}

function send(socket: WebSocket, event: AgentReceiverEvent): void {
  if (socket.readyState !== socket.OPEN) return;
  if (socket.bufferedAmount > LIMITS.WEBSOCKET_FRAME_BYTES) {
    // A slow receiver recovers from MCP; unbounded queues are not durable storage.
    socket.close(4429, 'receiver too slow'); return;
  }
  socket.send(JSON.stringify(event));
}
