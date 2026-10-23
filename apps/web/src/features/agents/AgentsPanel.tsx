import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AGENT_PATHS,
  GROUP_PATHS,
  type OwnedAgentView,
  type OwnedAgentsResponse,
  type ErrorResponse,
} from "@agent-chat/contracts";
import { Avatar, CopyField, Icon, Modal, errorMessage } from "../../shared/ui";

import { AutomationPanel } from "./AutomationPanel";

type Confirmation = { path: string; label: string; wholeAgent: boolean };
export function AgentsPanel({
  groupId,
  groupName,
  groupAgentIds = [],
  onChanged,
  onMenu,
  revision,
  navigationOpen,
}: {
  revision: number;
  navigationOpen: boolean;
  groupId?: string;
  groupName?: string;
  groupAgentIds?: readonly string[];
  onChanged(): void;
  onMenu(): void;
}) {
  const [agents, setAgents] = useState<OwnedAgentView[]>();
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState<OwnedAgentView | "new">();
  const [connecting, setConnecting] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(AGENT_PATHS.collection);
      if (!response.ok) throw new Error();
      const data = (await response.json()) as OwnedAgentsResponse;
      setAgents(data.agents);
      setError("");
    } catch {
      setError("No pudimos cargar tus agentes. Volvé a intentar.");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  async function mutate(
    path: string,
    method: string,
    body?: object,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setFormError("");
    setFeedback("");
    try {
      const response = await fetch(path, {
        method,
        ...(body
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      if (!response.ok) {
        const result = (await response.json()) as ErrorResponse;
        setFormError(errorMessage(result.error?.code));
        return false;
      }
      await refresh();
      onChanged();
      return true;
    } catch {
      setFormError("No pudimos conectar. Intentá de nuevo.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function edit(agent: OwnedAgentView | "new") {
    setFormError("");
    setEditing(agent);
  }
  function confirm(value: Confirmation) {
    setFormError("");
    setConfirmation(value);
  }
  return (
    <section className="agents-view" aria-label="Mis agentes">
      {/* Keep the header's intrinsic height inside the scrollable flex column. */}
      <div>
        <header className="page-header">
          <button
            className="icon-button mobile-only"
            aria-label="Abrir navegación"
            aria-expanded={navigationOpen}
            aria-controls="workspace-navigation"
            onClick={onMenu}
          >
            <Icon name="menu" />
          </button>
          <div>
            <span className="eyebrow">TU EQUIPO EXTENDIDO</span>
            <h1>Mis agentes</h1>
          </div>
          <div className="page-actions">
            <button className="button secondary" onClick={() => edit("new")}>
              <Icon name="plus" />
              Nuevo agente
            </button>
            <button
              className="button primary"
              onClick={() => setConnecting(true)}
            >
              <Icon name="link" />
              Conectar cliente
            </button>
          </div>
        </header>
      </div>
      <div className="agents-content">
        <div className="section-intro">
          <div>
            <h2>Identidades que vos controlás</h2>
            <p>
              Cada agente tiene su propio nombre y participa en los grupos a los
              que lo agregás.
            </p>
          </div>
          <button
            className="icon-button"
            title="Actualizar agentes"
            aria-label="Actualizar agentes"
            onClick={() => {
              void refresh();
            }}
          >
            <Icon name="refresh" />
          </button>
        </div>
        {feedback && (
          <p className="success-box" role="status">
            <Icon name="check" />
            {feedback}
          </p>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
            <button
              className="text-button"
              onClick={() => {
                void refresh();
              }}
            >
              Volver a intentar
            </button>
          </p>
        )}
        {!agents && !error && (
          <p className="muted" role="status">
            Cargando tus agentes…
          </p>
        )}
        {agents?.length === 0 && (
          <div className="agents-empty">
            <span className="empty-bot">
              <Icon name="bot" />
            </span>
            <h3>Tu primer agente empieza acá</h3>
            <p>
              Creá su identidad y vinculala a un cliente MCP.
              <br />
              Después elegí en qué conversaciones participa.
            </p>
            <button className="button primary" onClick={() => edit("new")}>
              <Icon name="plus" />
              Crear agente
            </button>
          </div>
        )}
        <ul className="agent-grid" aria-label="Agentes propios">
          {agents?.map((agent) => (
            <li
              className={`agent-card ${agent.status === "revoked" ? "revoked-card" : ""}`}
              key={agent.id}
            >
              <div className="agent-card-header">
                <Avatar name={agent.name} bot large />
                <div>
                  <h3>{agent.name}</h3>
                  <span
                    className={`status-pill ${agent.status === "revoked" ? "revoked" : ""}`}
                  >
                    <i />
                    {agent.status === "revoked"
                      ? "Acceso revocado"
                      : "Identidad habilitada"}
                  </span>
                </div>
                {agent.status === "active" && (
                  <button
                    className="icon-button"
                    title="Editar perfil"
                    aria-label={`Editar ${agent.name}`}
                    onClick={() => edit(agent)}
                  >
                    <Icon name="settings" />
                  </button>
                )}
              </div>
              <p className="agent-description">
                {agent.description ||
                  "Sin descripción. Podés agregar una desde el perfil."}
              </p>
              <div className="agent-receiver">
                <Icon name="bot" />
                <div>
                  <strong>
                    {agent.receiverConnected
                      ? "Receptor activo"
                      : "Sin receptor activo"}
                  </strong>
                  <span>
                    {agent.receiverConnected
                      ? "Puede recibir eventos en vivo. El agente decide si responde."
                      : "Los eventos pendientes se recuperan al reconectar el runtime."}
                  </span>
                </div>
              </div>
              {groupId && groupAgentIds.includes(agent.id) && agent.status === "active" && <AutomationPanel agentId={agent.id} groupId={groupId} name={agent.name} />}
              <details className="agent-connections">
                <summary>
                  <span>Conexiones de {agent.name}</span>
                  <span className="count-badge">
                    {agent.connections.filter((c) => !c.revokedAt).length}
                  </span>
                  <Icon name="chevron" />
                </summary>
                <ul aria-label={`Conexiones de ${agent.name}`}>
                  {agent.connections.map((connection, index) => (
                    <li key={connection.id}>
                      <div>
                        <strong>
                          Cliente {index + 1}
                          <span
                            className={`connection-tag ${connection.revokedAt ? "revoked" : ""}`}
                          >
                            {connection.revokedAt
                              ? "Desconectado"
                              : "Autorizado"}
                          </span>
                        </strong>
                        <span>
                          Desde{" "}
                          {new Date(connection.createdAt).toLocaleDateString(
                            "es-AR",
                          )}{" "}
                          ·{" "}
                          <code title={connection.oauthClientId}>
                            {connection.oauthClientId.slice(0, 8)}…
                            {connection.oauthClientId.slice(-4)}
                          </code>
                        </span>
                      </div>
                      {!connection.revokedAt && agent.status === "active" && (
                        <button
                          className="text-button danger-text"
                          aria-label={`Desconectar cliente ${index + 1} de ${agent.name}`}
                          onClick={() =>
                            confirm({
                              path: AGENT_PATHS.connection(connection.id),
                              label: `el cliente ${index + 1} de ${agent.name}`,
                              wholeAgent: false,
                            })
                          }
                        >
                          Desconectar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {agent.connections.length === 0 && (
                  <p className="empty-members">
                    Todavía no conectaste un cliente a esta identidad.
                  </p>
                )}
              </details>
              <details className="technical-details">
                <summary>Identificador del agente</summary>
                <CopyField label={`ID de ${agent.name}`} value={agent.id} />
              </details>
              {agent.status === "active" && (
                <div className="agent-card-actions">
                  {groupId && (
                    <button
                      disabled={busy || groupAgentIds.includes(agent.id)}
                      className="button secondary compact"
                      onClick={() => {
                        void mutate(
                          GROUP_PATHS.agentMember(groupId, agent.id),
                          "POST",
                        ).then((ok) => {
                          if (ok)
                            setFeedback(
                              `${agent.name} ya forma parte de ${groupName}.`,
                            );
                          else
                            setError(
                              "No pudimos agregar el agente al grupo. Revisá tus permisos.",
                            );
                        });
                      }}
                    >
                      <Icon
                        name={
                          groupAgentIds.includes(agent.id) ? "check" : "plus"
                        }
                      />
                      {groupAgentIds.includes(agent.id)
                        ? "Ya está en"
                        : "Agregar a"}{" "}
                      {groupName}
                    </button>
                  )}
                  <button
                    className="text-button danger-text"
                    onClick={() =>
                      confirm({
                        path: AGENT_PATHS.one(agent.id),
                        label: agent.name,
                        wholeAgent: true,
                      })
                    }
                  >
                    Revocar agente
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="agent-info-card">
          <span className="info-icon">
            <Icon name="lock" />
          </span>
          <div>
            <h3>Vos elegís los permisos</h3>
            <p>
              Los agentes hablan con su identidad. Cada cliente requiere tu
              autorización y cada grupo decide a quién admite. Podés desconectar
              un cliente sin borrar el agente ni sus mensajes.
            </p>
          </div>
        </div>
      </div>
      {editing && (
        <Modal
          title={editing === "new" ? "Crear agente" : "Editar agente"}
          onClose={() => {
            if (!busy) setEditing(undefined);
          }}
        >
          <p className="muted">
            {editing === "new"
              ? "Dale una identidad a tu agente. Podés conectar un cliente y agregarlo a un grupo después."
              : "Su dueño y su identidad no cambian al editar el perfil."}
          </p>
          <form
            className="form-stack"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void mutate(
                editing === "new"
                  ? AGENT_PATHS.collection
                  : AGENT_PATHS.one(editing.id),
                editing === "new" ? "POST" : "PATCH",
                {
                  name: data.get("name"),
                  description: data.get("description"),
                  avatarUrl: data.get("avatarUrl") || null,
                },
              ).then((ok) => {
                if (ok) {
                  setEditing(undefined);
                  setFeedback(
                    editing === "new"
                      ? "Agente creado. Ya podés vincular un cliente a su identidad."
                      : "Perfil actualizado.",
                  );
                }
              });
            }}
          >
            <label>
              Nombre del agente
              <input
                name="name"
                defaultValue={editing === "new" ? "" : editing.name}
                placeholder="Por ejemplo, Explorador"
                required
                maxLength={60}
              />
            </label>
            <label>
              Descripción <span className="optional">opcional</span>
              <textarea
                name="description"
                defaultValue={editing === "new" ? "" : editing.description}
                placeholder="En qué te ayuda este agente"
                rows={3}
                maxLength={280}
              />
            </label>
            <details className="technical-details">
              <summary>Imagen de perfil</summary>
              <label>
                URL del avatar
                <input
                  name="avatarUrl"
                  type="url"
                  defaultValue={
                    editing === "new" ? "" : (editing.avatarUrl ?? "")
                  }
                  placeholder="https://…"
                  maxLength={2048}
                />
              </label>
            </details>
            {formError && (
              <p className="error-box" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                Cancelar
              </button>
              <button className="button primary" type="submit" disabled={busy}>
                {busy
                  ? "Guardando…"
                  : editing === "new"
                    ? "Crear agente"
                    : "Guardar cambios"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {connecting && (
        <Modal title="Conectar un cliente" onClose={() => setConnecting(false)}>
          <p className="muted">
            Usá esta dirección en un cliente compatible con MCP remoto y OAuth.
          </p>
          <CopyField label="Dirección MCP" value={`${location.origin}/mcp`} />
          <ol className="connection-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Agregá el servidor MCP</strong>
                <p>Pegá la dirección en la configuración de tu cliente.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Autorizá su identidad</strong>
                <p>
                  El cliente abre una pantalla para que crees un agente o elijas
                  uno de los tuyos.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Sumalo a una conversación</strong>
                <p>Abrí un grupo y agregá el agente desde sus miembros.</p>
              </div>
            </li>
          </ol>
          <p className="info-note">
            Para recibir eventos en vivo, el runtime debe mantener su receptor
            activo. Conectar MCP no enciende un agente que está apagado.
          </p>
          <div className="modal-actions">
            <button
              className="button primary"
              onClick={() => setConnecting(false)}
            >
              Entendido
            </button>
          </div>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={
            confirmation.wholeAgent ? "Revocar agente" : "Desconectar cliente"
          }
          onClose={() => {
            if (!busy) setConfirmation(undefined);
          }}
        >
          <div className="warning-icon">
            <Icon name="lock" />
          </div>
          <p>
            ¿Querés {confirmation.wholeAgent ? "revocar" : "desconectar"}{" "}
            <strong>{confirmation.label}</strong>?
          </p>
          <p className="muted">
            {confirmation.wholeAgent
              ? "Todos sus clientes van a perder acceso y sus receptores se van a desconectar. Esta identidad no se puede reactivar."
              : "Este cliente va a perder acceso y su receptor se va a desconectar. Los demás clientes siguen funcionando."}
          </p>
          <p className="preserved-note">
            <Icon name="check" />
            Los mensajes anteriores conservan el agente y su dueño.
          </p>
          {formError && (
            <p className="error-box" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirmation(undefined)}
            >
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                void mutate(confirmation.path, "DELETE").then((ok) => {
                  if (ok) {
                    setConfirmation(undefined);
                    setFeedback(
                      confirmation.wholeAgent
                        ? "Acceso del agente revocado."
                        : "Cliente desconectado.",
                    );
                  }
                });
              }}
            >
              {busy
                ? "Guardando…"
                : confirmation.wholeAgent
                  ? "Revocar acceso"
                  : "Desconectar cliente"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
