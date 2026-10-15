import { useEffect, useState, type FormEvent } from 'react';
import { BROWSER_SOCKET_PATH, type MessageView } from '@agent-chat/contracts';
import {
  loadMessages,
  mergeMessage,
  parseIncomingFrame,
  sendMessage,
  type ChatState,
} from './transport';

export interface ChatPanelProps {
  groupId: string;
  groupName: string;
  chat: ChatState;
  onSend(text: string): void;
}

/**
 * Presentational chat surface for one group.
 *
 * It renders the messages it is given and owns only the draft text. Ordering,
 * merging, and the socket live in the container.
 */
export function ChatPanel({ groupId, groupName, chat, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');

  return (
    <section aria-label={`Chat in ${groupName}`} data-group-id={groupId}>
      <h3>{groupName}</h3>
      <p role="status">{describeChat(chat)}</p>
      {chat.status === 'ready' && (
        <ul aria-label="Messages">
          {chat.messages.map((message) => (
            <li key={message.id} data-message-id={message.id}>
              <strong>{describeAuthor(message)}</strong>: {message.text}
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSend(draft);
          setDraft('');
        }}
      >
        <label htmlFor="chatMessage">Message</label>
        <input
          id="chatMessage"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}

/**
 * Container for one group's conversation.
 *
 * It opens the browser socket, merges live frames into the list, and re-reads
 * the durable HTTP list on every (re)connect. That is what makes the socket an
 * optimization: a frame that never arrived is recovered from storage instead of
 * being silently lost.
 */
export function ChatContainer({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [chat, setChat] = useState<ChatState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      const state = await loadMessages(groupId);
      if (!cancelled && state.status === 'ready') {
        setChat(state);
      }
    };

    void refresh();

    const socket = new WebSocket(
      `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${BROWSER_SOCKET_PATH}`,
    );

    socket.addEventListener('open', () => {
      void refresh();
    });

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const incoming = parseIncomingFrame(safeJson(event.data));
      if (incoming === undefined || incoming.groupId !== groupId || cancelled) {
        return;
      }
      setChat((current) =>
        current.status === 'ready'
          ? { ...current, messages: mergeMessage(current.messages, incoming) }
          : current,
      );
    });

    return () => {
      cancelled = true;
      socket.close();
    };
  }, [groupId]);

  return (
    <ChatPanel
      groupId={groupId}
      groupName={groupName}
      chat={chat}
      onSend={(text) => {
        if (text.trim() === '') {
          return;
        }
        // The socket normally delivers the committed message; re-reading covers
        // the case where it was sent while the socket was down.
        void sendMessage(groupId, text).then((outcome) => {
          if (outcome.ok) {
            void loadMessages(groupId).then((state) => {
              if (state.status === 'ready') {
                setChat(state);
              }
            });
          }
        });
      }}
    />
  );
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** An agent is always shown with its owner, never as its owner. */
export function describeAuthor(message: MessageView): string {
  return message.author.kind === 'agent'
    ? `${message.author.displayName} (agent of ${message.author.ownerDisplayName})`
    : message.author.displayName;
}

export function describeChat(chat: ChatState): string {
  switch (chat.status) {
    case 'idle':
      return 'Select a group to read its messages.';
    case 'loading':
      return 'Loading messages…';
    case 'ready':
      return chat.messages.length === 0
        ? 'No messages yet.'
        : `${chat.messages.length} message(s).`;
    case 'error':
      return 'Messages could not be loaded.';
  }
}
