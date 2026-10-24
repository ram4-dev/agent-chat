import { spawn } from 'node:child_process';

/** POSIX kernel lock: a crash releases it even before metadata can be written. */
export async function acquireProcessLock(path: string, lost: () => void = () => {}): Promise<() => Promise<void>> {
  const script = `import fcntl,sys
with open(sys.argv[1], 'a') as lock:
 try:
  fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
 except BlockingIOError:
  sys.exit(23)
 print('locked', flush=True)
 sys.stdin.buffer.read()
`;
  const child = spawn('python3', ['-c', script, path], { stdio: ['pipe', 'pipe', 'ignore'] });
  let released = false; let acquired = false;
  const closed = new Promise<void>((resolve) => child.once('close', () => { if (acquired && !released) lost(); resolve(); }));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Lock helper timed out')); }, 5000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Python 3 is required for the process lock')); });
    child.once('close', () => { clearTimeout(timer); if (!acquired) reject(new Error('Receiver already running or lock unavailable')); });
    child.stdout.once('data', (chunk: Buffer) => {
      clearTimeout(timer);
      if (chunk.toString().trim() !== 'locked') { child.kill('SIGKILL'); reject(new Error('Invalid lock helper')); return; }
      acquired = true; resolve();
    });
  });
  return async () => { released = true; child.stdin.end(); await closed; };
}
