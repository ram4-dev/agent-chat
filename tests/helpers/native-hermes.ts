import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import * as tls from 'node:tls';
import { HermesRunsProbe } from '../../apps/bridge/src/adapters/hermes-runs';

/** Opt-in capability fixture: installed Hermes, isolated home, no real provider. */
export async function nativeHermes(source: string, temporaryParent = tmpdir()) {
  const root = await mkdtemp(join(temporaryParent, 'agent-chat-native-hermes-'));
  const report = join(root, 'requests.json');
  const token = randomBytes(32).toString('hex');
  const originalCAs = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('default') : [];
  let python: string;
  let revision: string;
  try {
    const env = { PATH: process.env['PATH'], HOME: root, HERMES_HOME: join(root, 'profile'),
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
    const command = promisify(execFile)('hermes', ['--print-runtime-command'], {
      env, cwd: root, timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
    });
    command.child.stdin?.end();
    const runtime: unknown = JSON.parse((await command).stdout);
    if (!Array.isArray(runtime) || typeof runtime[0] !== 'string') throw new Error('Hermes Python unavailable');
    python = runtime[0];
    const resolved = await promisify(execFile)('git', ['--no-replace-objects', '-C', resolve(source), 'rev-parse', 'HEAD'], {
      env, cwd: root, timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
    });
    revision = resolved.stdout.trim();
    if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('Hermes source revision unavailable');
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    throw new Error('Isolated Hermes discovery failed', { cause });
  }
  let child: ReturnType<typeof spawn> | undefined;
  let closed = true;
  async function stop() {
    if (!child?.pid) return;
    const id = child.pid;
    const done = new Promise<void>(resolve => { if (closed) resolve(); else child!.once('close', () => resolve()); });
    try { process.kill(-id, 'SIGTERM'); } catch { /* Already closed. */ }
    const timer = setTimeout(() => { try { process.kill(-id, 'SIGKILL'); } catch { /* Already closed. */ } }, 3000);
    await done; clearTimeout(timer);
    child = undefined;
  }
  async function start() {
    const processName = `agent-chat-hermes-${randomUUID().slice(0, 8)}`;
    child = spawn('portless', [processName, python, resolve('tests/fixtures/native-runtimes/hermes-server.py'), resolve(source)], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      // Portless needs its existing proxy state. The Python fixture replaces HOME
      // with the disposable profile before importing any Hermes modules.
      env: { PATH: process.env['PATH'], HOME: process.env['HOME'], HERMES_HOME: join(root, 'profile'),
        NATIVE_FIXTURE_HOME: join(root, 'profile'), NATIVE_FIXTURE_REPORT: report, NATIVE_FIXTURE_KEY: token,
        NATIVE_FIXTURE_SOURCE_REVISION: revision },
    });
    closed = false;
    child.once('close', () => { closed = true; });
    const stdout = child.stdout!;
    const ready = await new Promise<{ origin: string; caFile?: string }>((resolveReady, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('Isolated Hermes startup timed out')), 120_000);
      const observe = (chunk: Buffer) => {
        text = (text + chunk.toString()).slice(-64 * 1024);
        const receipt = text.match(/\{"type": "native-fixture.ready"[^\r\n]*\}/)?.[0];
        if (!receipt) return;
        let value: { origin?: unknown; caFile?: unknown };
        try { value = JSON.parse(receipt) as typeof value; } catch { return; }
        if (typeof value.origin !== 'string' || !new URL(value.origin).hostname.endsWith('.localhost')) return;
        clearTimeout(timer);
        resolveReady({ origin: value.origin, ...(typeof value.caFile === 'string' ? { caFile: value.caFile } : {}) });
      };
      stdout.on('data', observe);
      child!.stderr?.on('data', observe);
      child!.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(`Isolated Hermes exited before readiness: ${text.slice(-2500).replaceAll(token, '[fixture-key]')}`));
      });
      child!.once('error', () => { clearTimeout(timer); reject(new Error('Portless or Hermes unavailable')); });
    });
    if (ready.origin.startsWith('https:')) {
      if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
        throw new Error('Native TLS fixture requires Node TLS getCACertificates/setDefaultCACertificates');
      }
      if (!ready.caFile) throw new Error('Portless certificate was not advertised');
      // Trust only the public CA advertised by this owned test process. Validation
      // remains enabled; no OS trust-store or user configuration is changed.
      const certificate = await readFile(ready.caFile, 'utf8');
      tls.setDefaultCACertificates([...originalCAs, certificate]);
    }
    return new HermesRunsProbe(ready.origin, token);
  }
  async function observations(): Promise<{ generation: string; requests: {
    fixture_generation: string; fixture_sequence: number; fixture_kind: string;
    messages: { role: string; content: unknown }[];
    tools?: { function?: { name?: string } }[];
  }[] }> {
    return JSON.parse(await readFile(report, 'utf8')) as Awaited<ReturnType<typeof observations>>;
  }
  return { start, stop, observations, close: async () => {
    try { await stop(); } finally {
      if (typeof tls.setDefaultCACertificates === 'function') tls.setDefaultCACertificates(originalCAs);
      await rm(root, { recursive: true, force: true });
    }
  } };
}
