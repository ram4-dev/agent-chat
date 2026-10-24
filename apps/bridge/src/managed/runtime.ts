import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';
import { ManagedAuth } from './auth.js';
import { ReceiverJournal } from './journal.js';
import { ManagedProcessor } from './processor.js';
import type { WorkerPort } from '../receiver.js';

export async function runManagedReceiver(provider: ManagedAuth, signal: AbortSignal, worker: WorkerPort & { prepare(): Promise<void> }): Promise<void> {
  if (!provider.tokens()) throw new Error('Receiver authorization required');
  const client = new Client({ name: 'agent-chat-mac-receiver', version: '1.0.0' });
  let journal: ReceiverJournal | undefined;
  let socket: WebSocket | undefined;
  let timer: NodeJS.Timeout | undefined;
  let draining: Promise<void> | undefined;
  let closeTimer: NodeJS.Timeout | undefined;
  const call = async <T>(name: string, args: object): Promise<T> => {
    const result = await client.callTool({ name, arguments: { ...args } });
    if (result.isError) throw new Error('Agent Chat refused a receiver operation');
    const text = (result.content as Array<{ type: string; text?: string }>).find((item) => item.type === 'text')?.text;
    if (!text) throw new Error('Invalid MCP response');
    return JSON.parse(text) as T;
  };
  const stopSocket = () => {
    if (!socket) return;
    socket.close(1000, 'receiver stopping');
    closeTimer = setTimeout(() => socket?.terminate(), 1500); closeTimer.unref();
  };
  signal.addEventListener('abort', stopSocket, { once: true });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${provider.origin}/mcp`), { authProvider: provider }));
    const identity = await call<{ agent: { id: string; name: string } }>('get_identity', {});
    const guide = await call<{ receiver: { url: string }; granted_scopes: string[] }>('get_agent_instructions', {});
    for (const scope of ['agent:read', 'agent:send', 'agent:inbox', 'agent:receive']) {
      if (!guide.granted_scopes.includes(scope)) throw new Error('Receiver lacks a required OAuth scope');
    }
    const receiverUrl = new URL('/ws/agent', provider.origin);
    receiverUrl.protocol = receiverUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    if (guide.receiver.url !== receiverUrl.href) throw new Error('Receiver origin mismatch');
    journal = new ReceiverJournal(provider.directory, identity.agent.id);
    await worker.prepare();
    if (signal.aborted) return;
    const processor = new ManagedProcessor({ call }, worker, journal, signal);
    socket = new WebSocket(receiverUrl, { headers: { authorization: `Bearer ${provider.tokens()!.access_token}` } });
    const active = socket;
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const readyTimeout = setTimeout(() => { active.terminate(); reject(new Error('Receiver readiness timed out')); }, 10_000);
      const fail = () => { clearTimeout(readyTimeout); if (signal.aborted) resolve(); else reject(new Error('Receiver disconnected')); };
      const drain = () => {
        if (draining || signal.aborted) return;
        draining = processor.drain().catch(() => { active.terminate(); fail(); }).finally(() => { draining = undefined; });
      };
      active.on('error', fail);
      active.on('unexpected-response', (_request, response) => { response.resume(); active.terminate(); fail(); });
      active.on('close', () => { clearTimeout(readyTimeout); if (signal.aborted) resolve(); else fail(); });
      active.on('message', (raw) => {
        try {
          const event = JSON.parse(String(raw)) as { type: string; agent_id?: string };
          if (!ready) {
            if (event.type !== 'receiver.ready' || event.agent_id !== identity.agent.id) throw new Error('Invalid receiver identity');
            ready = true; clearTimeout(readyTimeout);
            console.log(JSON.stringify({ type: 'receiver.ready', agent_id: identity.agent.id }));
            timer = setInterval(drain, 10_000);
            drain();
          } else if (event.type === 'inbox.event') drain();
        } catch { active.terminate(); fail(); }
      });
    });
  } finally {
    if (timer) clearInterval(timer);
    if (closeTimer) clearTimeout(closeTimer);
    socket?.terminate();
    signal.removeEventListener('abort', stopSocket);
    await draining;
    journal?.close();
    await client.close();
  }
}
