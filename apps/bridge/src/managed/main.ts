import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, chmod } from 'node:fs/promises';
import { ManagedAuth } from './auth.js';
import { runManagedReceiver } from './runtime.js';
import { acquireProcessLock } from '../process-lock.js';
import { CodexWorker } from '../codex/worker.js';
import { ReceiverJournal } from './journal.js';

const values = process.argv.slice(2);
const argument = (key: string) => { const index = values.indexOf(key); return index < 0 ? undefined : values[index + 1]; };
const directory = resolve(argument('--state') ?? join(homedir(), 'Library/Application Support/Agent Chat/managed-receiver'));
const origin = argument('--origin') ?? 'https://agent-chat-preview-kappa.vercel.app';
const abort = new AbortController();
process.once('SIGTERM', () => abort.abort()); process.once('SIGINT', () => abort.abort());
try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  if (values.includes('--status')) {
    console.log(JSON.stringify({ pending: ReceiverJournal.status(directory) }));
    process.exit(0);
  }
  const release = await acquireProcessLock(join(directory, 'receiver.flock'), () => abort.abort());
  try {
    const eventId = argument('--resolve-event');
    if (eventId) {
      const journal = new ReceiverJournal(directory);
      try { journal.resolve(eventId, argument('--text') ?? ''); console.log('receiver.resolution_saved'); }
      finally { journal.close(); }
    } else {
      const provider = new ManagedAuth(origin, directory); await provider.load();
      if (values.includes('--login')) await provider.login(undefined, abort.signal);
      else {
      const worker = new CodexWorker(directory);
      await runManagedReceiver(provider, abort.signal, {
        prepare: () => worker.prepare(), run: (prompt, threadId) => worker.run(prompt, threadId, abort.signal),
      });
      }
    }
  } finally { await release(); }
} catch {
  // OAuth responses and subprocess errors can contain credentials. Keep logs opaque.
  console.error('receiver.unavailable — check authorization, network, Codex login and private state; uncertain turns remain pending');
  process.exitCode = 1;
}
