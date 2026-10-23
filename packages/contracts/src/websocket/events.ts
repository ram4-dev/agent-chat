import { isPlainObject } from '../domain/auth.js';
import { parseMessageView, type MessageView } from '../http/messages.js';

/**
 * Event envelopes shared by the browser socket and the agent receiver socket.
 *
 * Both sockets deliver already-committed identifiers and projections; neither
 * is authoritative storage, so a missed frame is always recoverable by reading
 * the durable surfaces again.
 */
export const BROWSER_SOCKET_PATH = '/ws/browser';
export const AGENT_SOCKET_PATH = '/ws/agent';

export const BROWSER_EVENT_TYPES = [
  'ready',
  'message.created',
  'group.membership.changed',
  'agent.connection.changed',
] as const;

export type BrowserEventType = (typeof BROWSER_EVENT_TYPES)[number];

export interface ReadyEvent {
  type: 'ready';
  groupIds: string[];
}

export interface MessageCreatedEvent {
  type: 'message.created';
  message: MessageView;
}

export interface MembershipChangedEvent {
  type: 'group.membership.changed';
  groupId: string;
}

export interface AgentConnectionChangedEvent {
  type: 'agent.connection.changed';
  agentId: string;
}

export type BrowserEvent =
  | ReadyEvent
  | MessageCreatedEvent
  | MembershipChangedEvent
  | AgentConnectionChangedEvent;

export function parseBrowserEvent(raw: unknown): BrowserEvent | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }

  switch (raw['type']) {
    case 'ready':
      return Array.isArray(raw['groupIds']) &&
        raw['groupIds'].every((id) => typeof id === 'string')
        ? { type: 'ready', groupIds: raw['groupIds'] as string[] }
        : undefined;
    case 'message.created': {
      const message = parseMessageView(raw['message']);
      return message.ok ? { type: 'message.created', message: message.value } : undefined;
    }
    case 'group.membership.changed':
      return typeof raw['groupId'] === 'string'
        ? { type: 'group.membership.changed', groupId: raw['groupId'] }
        : undefined;
    case 'agent.connection.changed':
      return typeof raw['agentId'] === 'string'
        ? { type: 'agent.connection.changed', agentId: raw['agentId'] }
        : undefined;
    default:
      return undefined;
  }
}

export type AgentReceiverEvent =
  | { type: 'receiver.ready'; agent_id: string; connection_id: string }
  | { type: 'inbox.event'; event_id: string; sequence: number; group_id: string; message: MessageView; created_at: string };
