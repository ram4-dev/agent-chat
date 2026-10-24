import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTH_PATHS,
  BROWSER_SOCKET_PATH,
  GROUP_PATHS,
  parseBrowserEvent,
  type PublicUser,
  type BrowserEvent,
  type CreateGroupResponse,
  type AcceptedInvitationResponse,
  type ErrorResponse,
} from "@agent-chat/contracts";
import { AuthPanel } from "../features/auth/AuthPanel";
import { RecoveryPanel } from '../features/auth/RecoveryPanel';
import {
  loadSession,
  loginAccount,
  registerAccount,
  type SessionState,
} from "../features/auth/session";
import { GroupPanel, GroupDetails } from "../features/groups/GroupPanel";
import { ChatContainer } from "../features/chat/ChatPanel";
import { AgentsPanel } from "../features/agents/AgentsPanel";
import {
  createInvitation,
  loadGroupDetail,
  loadGroups,
  type GroupDetailState,
  type GroupsState,
  type InvitationState,
} from "../features/groups/transport";
import {
  Avatar,
  Brand,
  CopyField,
  Icon,
  Modal,
  errorMessage,
} from "../shared/ui";
import { loadLiveness } from "../shared/liveness";

export function App() {
  const [recoveryToken, setRecoveryToken] = useState(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    return params.get('type') === 'recovery' ? params.get('access_token') : null;
  });
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [groups, setGroups] = useState<GroupsState>({ status: "loading" });
  const [detail, setDetail] = useState<GroupDetailState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string>();
  const selectedRef = useRef<string | undefined>(undefined);
  const detailRequest = useRef(0);
  const [view, setView] = useState<"chat" | "agents">("chat");
  const [agentRevision, setAgentRevision] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [modal, setModal] = useState<"create" | "join" | "invite">();
  const [invitation, setInvitation] = useState<InvitationState>({
    status: "idle",
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  const [joinValue, setJoinValue] = useState(
    () => new URLSearchParams(location.search).get("invite") ?? "",
  );

  const refreshDetail = useCallback(async (id: string) => {
    const request = ++detailRequest.current;
    const state = await loadGroupDetail(id);
    if (request === detailRequest.current && selectedRef.current === id)
      setDetail(state);
  }, []);
  const openGroup = useCallback(
    (id: string, options?: { navigate?: boolean }) => {
      if (options?.navigate !== false) {
        setView("chat");
        setNavOpen(false);
        setNotice("");
      }
      if (!id) return;
      const changed = selectedRef.current !== id;
      selectedRef.current = id;
      setSelectedId(id);
      if (changed) {
        setDetail({ status: "loading" });
        setDetailsOpen(false);
      }
      const url = new URL(location.href);
      url.searchParams.set("group", id);
      history.replaceState(null, "", url);
      void refreshDetail(id);
    },
    [refreshDetail],
  );

  useEffect(() => {
    if (new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery') {
      const url = new URL(location.href); url.hash = ''; url.searchParams.delete('recovery');
      history.replaceState(null, '', url);
    }
    void loadSession().then(setSession);
    void loadLiveness().then((result) => setOffline(result.status !== "ok"));
  }, []);
  useEffect(() => {
    if (session.status !== "authenticated") {
      setGroups({ status: "loading" });
      selectedRef.current = undefined;
      setSelectedId(undefined);
      setDetail({ status: "loading" });
      return;
    }
    let active = true;
    void loadGroups().then((state) => {
      if (!active) return;
      setGroups(state);
      if (state.status === "ready" && state.groups.length) {
        const remembered = new URLSearchParams(location.search).get("group");
        const first =
          state.groups.find((g) => g.id === remembered) ?? state.groups[0];
        if (first && !selectedRef.current) openGroup(first.id, { navigate: false });
      }
      if (new URLSearchParams(location.search).has("invite")) {
        setActionError("");
        setModal("join");
      }
    });
    return () => {
      active = false;
    };
  }, [session.status, openGroup]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let socket: WebSocket;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${BROWSER_SOCKET_PATH}`,
      );
      socket.onmessage = (event: MessageEvent<string>) => {
        let frame: BrowserEvent | undefined;
        try {
          const payload: unknown = JSON.parse(event.data);
          frame = parseBrowserEvent(payload);
        } catch {
          return;
        }
        if (frame?.type === "agent.connection.changed")
          setAgentRevision((revision) => revision + 1);
        if (
          frame?.type === "agent.connection.changed" ||
          frame?.type === "group.membership.changed" ||
          frame?.type === "ready"
        ) {
          if (selectedRef.current) void refreshDetail(selectedRef.current);
        }
      };
      socket.onclose = () => {
        if (!disposed) timer = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      socket.close();
    };
  }, [session.status, refreshDetail]);

  function openModal(next: "create" | "join") {
    setActionError("");
    setModal(next);
    setNavOpen(false);
  }
  async function invite() {
    if (!selectedId) return;
    setInvitation({ status: "idle" });
    setActionError("");
    setModal("invite");
    setBusy(true);
    const result = await createInvitation(selectedId);
    setInvitation(result);
    setBusy(false);
  }
  async function groupAction(input: string, joining: boolean) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    let token = input.trim();
    if (joining) {
      try {
        token = new URL(token).searchParams.get("invite") ?? token;
      } catch {
        /* Raw invitation codes are also accepted. */
      }
    }
    try {
      const response = await fetch(
        joining ? GROUP_PATHS.acceptInvitation : GROUP_PATHS.collection,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(joining ? { token } : { name: input }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = body as ErrorResponse;
        setActionError(
          joining && failure.error?.code === "not_found"
            ? "La invitación venció, ya se usó o no es válida. Pedí una nueva."
            : errorMessage(failure.error?.code),
        );
        return;
      }
      const nextGroups = await loadGroups();
      setGroups(nextGroups);
      const url = new URL(location.href);
      url.searchParams.delete("invite");
      history.replaceState(null, "", url);
      setJoinValue("");
      setModal(undefined);
      const result = body as CreateGroupResponse | AcceptedInvitationResponse;
      openGroup(result.group.id);
    } catch {
      setActionError("No pudimos conectar. Intentá de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    try {
      const result = await fetch(AUTH_PATHS.logout, { method: "POST" });
      if (!result.ok) throw new Error();
      setSession({ status: "anonymous" });
      setModal(undefined);
      setView("chat");
      setNavOpen(false);
    } catch {
      setNotice("No pudimos cerrar tu sesión. Intentá de nuevo.");
    }
  }

  if (recoveryToken) return <RecoveryPanel token={recoveryToken} onDone={() => { setRecoveryToken(null); setSession({ status: 'anonymous' }); }} />;
  if (session.status === "loading")
    return (
      <main className="app-loading">
        <Brand />
        <p>Preparando tu espacio…</p>
      </main>
    );
  if (session.status !== "authenticated")
    return (
      <AuthPanel
        session={session}
        onRegister={async (input) => {
          setSession(await registerAccount(input));
        }}
        onLogin={async (input) => {
          setSession(await loginAccount(input));
        }}
      />
    );
  const current =
    detail.status === "ready" && detail.detail.group.id === selectedId
      ? detail.detail
      : undefined;
  const user: PublicUser = session.user;
  return (
    <div className="app-layout">
      <GroupPanel
        groups={groups}
        {...(selectedId ? { selectedId } : {})}
        view={view}
        user={user}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onSelect={openGroup}
        onAgents={() => {
          setView("agents");
          setNavOpen(false);
        }}
        onCreate={() => openModal("create")}
        onJoin={() => openModal("join")}
        onLogout={() => {
          void signOut();
        }}
      />
      <main
        tabIndex={-1}
        className={`workspace ${detailsOpen && view === "chat" && current ? "with-details" : ""}`}
      >
        {(offline || notice) && (
          <div className="connection-notice" role="alert">
            {notice ||
              "No pudimos contactar al servidor. Algunos cambios pueden no guardarse."}
          </div>
        )}
        {view === "agents" ? (
          <AgentsPanel
            revision={agentRevision}
            navigationOpen={navOpen}
            {...(current?.role === "admin"
              ? {
                  groupId: current.group.id,
                  groupName: current.group.name,
                  groupAgentIds: current.members
                    .filter((member) => member.kind === "agent")
                    .map((member) => member.id),
                }
              : {})}
            onChanged={() => {
              if (selectedId) void refreshDetail(selectedId);
            }}
            onMenu={() => setNavOpen(true)}
          />
        ) : (
          <>
            <header className="conversation-header">
              <button
                className="icon-button mobile-only"
                aria-label="Abrir navegación"
                aria-expanded={navOpen}
                aria-controls="workspace-navigation"
                onClick={() => setNavOpen(true)}
              >
                <Icon name="menu" />
              </button>
              <div className="conversation-title">
                <span className="header-group-symbol">#</span>
                <div>
                  <h1>
                    {current?.group.name ??
                      (selectedId
                        ? "Cargando conversación…"
                        : "Conversaciones")}
                  </h1>
                  <span>
                    <Icon name="lock" />
                    {current
                      ? `${current.members.length} ${current.members.length === 1 ? "integrante" : "integrantes"} · Grupo privado`
                      : "Tu espacio para trabajar juntos"}
                  </span>
                </div>
              </div>
              {current && (
                <div className="header-actions">
                  <div className="avatar-stack" aria-hidden="true">
                    {current.members.slice(0, 3).map((m) => (
                      <Avatar
                        key={m.id}
                        name={m.displayName}
                        bot={m.kind === "agent"}
                      />
                    ))}
                  </div>
                  {current.role === "admin" && (
                    <button
                      className="button secondary compact"
                      onClick={() => {
                        void invite();
                      }}
                    >
                      <Icon name="plus" />
                      <span>Invitar</span>
                    </button>
                  )}
                  <button
                    className={`icon-button ${detailsOpen ? "is-active" : ""}`}
                    aria-label="Ver miembros"
                    aria-expanded={detailsOpen}
                    aria-controls={detailsOpen ? "group-details" : undefined}
                    onClick={() => setDetailsOpen(!detailsOpen)}
                  >
                    <Icon name="people" />
                  </button>
                </div>
              )}
            </header>
            {current ? (
              <ChatContainer
                key={current.group.id}
                groupId={current.group.id}
                groupName={current.group.name}
                user={user}
              />
            ) : selectedId && detail.status === "loading" ? (
              <div className="center-state">
                <span className="loader" />
                Cargando mensajes…
              </div>
            ) : selectedId &&
              (detail.status === "rejected" || detail.status === "error") ? (
              <div className="center-state">
                <Icon name="lock" />
                <h2>No pudimos abrir el grupo</h2>
                <p>
                  Puede que ya no tengas acceso. Elegí otro grupo o volvé a
                  intentar.
                </p>
                <button
                  className="button secondary"
                  onClick={() => {
                    if (selectedId) void refreshDetail(selectedId);
                  }}
                >
                  Volver a intentar
                </button>
              </div>
            ) : (
              <div className="welcome-state">
                <div className="welcome-illustration">
                  <span className="welcome-tile one">
                    <Icon name="people" />
                  </span>
                  <span className="welcome-tile two">
                    <Icon name="chat" />
                  </span>
                  <span className="welcome-tile three">
                    <Icon name="bot" />
                  </span>
                </div>
                <span className="eyebrow">UN ESPACIO PARA TU EQUIPO</span>
                <h2>Empezá una conversación</h2>
                <p>
                  Creá un grupo privado, invitá a tu equipo
                  <br className="desktop-only" /> y sumá tus agentes cuando los
                  necesites.
                </p>
                <button
                  className="button primary"
                  onClick={() => openModal("create")}
                >
                  <Icon name="plus" />
                  Crear un grupo
                </button>
                <button
                  className="text-button"
                  onClick={() => openModal("join")}
                >
                  Tengo una invitación
                  <Icon name="arrow" />
                </button>
                <div className="welcome-bottom">
                  <Icon name="lock" />
                  Solo los miembros pueden leer y participar.
                </div>
              </div>
            )}
          </>
        )}
        {view === "chat" && current && detailsOpen && (
          <>
            <button
              className="details-backdrop"
              aria-label="Cerrar panel de miembros"
              onClick={() => setDetailsOpen(false)}
            />
            <GroupDetails
              key={current.group.id}
              detail={current}
              user={user}
              onClose={() => setDetailsOpen(false)}
              onInvite={() => {
                void invite();
              }}
              onChanged={() => {
                void refreshDetail(current.group.id);
              }}
              onManageAgents={() => setView("agents")}
            />
          </>
        )}
      </main>
      {(modal === "create" || modal === "join") && (
        <Modal
          title={modal === "create" ? "Crear grupo" : "Unirme a un grupo"}
          onClose={() => {
            if (!busy) setModal(undefined);
          }}
        >
          <p className="muted">
            {modal === "create"
              ? "Un lugar privado para conversar con personas y agentes. Después podés invitar a tu equipo."
              : "Pegá el enlace o el código que te compartió una persona administradora del grupo."}
          </p>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void groupAction(String(data.get("value")), modal === "join");
            }}
          >
            <label>
              {modal === "create"
                ? "Nombre del grupo"
                : "Enlace o código de invitación"}
              <input
                key={modal}
                name="value"
                defaultValue={modal === "join" ? joinValue : ""}
                placeholder={
                  modal === "create"
                    ? "Por ejemplo, Diseño de producto"
                    : "Pegá tu invitación acá"
                }
                required
                {...(modal === "create" ? { maxLength: 100 } : {})}
              />
            </label>
            {actionError && (
              <p role="alert" className="error-box">
                {actionError}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => setModal(undefined)}
              >
                Cancelar
              </button>
              <button className="button primary" type="submit" disabled={busy}>
                {busy
                  ? "Un momento…"
                  : modal === "create"
                    ? "Crear grupo"
                    : "Unirme al grupo"}
                <Icon name="arrow" />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "invite" && (
        <Modal
          title="Invitar personas"
          onClose={() => {
            if (!busy) setModal(undefined);
          }}
        >
          <p className="muted">
            Compartí esta invitación para sumar una persona a{" "}
            <strong>{current?.group.name}</strong>. Cada invitación se puede
            usar una sola vez.
          </p>
          {busy ? (
            <p role="status">Preparando invitación…</p>
          ) : invitation.status === "ready" ? (
            <>
              <CopyField
                label="Enlace de invitación"
                value={`${location.origin}/?invite=${invitation.invitation.token}`}
              />
              <p className="field-hint">
                Vence el{" "}
                {new Date(invitation.invitation.expiresAt).toLocaleString(
                  "es-AR",
                  { dateStyle: "medium", timeStyle: "short" },
                )}
              </p>
              <details className="technical-details">
                <summary>Usar un código de invitación</summary>
                <code data-testid="invitation-code">
                  {invitation.invitation.token}
                </code>
              </details>
            </>
          ) : (
            <p className="error-box" role="alert">
              No pudimos crear la invitación. Cerrá esta ventana y volvé a
              intentar.
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => setModal(undefined)}
            >
              Listo
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
