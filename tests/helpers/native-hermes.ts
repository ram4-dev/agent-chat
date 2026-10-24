import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import * as tls from 'node:tls';
import { HermesRunsProbe } from '../../apps/bridge/src/adapters/hermes-runs';

/** Opt-in capability fixture: installed Hermes, isolated home, no real provider. */
export async function nativeHermes(source: string) {
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    throw new Error('Native TLS fixture requires Node TLS getCACertificates/setDefaultCACertificates');
  }
  const root = await mkdtemp(join(tmpdir(), 'agent-chat-native-hermes-'));
  const report = join(root, 'requests.json');
  const token = randomBytes(32).toString('hex');
  const originalCAs = tls.getCACertificates('default');
  const command = promisify(execFile)('hermes', ['--print-runtime-command'], { timeout: 15_000, maxBuffer: 64 * 1024 });
  command.child.stdin?.end();
  const runtime: unknown = JSON.parse((await command).stdout);
  if (!Array.isArray(runtime) || typeof runtime[0] !== 'string') throw new Error('Hermes Python unavailable');
  const python: string = runtime[0];
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
        NATIVE_FIXTURE_HOME: join(root, 'profile'), NATIVE_FIXTURE_REPORT: report, NATIVE_FIXTURE_KEY: token },
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
      child!.once('exit', () => { clearTimeout(timer); reject(new Error('Isolated Hermes exited before readiness')); });
      child!.once('error', () => { clearTimeout(timer); reject(new Error('Portless or Hermes unavailable')); });
    });
    if (ready.origin.startsWith('https:')) {
      if (!ready.caFile) throw new Error('Portless certificate was not advertised');
      // Trust only the public CA advertised by this owned test process. Validation
      // remains enabled; no OS trust-store or user configuration is changed.
      const certificate = await readFile(ready.caFile, 'utf8');
      tls.setDefaultCACertificates([...originalCAs, certificate]);
    }
    return new HermesRunsProbe(ready.origin, token);
  }
  async function observations(): Promise<{ messages: { role: string; content: unknown }[]; tools?: unknown[] }[]> {
    const value = JSON.parse(await readFile(report, 'utf8')) as { requests: { messages: { role: string; content: unknown }[]; tools?: unknown[] }[] };
    return value.requests;
  }
  return { start, stop, observations, close: async () => {
    try { await stop(); } finally { tls.setDefaultCACertificates(originalCAs); await rm(root, { recursive: true, force: true }); }
  } };
}
