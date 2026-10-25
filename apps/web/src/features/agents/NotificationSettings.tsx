import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AGENT_PATHS, type OwnedAgentView } from '@agent-chat/contracts';
import { CopyField, Modal } from '../../shared/ui';
import './agent-setup.css';

export interface NotificationStatus {
  available: boolean; configured?: boolean; active: boolean; enabled?: boolean; receipt_confirmed?: boolean;
  connection_id?: string; reason?: string; platform?: string; destination_host?: string; needs_attention?: boolean;
  latest_delivery?: { status: string };
  connections?: Array<{ id: string; oauthClientId: string; clientName?: string | null }>;
}
export function notificationStatusLabel(state: NotificationStatus): string {
  if (state.reason === 'authorization_required') return 'Reconectá el cliente MCP antes de activar los avisos.';
  if (state.reason === 'paused') return 'Avisos pausados. Podés probar y activar cuando quieras.';
  if (state.needs_attention) return 'Notificaciones requieren revisión.';
  if (state.active && state.receipt_confirmed) return 'Notificaciones activas: recepción confirmada por el agente.';
  if (state.configured) return 'Configurado: esperando que el agente confirme una prueba real.';
  return 'Falta vincular la rutina del agente.';
}
export function notificationHostInstructions(platform: string): string {
  return platform === 'grokbot'
    ? 'Creá una rutina con disparador webhook en Grok Bot.'
    : 'Configurá una rutina en tu host con un disparador webhook HTTPS y una clave privada. El host debe poder ejecutar al agente al recibir el aviso.';
}

type NotificationSettingsProps = { agentId: string; name: string; onClose(): void; onConnect?(): void };
type RequestSession = { controller: AbortController };

export function NotificationSettings(props: NotificationSettingsProps) {
  // A different identity owns different fields, requests and dismissal callbacks.
  return <NotificationSettingsSession key={props.agentId} {...props} />;
}

