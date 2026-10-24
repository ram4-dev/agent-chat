import { spawn } from 'node:child_process';

/** Own the entire POSIX process group, including background plugin setup. */
export async function isolatedCommand(program: string, args: string[], options: {
  env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number; maxBytes: number;
}): Promise<string> {
  return await new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(program, args, { env: options.env, cwd: options.cwd,
      detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = []; let bytes = 0; let failure: string | undefined;
    let closed = false; let drained = false; let draining = false; let exitCode: number | null = null;
    const kill = (signal: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch { /* The owned group already exited. */ }
    };
    const timer = setTimeout(() => { failure = 'timeout'; kill('SIGKILL'); }, options.timeoutMs);
    const finish = () => {
      if (!closed || !drained) return;
      clearTimeout(timer);
      if (failure || exitCode !== 0) reject(new Error(`Isolated command failed (${failure ?? 'exit'})`));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    };
    const drain = () => {
      if (draining) return;
      draining = true;
      kill('SIGTERM');
      // Start at leader exit, not pipe close: descendants can keep inherited
      // pipes open after the leader exits (e.g. background plugin git clones).
      setTimeout(() => { kill('SIGKILL'); drained = true; finish(); }, 100);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.maxBytes) { failure = 'output limit'; kill('SIGKILL'); }
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.maxBytes) { failure = 'output limit'; kill('SIGKILL'); }
    });
    child.once('error', () => { failure = 'startup'; kill('SIGKILL'); drain(); });
    child.once('exit', (code) => { exitCode = code; drain(); });
    child.once('close', (code) => {
      closed = true; exitCode = code; drain(); finish();
    });
  });
}
