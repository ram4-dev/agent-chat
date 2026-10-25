import type { OwnedAgentView } from '@agent-chat/contracts';
import { CopyField, Modal } from '../../shared/ui';
import { agentSetupState } from './setup-state';

export function AgentConnectionGuide({ agents, selectedId, groupId, groupName, groupAgentIds, busy, error,
  onSelect, onCreate, onRefresh, onNotifications, onAdd, onClose }: {
  agents: OwnedAgentView[] | undefined; selectedId: string; groupId?: string; groupName?: string; groupAgentIds: readonly string[];
  busy: boolean; error: string; onSelect(id: string): void; onCreate(): void; onRefresh(): void;
  onNotifications(id: string): void; onAdd(id: string): void; onClose(): void;
}) {
  if (!agents) return <Modal title="Conectar un agente" onClose={onClose}><p role="status">Consultando identidades…</p>{error && <p role="alert">{error}<button className="text-button" onClick={onRefresh}>Volver a intentar</button></p>}</Modal>;
  const activeAgents = agents.filter(agent => agent.status === 'active');
  const agent = activeAgents.find(agent => agent.id === selectedId) ?? activeAgents[0];
  const state = agentSetupState(agent, groupAgentIds);
  const persistentReceiver = state.authorized && agent?.receiverConnected === true;
  return <Modal title="Conectar un agente" onClose={onClose}>
    <div className="agent-setup-guide">
      <p>{groupId ? `Grupo actual: ${groupName ?? 'este grupo'}.` : 'Sin grupo seleccionado. Podés elegirlo después desde la navegación.'}</p>
      <p>Pasale la skill a tu agente. Puede crear su identidad y configurar sus avisos si el host admite las herramientas y el transporte privado necesarios. Vos autorizás el acceso OAuth.</p>
      <CopyField label="Skill para configurar un agente" value={`${location.origin}/skills/agent-chat/SKILL.md`} />
      <p><a href="/skills/agent-chat/SKILL.md" target="_blank" rel="noreferrer">Abrir skill de configuración</a> · <a href="/docs" target="_blank" rel="noreferrer">Documentación y API</a></p>
      {activeAgents.length > 0 && <label>Identidad a conectar<select value={agent?.id ?? ''} onChange={event => onSelect(event.target.value)}>
        {activeAgents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      <ol className="agent-setup-progress" aria-label="Progreso de conexión">
        <li><strong>Identidad</strong><p>{state.identity ? `${agent!.name}: identidad habilitada.` : 'Todavía no hay una identidad habilitada. La skill o el consentimiento OAuth pueden crearla.'}</p>
          <button className="text-button" onClick={onCreate}>Crear identidad por adelantado</button></li>
        <li aria-current={state.identity && !state.authorized ? 'step' : undefined}><strong>Autorización OAuth</strong>
          <p>{state.authorized ? 'Hay una aplicación autorizada para esta identidad.' : 'Agregá el servidor MCP en tu host. Abrí el consentimiento y elegí o creá la identidad que querés autorizar.'}</p>
          <CopyField label="Dirección MCP" value={`${location.origin}/mcp`} />
          <p>La skill no reemplaza tu consentimiento ni agrega capacidades que el host no tenga.</p></li>
        <li aria-current={state.authorized && !state.notifications && !persistentReceiver ? 'step' : undefined}><strong>Recepción y avisos</strong>
          <p>{state.notifications ? 'Recepción confirmada por el agente. Esto no garantiza una respuesta a cada mensaje.' : persistentReceiver ? 'Receptor autenticado conectado: puede recibir eventos en vivo. La conexión no demuestra que haya procesado un mensaje.' : 'Falta confirmar la recepción. Autorizar MCP o crear una identidad no activa un receptor.'}</p>
          <p>El agente también puede consultar periódicamente su inbox por MCP, si su host ejecuta esa rutina. La consulta periódica no requiere webhook.</p>
          {agent && (persistentReceiver && !state.notifications ? <details><summary>Webhook opcional</summary><p>Con un receptor persistente, podés continuar sin webhook. Los avisos por webhook dependen de las capacidades del servidor y del host.</p><button className="button secondary" onClick={() => onNotifications(agent.id)}>Ver opciones de recepción</button></details> : <button className="button secondary" onClick={() => onNotifications(agent.id)}>{state.notifications ? 'Ver notificaciones' : 'Configurar notificaciones'}</button>)}</li>
        <li><strong>Grupo</strong><p>{state.admitted ? `${agent!.name} ya pertenece a ${groupName ?? 'este grupo'}.` : groupId ? `Falta agregar la identidad a ${groupName ?? 'este grupo'}. La admisión depende de tus permisos en el grupo.` : 'Elegí un grupo y agregá la identidad desde sus miembros.'}</p>
          {agent && groupId && !state.admitted && <button className="button secondary" disabled={busy} onClick={() => onAdd(agent.id)}>Agregar a {groupName ?? 'este grupo'}</button>}</li>
      </ol>
      {error && <p role="alert" className="error-box">{error}</p>}
      <div className="modal-actions"><button className="button secondary" onClick={onRefresh}>Actualizar progreso</button><button className="button primary" onClick={onClose}>Cerrar guía</button></div>
    </div>
  </Modal>;
}
