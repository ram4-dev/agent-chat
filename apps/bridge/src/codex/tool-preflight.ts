import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Render the actual tool set against a local fake Responses server, never a model. */
export async function verifyNoTools(argumentsFor: (threadId?: string) => string[]): Promise<{ start: number; resume: number }> {
  const execute = promisify(execFile);
  const home = await mkdtemp(join(tmpdir(), 'agent-chat-tools-'));
  const catalog: number[] = [];
  const server = createServer(async (request, response) => {
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const data = Buffer.from(chunk as Uint8Array); size += data.length;
        if (size > 1024 * 1024) throw new Error('Request too large');
        chunks.push(data);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tools?: unknown[] };
      if (body.tools !== undefined && !Array.isArray(body.tools)) throw new Error('Invalid tools');
      catalog.push(body.tools?.length ?? 0);
      const text = '{"decision":"no_reply","text":""}';
      const events = [
        { type: 'response.created', response: { id: 'preflight_response' } },
        { type: 'response.output_item.added', output_index: 0, item: { id: 'preflight_message', type: 'message', role: 'assistant', content: [] } },
        { type: 'response.output_text.delta', item_id: 'preflight_message', output_index: 0, content_index: 0, delta: text },
        { type: 'response.output_item.done', output_index: 0, item: { id: 'preflight_message', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } },
        { type: 'response.completed', response: { id: 'preflight_response', status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ];
      const data = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
      response.writeHead(200, { 'content-type': 'text/event-stream', 'content-length': Buffer.byteLength(data) }); response.end(data);
    } catch { response.writeHead(400); response.end(); }
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Preflight unavailable');
    const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: home, CODEX_HOME: home, TMPDIR: tmpdir() };
    let threadId: string | undefined;
    for (let round = 0; round < 2; round++) {
      const args = argumentsFor(threadId);
      // Root overrides precede the resume subcommand (all are still worker restrictions).
      const position = args.indexOf('resume') >= 0 ? args.indexOf('resume') : args.length - 1;
      args.splice(position, 0, '-c', 'model_provider="agent_chat_preflight"',
        '-c', 'model_providers.agent_chat_preflight.name="Local preflight"',
        '-c', `model_providers.agent_chat_preflight.base_url="http://127.0.0.1:${address.port}/v1"`,
        '-c', 'model_providers.agent_chat_preflight.wire_api="responses"',
        '-c', 'model_providers.agent_chat_preflight.requires_openai_auth=false');
      const command = execute('codex', [...args.slice(0, -1), 'Preflight only. Return no_reply.'], {
        env, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      });
      command.child.stdin?.end();
      const result = await command;
      for (const line of result.stdout.split('\n')) {
        if (!line) continue;
        const event = JSON.parse(line) as { type?: string; thread_id?: string };
        if (event.type === 'thread.started') threadId = event.thread_id;
      }
      if (!threadId) throw new Error('Preflight thread missing');
    }
    if (catalog.length !== 2 || catalog.some((count) => count !== 0)) throw new Error('Worker has unexpected tool capabilities');
    return { start: catalog[0]!, resume: catalog[1]! };
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(home, { recursive: true, force: true }); }
}
