import { createHash } from 'node:crypto';
/** Capability spike: explicit native session; never overrides model, prompt or tools. */
export type NativeRunStatus = 'queued' | 'stopping' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface NativeRun {
  runId: string;
  sessionId: string | null;
  status: NativeRunStatus;
  output: string | null;
  completed: boolean; interrupted: boolean; partial: boolean;
  approval: { requestId: string; command: string | null; choices: string[] } | null;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid native response');
  return value as Record<string, unknown>;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, sorted(entry)]));
  return value;
}
export function hermesRunFingerprint(sessionId: string, input: string, author?: { id: string; name: string; is_bot: boolean }): string {
  return createHash('sha256').update(JSON.stringify(sorted({ body: { session_id: sessionId, input, ...(author ? { turn_author: author } : {}) }, gateway_session_key: '' }))).digest('hex');
}

export class HermesRunsProbe {
  constructor(private readonly origin: string, private readonly token: string) {
    const url = new URL(origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid native endpoint');
    }
  }
  private async request(path: string, method: string, body?: object, key?: string, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${path.startsWith('/agent-chat/') ? new URL(this.origin).origin : this.origin.replace(/\/$/, '')}${path}`, {
        method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}), ...extraHeaders },
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
  async start(sessionId: string, input: string, idempotencyKey: string, author?: { id: string; name: string; is_bot: boolean }, signal?: AbortSignal): Promise<string> {
    if (!sessionId || !idempotencyKey || !input) throw new Error('Explicit session, input and start key required');
    const result = await this.request('/v1/runs', 'POST', { session_id: sessionId, input, ...(author ? { turn_author: author } : {}) }, idempotencyKey, signal);
    if (typeof result['run_id'] !== 'string' || !result['run_id']) throw new Error('Native start unconfirmed');
    return result['run_id'];
  }
  async status(runId: string, signal?: AbortSignal): Promise<NativeRun> {
    const result = await this.request(`/v1/runs/${encodeURIComponent(runId)}`, 'GET', undefined, undefined, signal);
    const status = result['status'];
    if (!['queued', 'stopping', 'running', 'waiting_for_approval', 'completed', 'failed', 'cancelled', 'interrupted'].includes(String(status))) throw new Error('Unknown native status');
    return { runId, status: status as NativeRunStatus,
      sessionId: typeof result['session_id'] === 'string' ? result['session_id'] : null,
      output: typeof result['output'] === 'string' ? result['output'] : null,
      completed: result['completed'] === true, interrupted: result['interrupted'] === true, partial: result['partial'] === true,
      approval: typeof result['approval'] === 'object' && result['approval'] !== null && typeof (result['approval'] as Record<string, unknown>)['request_id'] === 'string'
        ? { requestId: String((result['approval'] as Record<string, unknown>)['request_id']), command: typeof (result['approval'] as Record<string, unknown>)['command'] === 'string' ? String((result['approval'] as Record<string, unknown>)['command']) : null,
          choices: Array.isArray((result['approval'] as Record<string, unknown>)['choices']) ? ((result['approval'] as Record<string, unknown>)['choices'] as unknown[]).filter((value): value is string => typeof value === 'string') : [] } : null };
  }
  private recoveryPath(path: string): string {
    const match = /^\/p\/([^/]+)\/?$/.exec(new URL(this.origin).pathname);
    if (!match) throw new Error('Explicit Hermes profile URL required');
    return `/agent-chat/v1/profiles/${match[1]}${path}`;
  }
  async recoveryCapabilities(): Promise<Record<string, unknown>> { return await this.request(this.recoveryPath('/capabilities'), 'GET'); }
  async lookup(startKey: string, fingerprint: string, signal?: AbortSignal): Promise<Record<string, unknown>> { return await this.request(this.recoveryPath(`/runs/by-key/${encodeURIComponent(startKey)}`), 'GET', undefined, undefined, signal, { 'X-Agent-Chat-Fingerprint': fingerprint }); }
  async capabilities(): Promise<Record<string, unknown>> { return await this.request('/v1/capabilities', 'GET'); }
  async approve(runId: string, requestId: string, choice: 'once' | 'deny'): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/approval`, 'POST', { request_id: requestId, choice });
  }
  async stop(runId: string): Promise<void> { await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, 'POST'); }
  async history(sessionId: string): Promise<Record<string, unknown>> { return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, 'GET'); }
}
