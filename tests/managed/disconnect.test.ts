import { fork, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ManagedDatabase } from '../../apps/server/src/managed/database';

const url = process.env['DATABASE_URL'];
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('Disconnect tests require the disposable local Supabase database.');
}

interface Outcome {
  type: string;
  pid?: number;
  failed?: boolean;
  originalPreserved?: boolean;
  errorCode?: string;
  attempts?: number;
  recovered?: { pid: number; value: number };
}

function nextOutcome(child: ChildProcess): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const message = (value: Outcome) => { cleanup(); resolve(value); };
    const exit = () => { cleanup(); resolve({ type: 'unexpected-exit' }); };
    const error = () => { cleanup(); reject(new Error('Disconnect worker failed to start')); };
    function cleanup() { child.off('message', message); child.off('exit', exit); child.off('error', error); }
    child.once('message', message); child.once('exit', exit); child.once('error', error);
  });
}

for (const mode of ['before-commit', 'operation-error', 'query']) {
  it(`survives a real PostgreSQL disconnect during ${mode}, preserves failure and recovers without retries`, async () => {
    const admin = new ManagedDatabase(url);
    const child = fork(fileURLToPath(new URL('../fixtures/managed-disconnect-worker.mjs', import.meta.url)), [mode], {
      execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    try {
      const ready = await nextOutcome(child);
      expect(ready.type).toBe('ready');
      expect(ready.pid).toEqual(expect.any(Number));
      const result = nextOutcome(child);
      const terminated = await admin.one<{ terminated: boolean }>('SELECT pg_terminate_backend($1) AS terminated', [ready.pid]);
      expect(terminated?.terminated).toBe(true);
      // Keep the client checked out with no pending SQL, so the asynchronous
      // socket error arrives before the application resumes its transaction.
      if (mode !== 'query') await delay(200);
      if (child.connected) child.send('continue', () => {});
      const outcome = await result;
      expect(outcome.type).toBe('result');
      expect(outcome.failed).toBe(true);
      expect(outcome.attempts).toBe(1);
      expect(outcome.recovered?.value).toBe(42);
      expect(outcome.recovered?.pid).not.toBe(ready.pid);
      if (mode === 'operation-error') expect(outcome.originalPreserved).toBe(true);
      else expect(outcome.errorCode).toBe('57P01');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await admin.close();
    }
  });
}
