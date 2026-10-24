/** Capability spike: explicit native session; never overrides model, prompt or tools. */
export type NativeRunStatus = 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface NativeRun {
  runId: string;
  sessionId: string | null;
  status: NativeRunStatus;
  output: string | null;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid native response');
  return value as Record<string, unknown>;
}

export class HermesRunsProbe {
  constructor(private readonly origin: string, private readonly token: string) {
    const url = new URL(origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid native endpoint');
    }
  }
  private async request(path: string, method: string, body?: object, key?: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${this.origin.replace(/\/$/, '')}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      const code = (cause as { cause?: { code?: unknown } } | null)?.cause?.code;
      const detail = typeof code === 'string' && /^[A-Z_0-9]+$/.test(code) ? ` (${code})` : '';
      throw new Error(`Native request unconfirmed; do not retry an ambiguous start${detail}`, { cause });
    }
    if (!response.ok) throw new Error(`Native request rejected (${response.status})`);
    // Never include raw provider bodies in errors: they may contain private input.
    try { return record(await response.json()); }
    catch { throw new Error('Invalid native response'); }
  }
  async start(sessionId: string, input: string, idempotencyKey: string): Promise<string> {
    if (!sessionId || !idempotencyKey || !input) throw new Error('Explicit session, input and start key required');
    const result = await this.request('/v1/runs', 'POST', { session_id: sessionId, input }, idempotencyKey);
    if (typeof result['run_id'] !== 'string' || !result['run_id']) throw new Error('Native start unconfirmed');
    return result['run_id'];
  }
  async status(runId: string): Promise<NativeRun> {
    const result = await this.request(`/v1/runs/${encodeURIComponent(runId)}`, 'GET');
    const status = result['status'];
    if (!['running', 'waiting_for_approval', 'completed', 'failed', 'cancelled', 'interrupted'].includes(String(status))) throw new Error('Unknown native status');
    return { runId, status: status as NativeRunStatus,
      sessionId: typeof result['session_id'] === 'string' ? result['session_id'] : null,
      output: typeof result['output'] === 'string' ? result['output'] : null };
  }
}
