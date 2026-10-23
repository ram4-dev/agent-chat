import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { acquireProcessLock } from '../../apps/bridge/src/process-lock';
it('kernel lock excludes concurrent receivers and accepts an empty file left by a crash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'receiver-lock-'));
  try {
    const path = join(directory, 'receiver.flock');
    await writeFile(path, '');
    const release = await acquireProcessLock(path);
    try { await expect(acquireProcessLock(path)).rejects.toThrow('already running'); }
    finally { await release(); }
    const resumed = await acquireProcessLock(path); await resumed();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
