import { useEffect, useState } from 'react';
import type { NativeStatusView, NativeCapabilities } from '@agent-chat/contracts';
const providers = { grok_bot: 'Grok Bot', hermes: 'Hermes', codex: 'Codex', legacy_codex: 'Codex legacy' };
const capabilityLabels: Record<keyof NativeCapabilities, string> = { groupIsolation: 'Contexto entre grupos', durableResults: 'Resultados durables', approvals: 'Aprobaciones nativas', toolCatalog: 'Herramientas del profile', nativeVisibility: 'Historial nativo' };
export function nativeStatusLabel(state: NativeStatusView): string {
  if (!state.group.covered) return 'Este grupo no está habilitado para este receptor';
  if (state.blockedElsewhere) return 'Hay un turno pendiente fuera de este grupo';
  const job = state.jobs.find(job => job.state !== 'done');
  if (job) {
    if (job.state === 'needs_review') return 'El turno requiere revisión';
    if (job.state === 'awaiting_approval') return 'Esperando aprobación nativa';
    if (job.state === 'cancel_requested') return 'Cancelación pendiente de verificar';
    if (job.state === 'start_uncertain') return 'Inicio pendiente de confirmar';
    if (job.state === 'result_saved') return 'Resultado guardado; publicación pendiente';
    if (job.state === 'running') return state.target.provider === 'grok_bot' && !job.providerStarted ? 'Notificación aceptada; inicio del bot pendiente' : 'Procesamiento autorizado; resultado pendiente';
    if (job.state === 'claimed') return 'Mensaje reservado; inicio pendiente';
    return 'Estado del turno sin verificar';
  }
  if (!state.binding.enabled) return 'Respuestas nativas pausadas';
  return state.controller.presence === 'recent' ? 'Controlador con señal reciente' : state.controller.presence === 'stale' ? 'Sin señal reciente del controlador' : 'Controlador sin señal registrada';
}
export function nativeJobLabel(job: NativeStatusView['jobs'][number]): string {
  if (job.receipt?.disposition === 'published' && job.receipt.messageId) return 'Respuesta publicada';
  if (job.receipt?.disposition === 'no_reply') return 'Sin respuesta';
  if (job.receipt?.disposition === 'suppressed') return 'Confirmado sin publicar';
  return job.state === 'done' ? 'Finalizado sin recibo disponible' : job.state === 'result_saved' ? 'Resultado guardado; publicación pendiente' : job.state === 'needs_review' ? 'Revisión necesaria' : job.state === 'awaiting_approval' ? 'Esperando aprobación' : job.state === 'start_uncertain' ? 'Inicio pendiente de confirmar' : job.state === 'cancel_requested' ? 'Cancelación pendiente de verificar' : job.state === 'running' ? 'Procesamiento autorizado; resultado pendiente' : job.state === 'claimed' ? 'Mensaje reservado; inicio pendiente' : 'Entrega pendiente';
}
export function NativeAutomationPanel({ agentId, groupId, name }: { agentId: string; groupId: string; name: string }) {
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<NativeStatusView>(); const [error, setError] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; let request: AbortController | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    setState(undefined); setError(false);
    const refresh = async () => {
      const controller = new AbortController(); request = controller;
      setRefreshing(true);
      const deadline = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`/api/agents/${agentId}/native-status/${groupId}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const next = await response.json() as { native: NativeStatusView | null };
        if (!next.native || controller.signal.aborted) throw new Error();
        if (active) { setState(next.native); setError(false); }
      } catch { if (active) { setState(undefined); setError(true); } }
      finally {
        clearTimeout(deadline);
        if (active) { setRefreshing(false); timer = setTimeout(() => { void refresh(); }, 3000); }
      }
    };
    void refresh();
    return () => { active = false; request?.abort(); clearTimeout(timer); };
  }, [agentId, groupId, retry]);
  return <section className="native-status-panel" aria-label={`Receptor nativo de ${name}`}>
    <h4>{state ? `${providers[state.target.provider]} en este grupo` : 'Receptor nativo'}</h4>
    {error ? <><p role="alert">No pudimos consultar el estado nativo.</p><button className="button secondary" onClick={() => setRetry(value => value + 1)}>Reintentar estado nativo</button></> : <p role="status">{state ? refreshing ? 'Actualizando estado nativo…' : nativeStatusLabel(state) : 'Consultando estado nativo…'}</p>}
    {state && <>
      {!state.binding.enabled && state.jobs.some(job => job.state !== 'done') && <p>Respuestas nativas pausadas. El turno pendiente conserva su estado hasta confirmar su finalización.</p>}
      <dl>
        <dt>Bot o profile</dt><dd><code>{state.target.nativeRef}</code></dd>
        <dt>Conector</dt><dd>{state.target.connectorId}</dd>
        <dt>Revisión</dt><dd>{state.binding.revision}</dd>
        <dt>Contexto</dt><dd>{state.target.contextMode === 'native_per_group' ? 'Una conversación por grupo' : state.target.contextMode === 'shared_bot_context' ? 'Contexto compartido del bot' : 'Contexto no compatible'}</dd>
        <dt>Última señal del controlador</dt><dd>{state.controller.lastContactAt === null ? 'Sin señal autorizada' : new Date(state.controller.lastContactAt).toLocaleString('es-AR')}</dd>
      </dl>
      <p className="muted">Una señal del controlador no confirma la recepción ni la finalización en el bot.</p>
      <details><summary>Ver capacidades registradas</summary><dl>{(Object.keys(capabilityLabels) as (keyof NativeCapabilities)[]).map(key => <div key={key}><dt>{capabilityLabels[key]}</dt><dd>{state.target.capabilities[key] === 'verified' ? 'Verificada' : state.target.capabilities[key] === 'unsupported' ? 'No compatible' : 'Sin verificar'}</dd></div>)}</dl></details>
      <details><summary>Ver actividad nativa</summary>
        <p className="muted">Últimas 30 entregas de esta revisión y grupo. Los recibos confirman si hubo publicación.</p>
        {state.jobs.length === 0 && <p>Todavía no hay entregas nativas en este grupo.</p>}
        <ol aria-label={`Actividad nativa de ${name}`}>{state.jobs.map(job => <li key={job.eventId}>
          <strong>{nativeJobLabel(job)}</strong>
          {job.contentExpired ? <p>Contenido vencido; recibo conservado.</p> : <>{job.input !== null && <p>Entrada: {job.input}</p>}{job.output && <p>Salida: {job.output}</p>}</>}
          {job.receipt?.messageId && <p>Mensaje: <code>{job.receipt.messageId}</code></p>}
          {job.runRef && <p>Ejecución: <code>{job.runRef}</code></p>}
          {job.conversationRef && <p>Conversación nativa: <code>{job.conversationRef}</code></p>}
        </li>)}</ol>
      </details>
    </>}
  </section>;
}
