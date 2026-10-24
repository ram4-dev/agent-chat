import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { probeCodex } from '../../apps/bridge/src/codex/probe.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

type Mode = 'valid' | 'invalid-json' | 'rpc-error' | 'exit' | 'large' | 'request' | 'bad-schema' | 'config-missing' | 'hang' | 'version-hang' | 'schema-hang';
async function fixture(mode: Mode): Promise<{ binary: string; log: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-chat-fake-codex-'));
  directories.push(directory);
  const binary = join(directory, 'codex');
  const log = join(directory, 'calls.jsonl');
  await writeFile(binary, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const mode = ${JSON.stringify(mode)};
const log = ${JSON.stringify(log)};
const args = process.argv.slice(2);
if ((mode === 'version-hang' && args[0] === '--version') || (mode === 'schema-hang' && args[1] === 'generate-json-schema')) {
 appendFileSync(log, JSON.stringify({ home: process.env.CODEX_HOME, pid: process.pid }) + '\\n');
 process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
 await new Promise(() => {});
}
if (args[0] === '--version') { console.log('codex-cli 0.164.0'); process.exit(); }
if (args[1] === 'generate-json-schema') {
 const dest = join(args[args.indexOf('--out') + 1], 'v2'); mkdirSync(dest, { recursive: true });
 for (const name of ['ThreadStartParams', 'TurnStartParams', 'ThreadResumeParams'])
  writeFileSync(join(dest, name + '.json'), JSON.stringify(mode === 'bad-schema' ? {} : { properties: { threadId: { type: 'string' } } }));
 process.exit();
}
const input = createInterface({ input: process.stdin });
for await (const line of input) {
 const message = JSON.parse(line);
 appendFileSync(log, JSON.stringify({ method: message.method, cwd: process.cwd(), home: realpathSync(process.env.CODEX_HOME),
   inherited: Boolean(process.env.AGENT_CHAT_TEST_SECRET), args }) + '\\n');
 if (mode === 'exit') process.exit(1);
 if (mode === 'hang') continue;
 if (mode === 'invalid-json') { console.log('not-json-private-sentinel'); continue; }
 if (mode === 'large') { console.log('x'.repeat(3 * 1024 * 1024)); continue; }
 if (mode === 'request') { console.log(JSON.stringify({ id: 99, method: 'item/tool/call' })); continue; }
 if (mode === 'rpc-error') { console.log(JSON.stringify({ id: message.id, error: { message: 'private-sentinel' } })); continue; }
 if (message.method === 'initialize') console.log(JSON.stringify({ id: message.id, result: {} }));
 if (message.method === 'config/read') console.log(JSON.stringify({ id: message.id, result: mode === 'config-missing' ? {} : { config: {
  web_search: 'disabled', features: { shell_tool: false }, apps: { _default: { enabled: false } },
  private_setting: 'private-sentinel', mcp_servers: { sensitive: { token: 'private-sentinel' } }
 } } }));
}
`);
  await chmod(binary, 0o700);
  return { binary, log };
}

describe('Codex capability diagnostic without model execution', () => {
  it('reads only safe observations, uses an isolated home and never starts a model or MCP call', async () => {
    const { binary, log } = await fixture('valid');
    const previous = process.env['AGENT_CHAT_TEST_SECRET'];
    process.env['AGENT_CHAT_TEST_SECRET'] = 'test-only-do-not-forward';
    try {
      const report = await probeCodex(binary);
      expect(report).toMatchObject({
        version: 'codex-cli 0.164.0', automaticProcessing: false, modelTurnsStarted: 0,
        observations: { configRead: true, shellToolDisabled: true, webSearchDisabled: true, appsDisabled: true },
      });
      // Accepted config never turns into a readiness attestation.
      expect(report.checks.filter((check) => check.status === 'unverified').map((check) => check.name))
        .toEqual(['toolIsolation', 'turnRecovery', 'costBound', 'ownerPolicy']);
      expect(JSON.stringify(report)).not.toContain('private-sentinel');
      const calls = (await readFile(log, 'utf8')).trim().split('\n')
        .map((line) => JSON.parse(line) as { method: string; cwd: string; home: string; inherited: boolean });
      expect(calls.map((call) => call.method)).toEqual(['initialize', 'initialized', 'config/read']);
      for (const call of calls) {
        expect(call.inherited).toBe(false);
        expect(call.cwd).toBe(call.home);
      }
      await expect(readFile(join(calls[0]!.home, 'config.toml'))).rejects.toThrow();
      // The directory is removed, not merely a config file inside it.
      await expect(import('node:fs/promises').then(({ stat }) => stat(calls[0]!.home))).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env['AGENT_CHAT_TEST_SECRET'];
      else process.env['AGENT_CHAT_TEST_SECRET'] = previous;
    }
  });

  it.each(['version-hang', 'schema-hang'] as const)(
    'terminates a %s subprocess that ignores SIGTERM', async (mode) => {
      const { binary, log } = await fixture(mode);
      const started = Date.now();
      await expect(probeCodex(binary)).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(15_000);
      const stalled = JSON.parse((await readFile(log, 'utf8')).trim()) as { home: string; pid: number };
      await expect(import('node:fs/promises').then(({ stat }) => stat(stalled.home))).rejects.toThrow();
      expect(() => process.kill(stalled.pid, 0)).toThrow();
    },
  );

  it.each([
    ['invalid-json', 'rpc_invalid_json'], ['rpc-error', 'rpc_error'],
    ['exit', 'rpc_closed'], ['large', 'rpc_response_too_large'],
    ['request', 'rpc_unexpected_request'], ['bad-schema', 'invalid_schema'],
    ['config-missing', 'rpc_invalid_config'], ['hang', 'rpc_timeout'],
  ] as const)('fails closed for %s without exposing subprocess contents', async (mode, expected) => {
    const { binary } = await fixture(mode);
    await expect(probeCodex(binary)).rejects.toThrow(expected);
  });
});
