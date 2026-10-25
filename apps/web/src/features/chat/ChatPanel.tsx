import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BROWSER_SOCKET_PATH,
  type MessageView,
  type PublicUser,
  type AgentMember,
} from "@agent-chat/contracts";
import {
  loadMessages,
  mergeMessage,
  parseIncomingFrame,
  sendMessage,
  type ChatState,
} from "./transport";
import { Avatar, Icon } from "../../shared/ui";

import { useChatDraft, updateDraft, submitDraft, discardDraft } from "./drafts";
import { mentionQuery, mentionStarts, reconcileMentions, unresolvedMentions, type MentionEdit } from "./mentions";
import { useDisplayedMessages } from "./useDisplayedMessages";
import { MessageMarkdown } from "./MessageMarkdown";
import "./chat.css";
export { clearUserDrafts } from "./drafts";

export function ChatPanel({
  groupId,
  groupName,
  agents = [],
  user,
  chat,
  live,
  onSend,
  onRetry,
  onOlder,
  onMessagesDisplayed,
}: {
  groupId: string;
  groupName: string;
  agents?: AgentMember[];
  user: PublicUser;
  chat: ChatState;
  live: boolean;
  onSend(text: string, mentionedAgentIds: string[], idempotencyKey: string): Promise<boolean>;
  onRetry(): void;
  onOlder(): Promise<void>;
  onMessagesDisplayed?: (messageIds: readonly string[]) => void;
}) {
  const stored = useChatDraft(user.id, groupId);
  const { text: draft, mentions, sending } = stored;
  const [storedQuery, setQuery] = useState<ReturnType<typeof mentionQuery>>();
  const query = storedQuery && draft.slice(storedQuery.start + 1, storedQuery.end) === storedQuery.text && draft[storedQuery.start] === "@" ? storedQuery : undefined;
  const [choice, setChoice] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const edit = useRef<(MentionEdit & { before: string }) | undefined>(undefined);
  useEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    const capture = (event: InputEvent) => {
      let start = textarea.selectionStart, end = textarea.selectionEnd;
      if (start === end && event.inputType === 'deleteContentBackward') start = Math.max(0, start - 1);
      else if (start === end && event.inputType === 'deleteContentForward') end = Math.min(textarea.value.length, end + 1);
      // Word/line deletion and composition ranges vary by browser; conservative reconciliation is safer.
      const known = ['insertText', 'insertFromPaste', 'insertReplacementText', 'insertLineBreak', 'insertParagraph', 'deleteContentBackward', 'deleteContentForward', 'deleteByCut'].includes(event.inputType);
      edit.current = known ? { before: textarea.value, start, end } : undefined;
    };
    textarea.addEventListener('beforeinput', capture);
    return () => textarea.removeEventListener('beforeinput', capture);
  }, []);
  const caret = useRef<{text:string;position:number}|undefined>(undefined);
  useLayoutEffect(()=>{
    const next=caret.current;caret.current=undefined;
    if(next&&input.current?.value===next.text){input.current.focus();input.current.setSelectionRange(next.position,next.position);}
  },[draft]);
  const starts = mentionStarts(draft);
  const selected = mentions.filter(mention => starts.includes(mention.start) && agents.some(agent => agent.id === mention.id));
  const unresolved = unresolvedMentions(draft, selected);
  const choices = query ? agents.filter(agent => !mentions.some(item=>item.id===agent.id) && agent.displayName.toLocaleLowerCase().includes(query.text.toLocaleLowerCase())).slice(0,20) : [];
  function changeDraft(text:string, position:number) {
    caret.current=undefined;
    const range = edit.current;
    edit.current = undefined;
    const next = reconcileMentions(draft, text, mentions, range?.before === draft ? range : undefined);
    updateDraft(user.id, groupId, text, next);
    setQuery(mentionQuery(text, position, next));
    setError("");
    setChoice(0);
  }
  function choose(agent:AgentMember) {
    if(!query || mentions.length>=20)return;
    const label=`@${agent.displayName}`;
    const trailing = /^[*_~\]]/u.test(draft.slice(query.end)) ? '' : ' ';
    const text=draft.slice(0,query.start)+label+trailing+draft.slice(query.end);
    caret.current={text,position:query.start+label.length+trailing.length};
    const next = reconcileMentions(draft, text, mentions, { start: query.start, end: query.end });
    updateDraft(user.id, groupId, text, [...next, {id:agent.id,name:agent.displayName,start:query.start,end:query.start+label.length}]);
    setQuery(undefined);setError("");
  }
  function removeMention(id: string) {
    const mention = mentions.find(item => item.id === id);
    if (!mention) return;
    const text = draft.slice(0, mention.start) + draft.slice(mention.start + 1);
    updateDraft(user.id, groupId, text, reconcileMentions(draft, text, mentions.filter(item => item.id !== id), { start: mention.start, end: mention.start + 1 }));
    setQuery(undefined);
  }
  const [older, setOlder] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    if (stick.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [chat]);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || sending || composing.current) return;
    if (unresolved.length) {
      setError("Elegí un bot para cada @ pendiente o quitá la @ antes de enviar.");
      input.current?.focus();
      const start = unresolved[0]!;
      const end = start + 1 + (/^[^\s@*_~\]<>]*/u.exec(draft.slice(start + 1))?.[0].length ?? 0);
      input.current?.setSelectionRange(end, end);
      setQuery(mentionQuery(draft, end, selected));
      setChoice(0);
      return;
    }
    setError("");
    const sent = await submitDraft(user.id, groupId, [...new Set(selected.map(item => item.id))], onSend);
    if (sent) { setQuery(undefined); stick.current = true; }
    else setError("No pudimos enviar el mensaje. Tu borrador sigue acá; volvé a intentar.");
  }
  const messages = useMemo(() => chat.status === "ready" ? [...chat.messages].reverse() : [], [chat]);
  const historyIds = useMemo(() => messages.map(message => message.id), [messages]);
  useDisplayedMessages(list, historyIds, onMessagesDisplayed);
  return (
    <section
      className="chat-area chat-ux"
      aria-label={`Conversación de ${groupName}`}
      data-group-id={groupId}
    >
      <div
        className="message-scroll"
        ref={list}
        onScroll={() => {
          if (list.current)
            stick.current =
              list.current.scrollHeight -
                list.current.scrollTop -
                list.current.clientHeight <
              120;
        }}
      >
        <div className="conversation-start">
          <span className="start-group">#</span>
          <h2>Este es el comienzo de {groupName}</h2>
          <p>Compartí una idea, una pregunta o el próximo paso del equipo.</p>
          <span className="subtle-tag">
            <Icon name="lock" />
            Conversación privada
          </span>
        </div>
        {chat.status === "loading" && (
          <p className="chat-notice" role="status">
            Cargando mensajes…
          </p>
        )}
        {chat.status === "error" && (
          <div className="error-box" role="alert">
            No pudimos cargar los mensajes.
            <button className="text-button" onClick={onRetry}>
              Volver a intentar
            </button>
          </div>
        )}
        {chat.status === "ready" && chat.nextCursor && (
          <button
            className="older-button"
            disabled={older}
            onClick={() => {
              setOlder(true);
              stick.current = false;
              void onOlder().finally(() => setOlder(false));
            }}
          >
            {older ? "Cargando…" : "Ver mensajes anteriores"}
          </button>
        )}
        <ul
          className="messages"
          aria-label="Mensajes"
          aria-live="polite"
          aria-relevant="additions"
        >
          {messages.map((message, index) => {
            const date = new Date(message.createdAt);
            const previous = messages[index - 1];
            const newDay =
              !previous ||
              new Date(previous.createdAt).toDateString() !==
                date.toDateString();
            return (
              <li key={message.id} data-message-id={message.id}>
                {newDay && (
                  <div className="date-divider">
                    <span>
                      {date.toLocaleDateString("es-AR", {
                        day: "numeric",
                        month: "long",
                      })}
                    </span>
                  </div>
                )}
                <article
                  className={`message ${message.author.kind === "agent" ? "message-agent" : ""}`}
                  aria-label={describeAuthor(message)}
                  data-visible-message-id={message.id}
                >
                  <Avatar
                    name={message.author.displayName}
                    bot={message.author.kind === "agent"}
                  />
                  <div className="message-content">
                    <div className="message-meta">
                      <strong>{message.author.displayName}</strong>
                      {message.author.kind === "agent" ? (
                        <>
                          <span className="mini-badge">AGENTE</span>
                          <span className="owner-label">
                            de {message.author.ownerDisplayName}
                          </span>
                        </>
                      ) : (
                        message.author.id === user.id && (
                          <span className="self-label">vos</span>
                        )
                      )}
                      <time
                        dateTime={message.createdAt}
                        title={date.toLocaleString("es-AR")}
                      >
                        {date.toLocaleTimeString("es-AR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <MessageMarkdown text={message.text} />
                    {!!message.mentionedAgentIds?.length && <span className="message-targets">Aviso dirigido a {message.mentionedAgentIds.map(id=>agents.find(agent=>agent.id===id)?.displayName??id).join(', ')}</span>}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="composer-area">
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <div className="chat-recipient-summary" id="recipient-summary" role="status">
          <strong>Avisar a:</strong>{' '}
          {selected.length ? selected.map(item => `${item.name} (${item.id.slice(-6)})`).join(', ')
            : agents.length ? "Todos los bots habilitados del grupo" : "Ningún bot en este grupo"}
          {!!unresolved.length && <span> · Hay menciones pendientes; resolvelas antes de enviar.</span>}
        </div>
        <p id="mention-help" className="mention-help">Escribí @ y elegí un bot. Sin menciones, se avisa a todos los bots del grupo.</p>
        {!!mentions.length && <div className="mention-targets" aria-label="Bots que recibirán el aviso">{mentions.map(item=><button type="button" key={item.id} aria-label={`Quitar mención a ${item.name}`} onClick={()=>removeMention(item.id)}>@{item.name} <small>{item.id.slice(-6)}{!agents.some(agent => agent.id === item.id) && ' · Ya no está en el grupo'}</small> ×</button>)}</div>}
        {query && <div className="mention-options" role="listbox" id="mention-options" aria-label="Agentes para mencionar">{choices.length ? choices.map((agent,index)=><button type="button" role="option" id={`mention-${agent.id}`} key={agent.id} aria-selected={index===choice} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(agent)}><strong>@{agent.displayName}</strong><span>{agent.ownerDisplayName} · {agent.id.slice(-6)}</span></button>) : <p>No hay bots que coincidan en este grupo.</p>}</div>}
        <form
          className="composer"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label className="sr-only" htmlFor="message">
            Mensaje
          </label>
          <textarea
            id="message"
            ref={input}
            role="combobox"
            aria-expanded={!!query}
            aria-controls={query?'mention-options':undefined}
            aria-activedescendant={query&&choices[choice]?`mention-${choices[choice]!.id}`:undefined}
            aria-autocomplete="list"
            aria-describedby="mention-help recipient-summary"
            name="message"
            placeholder={`Escribí en ${groupName}…`}
            rows={2}
            value={draft}
            onChange={(event) => changeDraft(event.target.value,event.target.selectionStart)}
            disabled={chat.status !== "ready"}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => { composing.current = false; changeDraft(event.currentTarget.value, event.currentTarget.selectionStart); }}
            onSelect={(event) => { if (!composing.current) { setQuery(mentionQuery(draft, event.currentTarget.selectionStart, selected)); setChoice(0); } }}
            onKeyDown={(event) => {
              if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
              if(query && !event.nativeEvent.isComposing){
                if(event.key==='Escape'){event.preventDefault();setQuery(undefined);return;}
                if(choices.length && ['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setChoice(index=>(index+(event.key==='ArrowDown'?1:choices.length-1))%choices.length);return;}
                if(choices[choice] && (event.key==='Enter'||event.key==='Tab')){event.preventDefault();choose(choices[choice]!);return;}
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="composer-tools">
            <span>
              <Icon name="lock" />
              Solo para este grupo
            </span>
            <button
              className="send-button"
              type="submit"
              aria-label="Enviar mensaje"
              disabled={!draft.trim() || sending || chat.status !== "ready"}
            >
              <span>{sending ? "Enviando…" : "Enviar"}</span>
              <Icon name="send" />
            </button>
          </div>
        </form>
        <div className="composer-footer">
          <span className={live ? "live-status" : "muted"}>
            <i />
            {live ? "En vivo" : "Reconectando…"}
          </span>
          {!!draft && <button className="chat-discard" type="button" onClick={() => { discardDraft(user.id, groupId); setQuery(undefined); setError(''); }}>Descartar borrador</button>}
          <span>
            Enter para enviar{" "}
            <span className="desktop-only">
              · Shift + Enter para una nueva línea
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

export function ChatContainer({
  onUnauthenticated,
  onMessagesDisplayed,
  groupId,
  groupName,
  agents = [],
  user,
}: {
  onMessagesDisplayed?: (messageIds: readonly string[]) => void;
  onUnauthenticated?: () => void;
  groupId: string;
  groupName: string;
  agents?: AgentMember[];
  user: PublicUser;
}) {
  const [chat, setChat] = useState<ChatState>({ status: "loading" });
  const [live, setLive] = useState(false);
  const alive = useRef(true);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let socket: WebSocket;
    let reconnect: ReturnType<typeof setTimeout>;
    const inFlight = new Set<Map<string, MessageView>>();
    const refresh = async () => {
      const received = new Map<string, MessageView>();
      inFlight.add(received);
      const result = await loadMessages(groupId);
      inFlight.delete(received);
      if (cancelled) return;
      if (result.status === "error" && result.httpStatus === 401) { onUnauthenticated?.(); return; }
      setChat((current) => {
        if (result.status !== "ready" || current.status !== "ready")
          return result;
        const ids = new Set(result.messages.map((m) => m.id));
        const firstOverlap = current.messages.findIndex((message) =>
          ids.has(message.id),
        );
        if (firstOverlap === -1)
          return {
            ...result,
            messages: [...received.values()]
              .reverse()
              .filter((message) => !ids.has(message.id))
              .concat(result.messages),
          };
        const newer = current.messages
          .slice(0, firstOverlap)
          .filter((message) => !ids.has(message.id));
        const older = current.messages
          .slice(firstOverlap)
          .filter((message) => !ids.has(message.id));
        const cursor = older.length ? current.nextCursor : result.nextCursor;
        return {
          status: "ready",
          messages: [...newer, ...result.messages, ...older],
          ...(cursor ? { nextCursor: cursor } : {}),
        };
      });
    };
    refreshRef.current = refresh;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${BROWSER_SOCKET_PATH}`,
      );
      socket.onopen = () => {
        if (!cancelled) {
          setLive(true);
          void refresh();
        }
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        let incoming: MessageView | undefined;
        try {
          const payload: unknown = JSON.parse(event.data);
          incoming = parseIncomingFrame(payload);
        } catch {
          return;
        }
        if (!incoming || incoming.groupId !== groupId || cancelled) return;
        const message = incoming;
        for (const received of inFlight) received.set(message.id, message);
        setChat((current) =>
          current.status === "ready"
            ? { ...current, messages: mergeMessage(current.messages, message) }
            : current,
        );
      };
      socket.onclose = (event) => {
        if (!cancelled && event.code === 4401) { onUnauthenticated?.(); return; }
        if (!cancelled) {
          setLive(false);
          reconnect = setTimeout(connect, 2000);
        }
      };
    };
    void refresh();
    connect();
    return () => {
      cancelled = true;
      alive.current = false;
      clearTimeout(reconnect);
      socket.close();
    };
  }, [groupId, onUnauthenticated]);
  return (
    <ChatPanel
      {...(onMessagesDisplayed ? { onMessagesDisplayed } : {})}
      groupId={groupId}
      groupName={groupName}
      agents={agents}
      user={user}
      chat={chat}
      live={live}
      onRetry={() => refreshRef.current()}
      onOlder={async () => {
        if (chat.status !== "ready" || !chat.nextCursor) return;
        const page = await loadMessages(groupId, fetch, chat.nextCursor);
        if (page.status === "error" && page.httpStatus === 401 && alive.current) onUnauthenticated?.();
        if (page.status === "ready" && alive.current)
          setChat((current) =>
            current.status === "ready"
              ? {
                  ...page,
                  messages: [
                    ...current.messages,
                    ...page.messages.filter(
                      (m) =>
                        !current.messages.some(
                          (existing) => existing.id === m.id,
                        ),
                    ),
                  ],
                }
              : current,
          );
      }}
      onSend={async (text, mentionedAgentIds, idempotencyKey) => {
        const outcome = await sendMessage(
          groupId,
          text,
          fetch,
          idempotencyKey,
          mentionedAgentIds,
        );
        if (!outcome.ok) {
          if (outcome.httpStatus === 401 && alive.current) onUnauthenticated?.();
          return false;
        }
        await refreshRef.current();
        return true;
      }}
    />
  );
}

export function describeAuthor(message: MessageView): string {
  return message.author.kind === "agent"
    ? `${message.author.displayName} (agente de ${message.author.ownerDisplayName})`
    : message.author.displayName;
}
export function describeChat(chat: ChatState): string {
  switch (chat.status) {
    case "idle":
      return "Elegí un grupo para leer sus mensajes.";
    case "loading":
      return "Cargando mensajes…";
    case "ready":
      return chat.messages.length === 0
        ? "Todavía no hay mensajes."
        : `${chat.messages.length} mensaje(s).`;
    case "error":
      return "No pudimos cargar los mensajes.";
  }
}
