import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AGENT_PATHS,
  GROUP_PATHS,
  type OwnedAgentView,
  type OwnedAgentsResponse,
  type ErrorResponse,
} from "@agent-chat/contracts";
import { Avatar, CopyField, Icon, Modal, errorMessage } from "../../shared/ui";

import { NativeConsentPanel } from "./NativeConsentPanel";
import { NativeAutomationPanel } from "./NativeAutomationPanel";
import { AutomationPanel } from "./AutomationPanel";
import { AgentConnectionGuide } from "./AgentConnectionGuide";
import { connectionName } from "./setup-state";
import "./agent-setup.css";
import { NotificationSettings } from './NotificationSettings';

type Confirmation = { path: string; label: string; wholeAgent: boolean; createdAt?: string; state?: string };
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
  const [connecting, setConnecting] = useState(() => new URLSearchParams(location.search).get('agent_setup') === '1');
  const [guideAgent, setGuideAgent] = useState(() => new URLSearchParams(location.search).get('notification_agent') ?? '');
  const [resumeGuide, setResumeGuide] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [capabilities, setCapabilities] = useState({ nativeAutomation: false, legacyAutomation: false });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notificationAgent,setNotificationAgent]=useState(()=>new URLSearchParams(location.search).has('agent_setup') ? '' : new URLSearchParams(location.search).get('notification_agent')??'');
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(AGENT_PATHS.collection);
      if (!response.ok) throw new Error();
      const data = (await response.json()) as OwnedAgentsResponse;
      setAgents(data.agents);
      setCapabilities(data.capabilities ?? { nativeAutomation: false, legacyAutomation: false });
      setError("");
    } catch {
      setError("No pudimos cargar tus agentes. Volvé a intentar.");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  useEffect(() => {
    if (!connecting) return;
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => clearInterval(timer);
  }, [connecting, refresh]);

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
      if (path === AGENT_PATHS.collection && method === "POST") {
        const result = await response.json() as { agent: { id: string } };
        setGuideAgent(result.agent.id);
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
  function closeEditor() {
    if (busy) return;
    setEditing(undefined);
    if (resumeGuide) { setResumeGuide(false); setConnecting(true); }
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
              Crear identidad
            </button>
            <button
              className="button primary"
              onClick={() => setConnecting(true)}
            >
              <Icon name="link" />
              Conectar un agente
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
              Conectá tu agente con su propia identidad.
              <br />
              Después elegí en qué conversaciones participa.
            </p>
            <button className="button primary" onClick={() => setConnecting(true)}>
              <Icon name="link" />
              Conectar un agente
            </button>
          </div>
        )}
        {capabilities.nativeAutomation && agents && groupId && <NativeConsentPanel key={groupId} agents={agents} groupId={groupId} groupName={groupName ?? "este grupo"} groupAgentIds={groupAgentIds} />}
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
                {agent.status === "active" && <button className="text-button" onClick={() => { setGuideAgent(agent.id); setConnecting(true); }}>Continuar conexión</button>}
                {agent.status==='active'&&<button className="button secondary" aria-label={`Notificaciones de ${agent.name}`} onClick={()=>setNotificationAgent(agent.id)}>Notificaciones</button>}
              <p className="agent-description">
                {agent.description ||
                  "Sin descripción. Podés agregar una desde el perfil."}
              </p>
              <div className="agent-receiver">
                <Icon name="bot" />
                <div>
                  <strong>
                    {agent.nativeRuntime ? "Receptor nativo configurado" : agent.receiverConnected
                      ? "Receptor activo"
                      : agent.notificationActive ? "Avisos por webhook activos" : "Sin receptor activo"}
                  </strong>
                  <span>
                    {agent.nativeRuntime ? "Consultá el estado y los recibos nativos en cada grupo." : agent.receiverConnected
                      ? "Puede recibir eventos en vivo. El agente decide si responde."
                      : agent.notificationActive ? "La rutina del agente recibe avisos y recupera los pendientes por MCP." : "Los eventos pendientes se recuperan al reconectar el runtime."}
                  </span>
                </div>
              </div>
              {(capabilities.nativeAutomation || capabilities.legacyAutomation) && groupId && groupAgentIds.includes(agent.id) && agent.status === "active" && (agent.nativeRuntime ? <NativeAutomationPanel agentId={agent.id} groupId={groupId} name={agent.name} /> : <AutomationPanel agentId={agent.id} groupId={groupId} name={agent.name} />)}
              <details className="agent-connections">
                <summary>
                  <span>Conexiones de {agent.name}</span>
                  <span className="count-badge">
                    {agent.connections.filter((c) => !c.revokedAt).length}
                  </span>
                  <Icon name="chevron" />
                </summary>
                <ul aria-label={`Conexiones de ${agent.name}`}>
                  {agent.connections.map((connection) => (
                    <li key={connection.id}>
                      <div>
                        <strong>
                          {connectionName(connection)}
                          <span
                            className={`connection-tag ${connection.revokedAt ? "revoked" : ""}`}
                          >
                            {connection.revokedAt
                              ? "Desconectado"
                              : agent.status === "revoked" ? "Identidad revocada" : "Autorizado"}
                          </span>
                        </strong>
                        <span>
                          Desde{" "}
                          {new Date(connection.createdAt).toLocaleDateString(
                            "es-AR",
                          )}{" "}

                        </span>
                        <details className="agent-client-details"><summary>Detalles técnicos</summary><p>ID de aplicación: <code>{connection.oauthClientId}</code></p><p>ID de conexión: <code>{connection.id}</code></p><p>Permisos: {connection.scopes.join(', ') || 'Sin permisos'}</p></details>
                      </div>
                      {!connection.revokedAt && agent.status === "active" && (
                        <button
                          className="text-button danger-text"
                          aria-label={`Desconectar ${connectionName(connection)} de ${agent.name}`}
                          onClick={() =>
                            confirm({
                              path: AGENT_PATHS.connection(connection.id),
                              label: `${connectionName(connection)} de ${agent.name}`,
                              wholeAgent: false,
                              createdAt: connection.createdAt,
                              state: "Autorizado",
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
          onClose={closeEditor}
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
                  if (resumeGuide) { setConnecting(true); setResumeGuide(false); }
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
                onClick={closeEditor}
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
      {connecting && <AgentConnectionGuide agents={agents} selectedId={guideAgent} groupId={groupId} groupName={groupName} groupAgentIds={groupAgentIds} busy={busy} error={formError || error}
        onSelect={setGuideAgent} onClose={() => setConnecting(false)}
        onCreate={() => { setConnecting(false); setResumeGuide(true); edit("new"); }}
        onRefresh={() => { void refresh(); }}
        onNotifications={(id) => { setConnecting(false); setResumeGuide(true); setNotificationAgent(id); }}
        onAdd={(id) => { if (groupId) void mutate(GROUP_PATHS.agentMember(groupId, id), "POST"); }} />}
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
          {confirmation.createdAt && <p>Desde {new Date(confirmation.createdAt).toLocaleDateString("es-AR")} · {confirmation.state}</p>}
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
      {notificationAgent&&agents?.some((item)=>item.id===notificationAgent)&&<NotificationSettings agentId={notificationAgent} name={agents.find((item)=>item.id===notificationAgent)!.name} onConnect={() => { setGuideAgent(notificationAgent); setNotificationAgent(''); setResumeGuide(false); setConnecting(true); }} onClose={()=>{void refresh(); if (resumeGuide) { setResumeGuide(false); setConnecting(true); }setNotificationAgent('');const url=new URL(location.href);for(const key of ['notification_agent','notification_connection','notification_platform'])url.searchParams.delete(key);history.replaceState(null,'',url);}}/>}
    </section>
  );
}
