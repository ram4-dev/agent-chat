import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedCommand } from './isolated-command.js';

interface Observation { model?: string; instructions?: string; tools?: unknown[]; input?: unknown }
export function hasNativeTools(observation: Observation): boolean {
  if (Array.isArray(observation.tools) && observation.tools.length > 0) return true;
  // New Responses transport carries tools as additional_tools developer items.
  return Array.isArray(observation.input) && observation.input.some((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    const entry = item as Record<string, unknown>;
    return entry['type'] === 'additional_tools' && Array.isArray(entry['tools']) && entry['tools'].length > 0;
  });
}
export interface ProfileProbeResult {
  profileSelected: boolean; instructionsPreserved: boolean; workspaceRulesPreserved: boolean;
  toolsPreserved: boolean; conversationResumed: boolean; requests: number;
}

/** Runs the installed Codex with disposable config and a wire-level fake provider. */
export async function probeNativeProfile(): Promise<ProfileProbeResult> {
  const root = await mkdtemp(join(tmpdir(), 'agent-chat-native-profile-'));
  const home = join(root, 'home'); const workspace = join(root, 'workspace');
  const observations: Observation[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk as Uint8Array); size += buffer.length;
        if (size > 2 * 1024 * 1024) throw new Error('Oversized fixture request');
        chunks.push(buffer);
      }
      if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
        response.writeHead(404).end(); return;
      }
      observations.push(JSON.parse(Buffer.concat(chunks).toString()) as Observation);
      const text = 'Native profile fixture complete';
      const message = { id: 'probe-message', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
      const events = [
        { type: 'response.created', response: { id: 'probe-response' } },
        { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } },
        { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: text },
        { type: 'response.output_item.done', output_index: 0, item: message },
        { type: 'response.completed', response: { id: 'probe-response', status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
    } catch { response.writeHead(400).end(); }
  });
  try {
    await mkdir(home); await mkdir(workspace);
    const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: home, CODEX_HOME: home, TMPDIR: tmpdir() };
    const catalogText = await isolatedCommand('codex', ['debug', 'models'], {
      env, cwd: workspace, timeoutMs: 15_000, maxBytes: 8 * 1024 * 1024,
    });
    const catalog = JSON.parse(catalogText) as { models?: Record<string, unknown>[] };
    const nativeModel = catalog.models?.find(model => model['slug'] === 'gpt-6.1-sol');
    if (!nativeModel) throw new Error('Native model metadata unavailable');
    await writeFile(join(home, 'catalog.json'), JSON.stringify({ models: [nativeModel] }));
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
    await writeFile(join(home, 'config.toml'), `model = "gpt-6-sol"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Local fixture"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
    await writeFile(join(home, 'native-probe.config.toml'), `model = "gpt-6.1-sol"\nmodel_catalog_json = ${JSON.stringify(join(home, 'catalog.json'))}\nmodel_instructions_file = ${JSON.stringify(join(home, 'persona.md'))}\n`);
    await writeFile(join(home, 'persona.md'), 'NATIVE_PROFILE_SENTINEL: retain this configured persona.');
    await writeFile(join(workspace, 'AGENTS.md'), 'NATIVE_WORKSPACE_SENTINEL: preserve these workspace rules.');
    let first: string | undefined; let resumed: string | undefined;
    for (let round = 0; round < 2; round++) {
      const args = ['exec', '--profile', 'native-probe', '--json', '--skip-git-repo-check', '-C', workspace];
      if (first) args.push('resume', first);
      args.push('Capability fixture only; reply without using tools.');
      let stdout: string;
      try {
        stdout = await isolatedCommand('codex', args, { env, cwd: workspace, timeoutMs: 30_000, maxBytes: 2 * 1024 * 1024 });
      }
      catch (cause) { throw new Error('Native profile probe failed; no user configuration was loaded', { cause }); }
      let thread: string | undefined;
      for (const line of stdout.trim().split('\n')) {
        const event = JSON.parse(line) as { type?: string; thread_id?: string };
        if (event.type === 'thread.started') thread = event.thread_id;
      }
      if (!thread) throw new Error('Native conversation was not confirmed');
      if (round === 0) first = thread; else resumed = thread;
    }
    const result = {
      profileSelected: observations.every(r => r.model === 'gpt-6.1-sol'),
      instructionsPreserved: observations.every(r => JSON.stringify(r).includes('NATIVE_PROFILE_SENTINEL')),
      workspaceRulesPreserved: observations.every(r => JSON.stringify(r).includes('NATIVE_WORKSPACE_SENTINEL')),
      toolsPreserved: observations.every(hasNativeTools),
      conversationResumed: first === resumed, requests: observations.length,
    };
    if (result.requests !== 2 || Object.values(result).some(value => value === false)) throw new Error('Native profile capability was not demonstrated', { cause: result });
    return result;
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
}