function NotificationSettingsSession({ agentId, name, onClose, onConnect }: NotificationSettingsProps) {
  const session = useRef<RequestSession | null>(null);
  const dismissed = useRef(false);
  const isCurrent = useCallback((request: RequestSession) => session.current === request && !request.controller.signal.aborted, []);
  const [state, setState] = useState<NotificationStatus>();
  const [connection, setConnection] = useState(() => new URLSearchParams(location.search).get('notification_connection') ?? '');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [platform, setPlatform] = useState(() => new URLSearchParams(location.search).get('notification_platform') === 'generic' ? 'generic' : 'grokbot');
  const [platformChosen, setPlatformChosen] = useState(() => new URLSearchParams(location.search).has('notification_platform'));
  const path = `/api/agents/${encodeURIComponent(agentId)}/notifications`;
  const refresh = useCallback(async (request: RequestSession) => {
    if (!isCurrent(request)) return;
    const response = await fetch(path, { cache: 'no-store', signal: request.controller.signal });
    if (!response.ok) throw new Error();
    const result = await response.json() as NotificationStatus;
    // SQLite has no webhook backend, but still has owner-scoped OAuth connections.
    if (!result.available) {
      const response = await fetch(AGENT_PATHS.connections(agentId), { cache: 'no-store', signal: request.controller.signal });
      if (!response.ok) throw new Error();
      result.connections = (await response.json() as { connections: OwnedAgentView['connections'] }).connections.filter(item => !item.revokedAt);
    }
    if (!isCurrent(request)) return;
    setState(result);
    setConnection(current => result.connections?.some(item => item.id === current) ? current
      : result.connections?.some(item => item.id === result.connection_id) ? result.connection_id!
      : result.connections?.length === 1 ? result.connections[0]!.id : '');
  }, [path, agentId, isCurrent]);
  useEffect(() => {
    // Object identity is the request generation, including effect re-mounts.
    const request: RequestSession = { controller: new AbortController() };
    session.current = request;
    void refresh(request).catch(() => { if (isCurrent(request)) setError('No pudimos consultar la configuración. Volvé a consultar el estado.'); });
    const timer = setInterval(() => { void refresh(request).catch(() => {}); }, 2000);
    return () => {
      clearInterval(timer);
      if (session.current === request) session.current = null;
      request.controller.abort();
    };
  }, [refresh, isCurrent]);
  useEffect(() => {
    if (!platformChosen && state?.platform) setPlatform(state.platform);
  }, [platformChosen, state?.platform]);
  async function action(request: RequestSession, suffix: string, body?: object) {
    if (!isCurrent(request)) throw new DOMException('Closed notification session', 'AbortError');
    const response = await fetch(path + suffix, { method: 'POST', signal: request.controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    if (!response.ok) throw new Error();
    return response.json();
  }
  async function test() {
    const request = session.current;
    if (!request || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await action(request, '/test');
      if (!isCurrent(request)) return;
      setNotice('Prueba enviada. Falta la confirmación del agente.'); await refresh(request);
    } catch { if (isCurrent(request)) setError('No pudimos enviar la prueba. Revisá la rutina y consultá el estado antes de volver a probar.'); }
    finally { if (isCurrent(request)) setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const request = session.current;
    if (!request || busy) return;
    const input = { connectionId: connection, platform, url, secret };
    setBusy(true); setError(''); setNotice(''); setSecret(''); setUrl('');
    let saved = false;
    try {
      await action(request, '', input);
      if (!isCurrent(request)) return;
      saved = true; setNotice('Configuración guardada. Falta confirmar la recepción.');
      await refresh(request);
      if (!isCurrent(request)) return;
      await action(request, '/test');
      if (!isCurrent(request)) return;
      setNotice('Prueba enviada. Falta la confirmación del agente.'); await refresh(request);
    } catch {
      if (isCurrent(request)) setError(saved ? 'La configuración se guardó, pero no pudimos completar la prueba. Consultá el estado y usá Probar y activar.'
        : 'No pudimos guardar. Revisá la conexión, la URL HTTPS y la clave privada de la rutina.');
    } finally { if (isCurrent(request)) { setSecret(''); setUrl(''); setBusy(false); } }
  }
  async function pause() {
    const request = session.current;
    if (!request || busy) return;
    setBusy(true); setNotice(''); setError('');
    try { await action(request, '/pause'); if (isCurrent(request)) await refresh(request); }
    catch { if (isCurrent(request)) setError('No pudimos pausar los avisos. Consultá el estado y volvé a intentar.'); }
    finally { if (isCurrent(request)) setBusy(false); }
  }
  async function checkState() {
    const request = session.current;
    if (!request) return;
    try { await refresh(request); if (isCurrent(request)) setError(''); }
    catch { if (isCurrent(request)) setError('No pudimos consultar el estado. Volvé a intentar.'); }
  }
  const noConnection = state && !state.connections?.length;
  function leave(callback: () => void) {
    if (dismissed.current) return;
    dismissed.current = true;
    const request = session.current;
    session.current = null;
    request?.controller.abort();
    setSecret(''); setUrl('');
    callback();
  }
  function connect() {
    leave(() => {
      if (onConnect) onConnect();
      else location.assign(`/?notification_agent=${encodeURIComponent(agentId)}&agent_setup=1`);
    });
  }
  return <Modal title={`Notificaciones de ${name}`} onClose={() => leave(onClose)}>
    <div className="agent-notification-settings">
      {busy && <p role="status">Podés cerrar esta ventana. La solicitud puede completarse en el servidor; volvé a abrirla para consultar el estado.</p>}
      {error && <div className="error-box" role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={() => void checkState()}>Consultar estado</button></div>}
      {!state ? <p role="status">Consultando notificaciones…</p> : <>
        {noConnection ? <div><p>Primero autorizá una aplicación MCP para {name}. Después podés configurar sus avisos.</p><button className="button primary" onClick={connect}>Conectar mi agente</button></div> : <>
          {state.available && <p role="status">{notificationStatusLabel(state)}</p>}
          {!state.available && <p>Este servidor permite recibir mediante el receptor autenticado del cliente. Los webhooks requieren el despliegue con Supabase.</p>}
          <p>{state.available ? 'Pasale esta skill al agente para configurar los avisos por API, si su host permite transferir las credenciales en privado. La skill no agrega soporte de webhook al host.' : 'Pasale esta skill al agente para consultar las capacidades de este servidor y configurar un receptor compatible con su host.'}</p>
          <CopyField label="Skill para configurar notificaciones" value={`${location.origin}/skills/agent-chat/SKILL.md`} />
          <p><a href="/docs" target="_blank" rel="noreferrer">Documentación y API</a></p>
          {state.available && <>
            <label>Plataforma<select aria-label="Plataforma de notificaciones" value={platform} onChange={event => { setPlatform(event.target.value); setPlatformChosen(true); }}><option value="grokbot">Grok Bot</option><option value="generic">Otro host con webhook</option></select></label>
            <p>{notificationHostInstructions(platform)}</p>
            <p>La rutina debe verificar la identidad, confirmar el aviso con <code>confirm_notification_delivery</code> y atender el inbox mediante su cuenta MCP autorizada.</p>
            {state.destination_host && <p>Destino guardado: {state.destination_host}</p>}
            {state.latest_delivery && <p>Último aviso: {state.latest_delivery.status === 'accepted' ? 'Aceptado por la plataforma; esperando confirmación del agente.' : state.latest_delivery.status === 'confirmed' ? 'Recibido y confirmado por el agente.' : state.latest_delivery.status === 'queued' ? 'En cola.' : state.latest_delivery.status === 'sending' ? 'Enviando.' : state.latest_delivery.status === 'uncertain' ? 'Entrega incierta; revisá el historial de la rutina antes de probar otra vez.' : state.latest_delivery.status === 'failed' ? 'La plataforma rechazó el aviso.' : 'Sin entrega activa.'}</p>}
            {state.needs_attention && <p className="error-box">Hay avisos que requieren revisión. Los mensajes siguen pendientes en el inbox.</p>}
            {notice && !state.active && <p role="status">{notice}</p>}
            <details><summary>Configuración manual privada</summary>
              <form onSubmit={event => void save(event)}>
                <label>Cliente MCP<select aria-label="Cliente MCP para notificaciones" required value={connection} onChange={event => setConnection(event.target.value)}>
                  <option value="">Elegí una aplicación autorizada</option>{state.connections?.map(item => <option key={item.id} value={item.id}>{item.clientName?.trim() || `Aplicación MCP sin nombre (${item.oauthClientId.slice(-8)})`} · {item.id.slice(-8)}</option>)}
                </select></label>
                <label>URL del webhook<input aria-label="URL del webhook" type="url" required value={url} autoComplete="off" onChange={event => setUrl(event.target.value)} /></label>
                <label>Clave del webhook<input aria-label="Clave del webhook" type="password" required value={secret} autoComplete="off" onChange={event => setSecret(event.target.value)} /></label>
                <p>Completá estos datos solo acá. La clave se guarda de forma privada, no se devuelve en las consultas y se borra del formulario al terminar. No la pegues en el chat.</p>
                <button className="button primary" disabled={busy || !connection} type="submit">{busy ? 'Guardando y probando…' : 'Guardar y probar'}</button>
              </form>
            </details>
            {state.configured && <div className="modal-actions">
              <button className="button secondary" disabled={busy || state.reason === 'authorization_required'} onClick={() => void test()}>Probar y activar</button>
              {state.enabled && <button className="button secondary" disabled={busy} onClick={() => void pause()}>Pausar avisos</button>}
              {state.reason === 'authorization_required' && <button className="button secondary" disabled={busy} onClick={connect}>Conectar mi agente</button>}
            </div>}
          </>}
        </>}
      </>}
    </div>
  </Modal>;
}
