import type { MessageView } from '@agent-chat/contracts';

export type MessageListener = (message: MessageView) => void;

export interface LiveDeliveryHub {
  /**
   * Registers a listener for one group.
   *
   * Returns an unsubscribe function; the caller owns its lifetime, so a closed
   * socket cannot keep receiving frames.
   */
  subscribe(groupId: string, listener: MessageListener): () => void;
  /**
   * Delivers an already-committed message.
   *
   * Delivery happens after the transaction commits, so a listener can never
   * observe a message that a later failure would roll back.
   */
  publishMessage(message: MessageView): void;
  subscribeMessages(listener: MessageListener): () => void;
  notifyAgentState(agentId: string): void;
  subscribeAgentState(listener: (agentId: string) => void): () => void;
  receiverCount(connectionId: string): number;
  receiverIsConnected(agentId: string): boolean;
  attachReceiver(agentId: string, connectionId: string, close: () => void): () => void;
  closeReceivers(target: { agentId?: string; connectionId?: string }): void;
}

/**
 * In-process fan-out.
 *
 * It is deliberately not storage: a listener that missed a frame recovers by
 * reading the durable message list, and a process restart loses only undelivered
 * frames, never messages. A listener that throws is dropped for that frame
 * instead of breaking delivery to the others.
 */
export function createLiveDeliveryHub(): LiveDeliveryHub {
  const listeners = new Map<string, Set<MessageListener>>();

  const allMessages = new Set<MessageListener>();
  const agentState = new Set<(agentId: string) => void>();
  const receivers = new Set<{ agentId: string; connectionId: string; close(): void }>();
  const changed = (agentId: string) => {
    for (const listener of agentState) listener(agentId);
  };

  return {
    notifyAgentState: changed,
    subscribeMessages(listener) {
      allMessages.add(listener);
      return () => { allMessages.delete(listener); };
    },
    subscribeAgentState(listener) {
      agentState.add(listener);
      return () => { agentState.delete(listener); };
    },
    receiverCount(connectionId) {
      return [...receivers].filter((r) => r.connectionId === connectionId).length;
    },
    receiverIsConnected(agentId) {
      return [...receivers].some((r) => r.agentId === agentId);
    },
    attachReceiver(agentId, connectionId, close) {
      const receiver = { agentId, connectionId, close };
      receivers.add(receiver);
      changed(agentId);
      return () => { if (receivers.delete(receiver)) changed(agentId); };
    },
    closeReceivers(target) {
      for (const receiver of receivers) {
        if ((target.agentId !== undefined && receiver.agentId === target.agentId) ||
            (target.connectionId !== undefined && receiver.connectionId === target.connectionId)) {
          receivers.delete(receiver);
          receiver.close();
          changed(receiver.agentId);
        }
      }
    },
    subscribe(groupId, listener) {
      const group = listeners.get(groupId) ?? new Set<MessageListener>();
      group.add(listener);
      listeners.set(groupId, group);

      return () => {
        group.delete(listener);
        if (group.size === 0) {
          listeners.delete(groupId);
        }
      };
    },

    publishMessage(message) {
      for (const listener of [...(listeners.get(message.groupId) ?? []), ...allMessages]) {
        try {
          listener(message);
        } catch {
          // One failing listener must not stop the others.
        }
      }
    },
  };
}
