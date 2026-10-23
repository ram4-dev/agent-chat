import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export interface RuntimeCheck {
  name: 'transport' | 'toolIsolation' | 'turnRecovery' | 'costBound' | 'ownerPolicy';
  status: 'verified' | 'unverified';
  reason: string;
}

export interface CodexProbeReport {
  schemaVersion: 1;
  version: string;
  automaticProcessing: false;
  modelTurnsStarted: 0;
  observations: {
    isolatedHome: true;
    configRead: boolean;
    webSearchDisabled: boolean;
    shellToolDisabled: boolean;
    appsDisabled: boolean;
    startFields: string[];
    turnFields: string[];
    resumeFields: string[];
  };
  checks: RuntimeCheck[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function properties(schema: unknown): string[] {
  const fields = record(record(schema)?.['properties']);
  if (fields === undefined || Object.keys(fields).length === 0) {
    throw new Error('invalid_schema');
  }
  return Object.keys(fields).sort();
}

/** Only initialize and config/read are permitted. No model or MCP tool calls. */
async function readIsolatedConfig(
  binary: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  const child = spawn(binary, [
    'app-server', '--listen', 'stdio://',
    '-c', 'web_search="disabled"',
    '-c', 'features.shell_tool=false',
    '-c', 'apps._default.enabled=false',
  ], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });

  return await new Promise((resolve, reject) => {
    let buffer = '';
    let bytes = 0;
    let completed = false;
    const timer = setTimeout(() => finish(new Error('rpc_timeout')), TIMEOUT_MS);
    function finish(error?: Error, result?: unknown): void {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
      killTimer.unref();
      child.once('close', () => clearTimeout(killTimer));
      const settle = (): void => {
        if (error !== undefined) reject(error);
        else resolve(result);
      };
      // Finish only after the process exits, before deleting its temporary home.
      if (child.exitCode !== null || child.signalCode !== null) settle();
      else child.once('close', settle);
    }
    function send(message: Record<string, unknown>): void {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    child.on('error', () => finish(new Error('rpc_spawn_failed')));
    child.stdin.on('error', () => finish(new Error('rpc_write_failed')));
    child.on('close', () => finish(new Error('rpc_closed')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_RESPONSE_BYTES) return finish(new Error('rpc_response_too_large'));
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0 && !completed) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: Record<string, unknown> | undefined;
        try { message = record(JSON.parse(line) as unknown); }
        catch { return finish(new Error('rpc_invalid_json')); }
        if (message === undefined) return finish(new Error('rpc_invalid_response'));
        if ('method' in message) {
          if ('id' in message) return finish(new Error('rpc_unexpected_request'));
          continue;
        }
        if ('error' in message) return finish(new Error('rpc_error'));
        if (message['id'] === 1 && 'result' in message) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'config/read', params: { includeLayers: false } });
        } else if (message['id'] === 2 && 'result' in message) {
          finish(undefined, message['result']);
        } else return finish(new Error('rpc_unexpected_response'));
      }
    });
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'agent-chat-capability-probe', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    } });
  });
}

/**
 * A diagnostic, not a worker. A schema or accepted config never attests isolation,
 * start idempotency, or a hard economic bound. Until demonstrated, auto stays off.
 * The temporary home has no login, MCP configuration, or project instructions.
 */
export async function probeCodex(binary = 'codex'): Promise<CodexProbeReport> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-chat-codex-probe-'));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'],
    HOME: directory,
    CODEX_HOME: directory,
    TMPDIR: tmpdir(),
  };
  try {
    const { stdout } = await execute(binary, ['--version'], {
      env, cwd: directory, timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1024,
    });
    const version = stdout.trim();
    if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
      throw new Error('invalid_version');
    }
    const schemaPath = join(directory, 'schema');
    await execute(binary, ['app-server', 'generate-json-schema', '--experimental', '--out', schemaPath], {
      env, cwd: directory, timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: MAX_RESPONSE_BYTES,
    });
    const schemas = await Promise.all(['ThreadStartParams', 'TurnStartParams', 'ThreadResumeParams']
      .map(async (name) => properties(JSON.parse(
        await readFile(join(schemaPath, 'v2', `${name}.json`), 'utf8'),
      ) as unknown)));
    const effective = record(record(await readIsolatedConfig(binary, directory, env))?.['config']);
    if (effective === undefined) throw new Error('rpc_invalid_config');
    // Extract an allowlist; never log config bodies or credential-bearing layers.
    const features = record(effective['features']);
    const apps = record(effective['apps']);
    const defaults = record(apps?.['_default']);
    return {
      schemaVersion: 1,
      version,
      automaticProcessing: false,
      modelTurnsStarted: 0,
      observations: {
        isolatedHome: true,
        configRead: true,
        webSearchDisabled: effective['web_search'] === 'disabled',
        shellToolDisabled: features?.['shell_tool'] === false,
        appsDisabled: defaults?.['enabled'] === false,
        startFields: schemas[0]!, turnFields: schemas[1]!, resumeFields: schemas[2]!,
      },
      checks: [
        { name: 'transport', status: 'verified', reason: 'initialize/config/read completed locally without starting a model turn' },
        { name: 'toolIsolation', status: 'unverified', reason: 'accepted settings do not attest the full built-in/MCP tool catalog at start and resume' },
        { name: 'turnRecovery', status: 'unverified', reason: 'durable one-use dispatch and positive reconciliation have not been demonstrated with this runtime' },
        { name: 'costBound', status: 'unverified', reason: 'no verified enforceable bound covering all billable usage; goal/tool-output budgets are not proof' },
        { name: 'ownerPolicy', status: 'unverified', reason: 'no explicit owner-approved model and monetary budget for an automatic binding or real-model test' },
      ],
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
