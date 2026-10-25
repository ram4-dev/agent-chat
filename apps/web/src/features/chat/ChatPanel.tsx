import { useEffect, useRef, useState, type FormEvent } from "react";
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

function hasMention(text:string,name:string):boolean {
  const label=`@${name}`;
  for(let at=text.indexOf(label);at!==-1;at=text.indexOf(label,at+label.length)){
    const before=text[at-1],after=text[at+label.length];
    if((!before||/\s/u.test(before))&&(!after||/[\s.,!?;:)\]}]/u.test(after)))return true;
  }
  return false;
}

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
}: {
  groupId: string;
  groupName: string;
  agents?: AgentMember[];
  user: PublicUser;
  chat: ChatState;
  live: boolean;
  onSend(text: string, mentionedAgentIds: string[]): Promise<boolean>;
  onRetry(): void;
  onOlder(): Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<Array<{id:string;name:string}>>([]);
  const [query, setQuery] = useState<{start:number;end:number;text:string}>();
  const [choice, setChoice] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const choices = query ? agents.filter(agent => !mentions.some(item=>item.id===agent.id) && agent.displayName.toLocaleLowerCase().includes(query.text.toLocaleLowerCase())).slice(0,20) : [];
  function changeDraft(text:string, caret:number) {
    setDraft(text);
    setMentions(current=>current.filter(item=>hasMention(text,item.name)));
    const match = /(?:^|\s)@([^@\n]{0,60})$/.exec(text.slice(0,caret));
    const tail = match?.[1];
    setQuery(tail !== undefined && !mentions.some(item=>tail.startsWith(item.name+' ')) ? {start:caret-tail.length-1,end:caret,text:tail} : undefined);
    setChoice(0);
  }
  function choose(agent:AgentMember) {
    if(!query || mentions.length>=20)return;
    const label=`@${agent.displayName} `;
    const text=draft.slice(0,query.start)+label+draft.slice(query.end);
    setDraft(text);setMentions(current=>[...current.filter(item=>item.id!==agent.id),{id:agent.id,name:agent.displayName}]);setQuery(undefined);
    requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(query.start+label.length,query.start+label.length);});
  }
  const [sending, setSending] = useState(false);
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
    if (!draft.trim() || sending) return;
    setSending(true);
    setError("");
    const text = draft;
    try {
      const sent = await onSend(text, mentions.filter(item=>hasMention(text,item.name)).map(item=>item.id));
      if (sent) {
        setDraft("");
        setMentions([]);setQuery(undefined);
        stick.current = true;
      } else
        setError(
          "No pudimos enviar el mensaje. Tu borrador sigue acá; volvé a intentar.",
        );
    } finally {
      setSending(false);
    }
  }
  const messages = chat.status === "ready" ? [...chat.messages].reverse() : [];
  return (
    <section
      className="chat-area"
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
                    <p>{message.text}</p>
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
        <p id="mention-help" className="mention-help">Escribí @ y elegí un bot para dirigir el aviso. Sin menciones, se avisa a todos.</p>
        {!!mentions.length && <div className="mention-targets" aria-label="Bots que recibirán el aviso">{mentions.map(item=><button type="button" key={item.id} aria-label={`Quitar mención a ${item.name}`} onClick={()=>{setMentions(current=>current.filter(value=>value.id!==item.id));if(!mentions.some(other=>other.id!==item.id&&other.name===item.name))setDraft(current=>current.replaceAll(`@${item.name}`,item.name));}}>@{item.name} <small>{item.id.slice(-6)}</small> ×</button>)}</div>}
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
            aria-describedby="mention-help"
            name="message"
            placeholder={`Escribí en ${groupName}…`}
            rows={2}
            value={draft}
            onChange={(event) => changeDraft(event.target.value,event.target.selectionStart)}
            disabled={chat.status !== "ready" || sending}
            onKeyDown={(event) => {
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
  groupId,
  groupName,
  agents = [],
  user,
}: {
  groupId: string;
  groupName: string;
  agents?: AgentMember[];
  user: PublicUser;
}) {
  const [chat, setChat] = useState<ChatState>({ status: "loading" });
  const [live, setLive] = useState(false);
  const pending = useRef<{ text: string; key: string; mentions: string } | undefined>(undefined);
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
      socket.onclose = () => {
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
  }, [groupId]);
  return (
    <ChatPanel
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
      onSend={async (text, mentionedAgentIds) => {
        const mentions=JSON.stringify([...mentionedAgentIds].sort());
        if (!pending.current || pending.current.text !== text || pending.current.mentions !== mentions)
          pending.current = { text, mentions, key: crypto.randomUUID() };
        const outcome = await sendMessage(
          groupId,
          text,
          fetch,
          pending.current.key,
          mentionedAgentIds,
        );
        if (!outcome.ok) return false;
        pending.current = undefined;
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
