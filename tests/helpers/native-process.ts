import { stripVTControlCharacters } from 'node:util';
import { spawn, type ChildProcess } from 'node:child_process';
const ownership = new WeakMap<ChildProcess, { closed: boolean; childPid: () => number | undefined }>();
export function child(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const childEnv = { ...env };
  // Invoking the installed CLI, not a package download through pnpm exec.
  if (command === 'portless') delete childEnv['npm_command'];
  const process = spawn(command, args, { env: childEnv, detached: true, stdio: ['ignore','pipe','pipe'] });
  let output = '';
  process.stdout!.on('data', chunk => { output += String(chunk); });
  process.stderr!.on('data', chunk => { output += String(chunk); });
  const state = { closed: false, childPid: () => { const value = /"fixturePid":(\d+)/.exec(stripVTControlCharacters(output))?.[1]; return value ? Number(value) : undefined; } };
  ownership.set(process, state); process.once('close', () => { state.closed = true; });
  return { process, output: () => stripVTControlCharacters(output) };
}
export async function stop(process: ChildProcess) {
  const state = ownership.get(process)!;
  if (state.closed) return;
  const childPid = state.childPid();
  const signal = (pid: number | undefined, kind: NodeJS.Signals) => { if (pid) { try { globalThis.process.kill(pid, kind); } catch { /* Already closed. */ } } };
  signal(childPid, 'SIGTERM');
  process.kill('SIGTERM');
  const timer = setTimeout(() => { signal(childPid ? -childPid : undefined, 'SIGKILL'); signal(process.pid ? -process.pid : undefined, 'SIGKILL'); }, 3000);
  await new Promise<void>(resolve => process.once('close', () => resolve())); clearTimeout(timer);
}
