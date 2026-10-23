import { useEffect, useState } from "react";
import {
  AGENT_PATHS,
  GROUP_PATHS,
  type GroupDetailResponse,
  type OwnedAgentView,
  type PublicUser,
} from "@agent-chat/contracts";
import type { GroupsState } from "./transport";
import { Avatar, Brand, Icon, Modal, errorMessage } from "../../shared/ui";

export function GroupPanel({
  groups,
  selectedId,
  view,
  user,
  open,
  onClose,
  onSelect,
  onAgents,
  onCreate,
  onJoin,
  onLogout,
}: {
  groups: GroupsState;
  selectedId?: string;
  view: "chat" | "agents";
  user: PublicUser;
  open: boolean;
  onClose(): void;
  onSelect(id: string): void;
  onAgents(): void;
  onCreate(): void;
  onJoin(): void;
  onLogout(): void;
}) {
  const [search, setSearch] = useState("");
  return (
    <>
      {open && (
        <button
          className="nav-backdrop"
          aria-label="Cerrar panel de navegación"
          onClick={onClose}
        />
      )}
      <aside
        className={`sidebar ${open ? "sidebar-open" : ""}`}
        aria-label="Navegación principal"
      >
        <div className="sidebar-brand">
          <Brand />
          <span className="beta-label">BETA</span>
          <button
            className="icon-button mobile-only"
            aria-label="Cerrar navegación"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-logo">
            {user.displayName[0]?.toUpperCase()}
          </span>
          <div>
            <strong>Mi espacio</strong>
            <span>Personas y agentes</span>
          </div>
          <Icon name="lock" />
        </div>
        <nav className="main-nav" aria-label="Espacio de trabajo">
          <button
            className={view === "chat" ? "nav-item active" : "nav-item"}
            onClick={() => {
              onSelect(selectedId ?? "");
            }}
          >
            <Icon name="chat" />
            Conversaciones
            <span className="nav-count">
              {groups.status === "ready" ? groups.groups.length : "·"}
            </span>
          </button>
          <button
            className={view === "agents" ? "nav-item active" : "nav-item"}
            onClick={onAgents}
          >
            <Icon name="bot" />
            Mis agentes
          </button>
        </nav>
        <div className="group-nav-heading">
          <span>GRUPOS PRIVADOS</span>
          <button
            className="icon-button"
            aria-label="Nuevo grupo"
            onClick={onCreate}
          >
            <Icon name="plus" />
          </button>
        </div>
        <label className="sr-only" htmlFor="group-search">
          Buscar grupo
        </label>
        <input
          id="group-search"
          className="group-search"
          placeholder="Buscar grupo…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <nav className="group-list" aria-label="Grupos">
          {groups.status === "loading" && (
            <p className="sidebar-hint">Cargando tus grupos…</p>
          )}
          {groups.status === "error" && (
            <p className="sidebar-hint">
              No pudimos cargar los grupos. Recargá para volver a intentar.
            </p>
          )}
          {groups.status === "ready" &&
            groups.groups
              .filter((group) =>
                group.name
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase()),
              )
              .map((group) => (
                <button
                  key={group.id}
                  aria-current={
                    selectedId === group.id && view === "chat"
                      ? "page"
                      : undefined
                  }
                  className={`group-item ${selectedId === group.id && view === "chat" ? "active" : ""}`}
                  onClick={() => onSelect(group.id)}
                >
                  <span className="group-symbol" aria-hidden="true">
                    #
                  </span>
                  <span>{group.name}</span>
                  {selectedId === group.id && view === "chat" && (
                    <span className="selected-dot" />
                  )}
                </button>
              ))}
          {groups.status === "ready" && groups.groups.length === 0 && (
            <p className="sidebar-hint">Tus grupos van a aparecer acá.</p>
          )}
          {groups.status === "ready" &&
            groups.groups.length > 0 &&
            !groups.groups.some((group) =>
              group.name
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            ) && <p className="sidebar-hint">No hay grupos con ese nombre.</p>}
        </nav>
        <button className="join-link" onClick={onJoin}>
          <Icon name="link" />
          Unirme con invitación
        </button>
        <div className="sidebar-bottom">
          <div className="private-note">
            <Icon name="lock" />
            <p>
              Tu equipo, tu espacio.<span>Solo entran quienes invitás.</span>
            </p>
          </div>
          <div className="user-menu">
            <Avatar name={user.displayName} />
            <div>
              <strong>{user.displayName}</strong>
              <span>Mi cuenta</span>
            </div>
            <button
              className="icon-button"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              onClick={onLogout}
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function GroupDetails({
  detail,
  user,
  onClose,
  onInvite,
  onChanged,
  onManageAgents,
}: {
  detail: GroupDetailResponse;
  user: PublicUser;
  onClose(): void;
  onInvite(): void;
  onChanged(): void;
  onManageAgents(): void;
}) {
  const [remove, setRemove] = useState<{
    id: string;
    kind: string;
    name: string;
  }>();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const people = detail.members.filter((m) => m.kind === "human");
  const agents = detail.members.filter((m) => m.kind === "agent");
  const isAdmin = detail.role === "admin";
  return (
    <aside className="group-details" aria-label="Detalles del grupo">
      <header className="details-header">
        <span>Detalles del grupo</span>
        <button
          className="icon-button"
          aria-label="Cerrar detalles"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="group-profile">
        <span className="group-cover">#</span>
        <h2>{detail.group.name}</h2>
        <span className="subtle-tag">
          <Icon name="lock" />
          Grupo privado
        </span>
        <p>
          {isAdmin ? "Administrás este grupo." : "Sos miembro de este grupo."}
        </p>
      </div>
      {isAdmin && (
        <button className="button secondary invite-action" onClick={onInvite}>
          <Icon name="link" />
          Invitar personas
        </button>
      )}
      <div className="member-section">
        <h3>
          Personas <span>{people.length}</span>
        </h3>
        <ul aria-label="Personas del grupo">
          {people.map((member) => (
            <li key={member.id} className="member-row">
              <Avatar name={member.displayName} />
              <div className="member-copy">
                <strong>
                  {member.displayName}
                  {member.id === user.id ? " (vos)" : ""}
                </strong>
                <span>
                  {member.role === "admin" ? "Administrador" : "Miembro"}
                </span>
              </div>
              {isAdmin &&
                !(
                  member.id === user.id &&
                  member.role === "admin" &&
                  people.filter((p) => p.role === "admin").length === 1
                ) && (
                  <button
                    className="icon-button small"
                    aria-label={`Quitar a ${member.displayName}`}
                    onClick={() => {
                      setError("");
                      setRemove({
                        id: member.id,
                        kind: "human",
                        name: member.displayName,
                      });
                    }}
                  >
                    <Icon name="close" />
                  </button>
                )}
            </li>
          ))}
        </ul>
      </div>
      <div className="member-section">
        <h3>
          Agentes <span>{agents.length}</span>
          {isAdmin && (
            <button
              className="icon-button small"
              aria-label="Agregar agente al grupo"
              onClick={() => setAdding(true)}
            >
              <Icon name="plus" />
            </button>
          )}
        </h3>
        <ul aria-label="Agentes del grupo">
          {agents.map((member) => (
            <li key={member.id} className="member-row agent-member">
              <Avatar name={member.displayName} bot />
              <div className="member-copy">
                <strong>
                  {member.displayName}
                  <span className="mini-badge">AGENTE</span>
                </strong>
                <span>De {member.ownerDisplayName}</span>
                <span
                  className={`receiver-label ${member.receiverConnected ? "connected" : ""}`}
                >
                  <i />
                  {member.receiverConnected
                    ? "Receptor activo"
                    : "Sin receptor activo"}
                </span>
              </div>
              {isAdmin && (
                <button
                  className="icon-button small"
                  aria-label={`Quitar a ${member.displayName}`}
                  onClick={() => {
                    setError("");
                    setRemove({
                      id: member.id,
                      kind: "agent",
                      name: member.displayName,
                    });
                  }}
                >
                  <Icon name="close" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {agents.length === 0 && (
          <p className="empty-members">Todavía no hay agentes en este grupo.</p>
        )}
      </div>
      <div className="receiver-note">
        <Icon name="bot" />
        <p>
          Un receptor activo permite recibir mensajes en vivo. Cada agente
          decide si responde. Si está desconectado, puede recuperar sus eventos
          pendientes al volver.
        </p>
      </div>
      {adding && (
        <AgentPicker
          groupId={detail.group.id}
          existingIds={agents.map((a) => a.id)}
          onClose={() => setAdding(false)}
          onChanged={onChanged}
          onManageAgents={onManageAgents}
        />
      )}
      {remove && (
        <Modal
          title={`Quitar a ${remove.name}`}
          onClose={() => {
            if (!busy) setRemove(undefined);
          }}
        >
          <p className="muted">
            Va a perder acceso al grupo. Sus mensajes anteriores se conservan.
          </p>
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemove(undefined)}
            >
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void fetch(
                  remove.kind === "agent"
                    ? GROUP_PATHS.agentMember(detail.group.id, remove.id)
                    : GROUP_PATHS.removeMember(detail.group.id, remove.id),
                  { method: "DELETE" },
                )
                  .then(async (response) => {
                    if (!response.ok) {
                      const body = await response.json();
                      setError(errorMessage(body.error?.code));
                      return;
                    }
                    setRemove(undefined);
                    onChanged();
                  })
                  .catch(() => setError(errorMessage()))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Quitando…" : "Quitar del grupo"}
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
}

function AgentPicker({
  groupId,
  existingIds,
  onClose,
  onChanged,
  onManageAgents,
}: {
  groupId: string;
  existingIds: string[];
  onClose(): void;
  onChanged(): void;
  onManageAgents(): void;
}) {
  const [owned, setOwned] = useState<OwnedAgentView[]>();
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch(AGENT_PATHS.collection)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (active) setOwned(body.agents);
      })
      .catch(() => {
        if (active) setError("No pudimos cargar tus agentes.");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Modal title="Agregar agente" onClose={onClose}>
      <p className="muted">
        Elegí uno de tus agentes o pegá el identificador de un agente que
        quieras invitar.
      </p>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void fetch(
            GROUP_PATHS.agentMember(groupId, encodeURIComponent(id.trim())),
            {
              method: "POST",
            },
          )
            .then(async (response) => {
              if (!response.ok) {
                const body = await response.json();
                setError(errorMessage(body.error?.code));
                return;
              }
              onChanged();
              onClose();
            })
            .catch(() => setError(errorMessage()))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Tus agentes
          <select
            aria-label="Elegir agente"
            value={owned?.some((a) => a.id === id) ? id : ""}
            onChange={(event) => setId(event.target.value)}
          >
            <option value="">
              {owned ? "Seleccionar un agente" : "Cargando…"}
            </option>
            {owned
              ?.filter(
                (a) => a.status === "active" && !existingIds.includes(a.id),
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Identificador del agente
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="ID del agente"
            required
          />
        </label>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="button ghost"
            type="button"
            onClick={() => {
              onClose();
              onManageAgents();
            }}
          >
            Administrar mis agentes
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={busy || !id.trim()}
          >
            {busy ? "Agregando…" : "Agregar al grupo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
