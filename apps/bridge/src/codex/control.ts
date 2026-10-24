import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid control response');
  return value as Record<string, unknown>;
}

/** MCP IO uses Codex's own OAuth store. No access/refresh tokens cross this API. */
export class CodexControl {
  private process?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  get alive(): boolean { return this.process !== undefined && !this.process.killed && this.process.exitCode === null && this.process.signalCode === null; }
  private threadId = '';
  private readonly server: string;
  get pid(): number | undefined { return this.process?.pid; }
  constructor(server = process.env['AGENT_CHAT_MCP_SERVER'] ?? 'agent-chat') { this.server = server; }
  async start(): Promise<void> {
    const args = ['app-server', '--listen', 'stdio://'];
    const url = process.env['AGENT_CHAT_MCP_URL'];
    if (url !== undefined) {
      const origin = new URL(url);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Invalid MCP origin');
      args.push('-c', `mcp_servers.${this.server}.url=${JSON.stringify(new URL('/mcp', origin).href)}`,
        '-c', `mcp_servers.${this.server}.bearer_token_env_var="AGENT_CHAT_MCP_TOKEN"`);
    }
    const child = spawn('codex', args, { stdio: 'pipe' });
    this.process = child;
    child.stderr.resume();
    const fail = () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex control disconnected')); }
      this.pending.clear();
    };
    child.on('error', fail); child.on('close', fail); child.stdin.on('error', fail);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const message = object(JSON.parse(line) as unknown);
        if (typeof message['id'] !== 'number') return;
        const waiter = this.pending.get(message['id']);
        if (waiter === undefined) return;
        this.pending.delete(message['id']); clearTimeout(waiter.timer);
        if ('error' in message) waiter.reject(new Error('Codex control request failed'));
        else waiter.resolve(message['result']);
      } catch { fail(); }
    });
    await this.rpc('initialize', { clientInfo: { name: 'agent-chat-receiver', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    const context = object(await this.rpc('thread/start', { ephemeral: true, cwd: process.cwd() }));
    const thread = object(context['thread']);
    if (typeof thread['id'] !== 'string') throw new Error('No MCP context');
    this.threadId = thread['id'];
    await this.call('get_identity', {});
  }
  private rpc(method: string, params: object): Promise<unknown> {
    if (!this.alive) return Promise.reject(new Error('Codex control disconnected'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex control timed out')); }, 45_000);
      this.pending.set(id, { resolve, reject, timer });
      this.process!.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  async call<T>(tool: string, args: object): Promise<T> {
    const result = object(await this.rpc('mcpServer/tool/call', {
      threadId: this.threadId, server: this.server, tool, arguments: args,
    }));
    if (result['isError'] === true) {
      const content = result['content'];
      const code = Array.isArray(content) ? object(content[0])['text'] : 'MCP refused';
      throw new Error(typeof code === 'string' && /^[a-z_]+$/.test(code) ? code : 'MCP refused');
    }
    const content = result['content'];
    if (!Array.isArray(content)) throw new Error('Invalid MCP result');
    const text = content.map((c: unknown) => { const item = object(c); return item['type'] === 'text' ? item['text'] : ''; }).join('');
    return JSON.parse(text) as T;
  }
  close(): void {
    const child = this.process;
    if (child === undefined) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 1500); timer.unref();
    child.once('close', () => clearTimeout(timer));
  }
}
