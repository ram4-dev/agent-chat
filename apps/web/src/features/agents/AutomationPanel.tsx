import { useEffect, useState } from 'react';

interface State {
  binding: { enabled: boolean; connected: boolean; model: string; threadId: string | null; lastError: string | null } | null;
  jobs: { eventId: string; state: string; decision: string | null; output: string | null; threadId: string | null; messageId: string | null; error: string | null }[];
}

export function AutomationPanel({ agentId, groupId, name }: { agentId: string; groupId: string; name: string }) {
  const [state, setState] = useState<State>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const path = `/api/agents/${agentId}/automation/${groupId}`;
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(path);
        if (!response.ok) throw new Error();
        const next = await response.json() as State;
        if (active) { setState(next); setError(''); }
      } catch { if (active) setError('No pudimos consultar el receptor automático.'); }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [path]);
  async function toggle() {
    setBusy(true);
    try {
      const response = await fetch(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !state?.binding?.enabled }) });
      if (!response.ok) throw new Error();
      const result = await response.json() as Pick<State, 'binding'>;
      setState((old) => ({ binding: result.binding, jobs: old?.jobs ?? [] }));
      setError('');
    } catch { setError('No pudimos cambiar las respuestas automáticas.'); }
    finally { setBusy(false); }
  }
  const running = state?.jobs.some((job) => job.state === 'running');
  const blocked = state?.jobs.some((job) => job.state === 'needs_review');
  return <section aria-label={`Respuestas automáticas de ${name}`}>
    <h4>Codex en este grupo</h4>
    <p role="status">{!state ? 'Consultando receptor…' : !state.binding?.enabled ? 'Respuestas automáticas pausadas' : blocked ? 'El turno requiere revisión' : running ? 'Codex está procesando un mensaje' : state.binding.connected ? 'Receptor automático conectado' : 'Esperando el puente de Codex'}</p>
    {state?.binding?.lastError && <p role="alert" className="error-box">{state.binding.lastError}</p>}
    {error && <p role="alert" className="error-box">{error}</p>}
    <button className="button secondary" disabled={busy || !state} onClick={() => { void toggle(); }}>
      {state?.binding?.enabled ? 'Pausar respuestas automáticas' : 'Activar respuestas automáticas'}
    </button>
    <details><summary>Ver actividad de Codex</summary>
      <p className="muted">Modelo: {state?.binding?.model ?? 'gpt-6.1-sol'}. Un hilo dedicado por grupo.</p>
      {state?.binding?.threadId && <p>Hilo: <code>{state.binding.threadId}</code></p>}
      {state?.jobs.length === 0 && <p>Todavía no se procesaron mensajes.</p>}
      <ol aria-label={`Actividad automática de ${name}`}>
        {state?.jobs.map((job) => <li key={job.eventId}>
          <strong>{job.state === 'done' ? job.decision === 'reply' ? job.messageId ? 'Respuesta publicada' : 'Confirmado sin publicar' : 'Sin respuesta' : job.state === 'needs_review' ? 'Revisión necesaria' : job.state === 'running' ? 'Procesando' : 'Resultado guardado'}</strong>
          {job.output && <p>{job.output}</p>}{job.error && <p role="alert">{job.error}</p>}
        </li>)}
      </ol>
    </details>
  </section>;
}
