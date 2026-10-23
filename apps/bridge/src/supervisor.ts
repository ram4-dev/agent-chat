import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
let stopping = false;
let active: ChildProcess | undefined;
let wake: NodeJS.Timeout | undefined;
let failures = 0;
function launch(): void {
  if (stopping) return;
  const started = Date.now();
  active = spawn(process.execPath, [fileURLToPath(new URL('./main.js', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
  console.log(JSON.stringify({ type: 'supervisor.started', pid: active.pid }));
  active.once('error', () => {});
  active.once('close', () => {
    active = undefined;
    if (stopping) return;
    failures = Date.now() - started > 60_000 ? 0 : failures + 1;
    const backoff = Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5));
    wake = setTimeout(launch, Math.max(1000, backoff));
  });
}
function stop(): void {
  stopping = true; if (wake !== undefined) clearTimeout(wake);
  active?.kill('SIGTERM');
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
launch();
