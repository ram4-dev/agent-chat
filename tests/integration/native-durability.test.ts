import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from '../../apps/server/src/persistence/client';
import { createServices } from '../../apps/server/src/services';
let root: string;
let extension: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'native-durability-'));
  extension = join(root, process.platform === 'darwin' ? 'syncimage.dylib' : 'syncimage.so');
  const require = createRequire(resolve('apps/server/package.json'));
  const headers = join(dirname(require.resolve('better-sqlite3/package.json')), 'deps/sqlite3');
  await promisify(execFile)('cc', [...(process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC']), '-Wall', '-Wextra', '-Werror', `-I${headers}`, resolve('tests/fixtures/native-durability/sync-image.c'), '-o', extension], { timeout: 10000, maxBuffer: 32 * 1024 });
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });
interface Ack { type: 'begin-acknowledged'; connectionId: string; eventId: string; startKey: string; syncLevel: number; syncCalls: number }
async function acknowledgedThenLoseVolatileWrites(path: string, scenario: string): Promise<Ack> {
  const child = spawn(process.execPath, [resolve('tests/fixtures/native-durability/writer.mjs'), path, extension, scenario], { env: { PATH: process.env['PATH'] }, stdio: ['ignore','ignore','pipe','ipc'] });
  let diagnostics = ''; child.stderr!.on('data', (chunk: Buffer) => { diagnostics += chunk.toString(); });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  try {
    const ack = await new Promise<Ack>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Durability writer timed out')); }, 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Durability writer exited before ACK: ${diagnostics}`)); });
      child.once('message', value => { clearTimeout(timer); resolve(value as Ack); });
    });
    expect(ack.type).toBe('begin-acknowledged');
    expect(readFileSync(join(path, 'dispatched'), 'utf8')).toBe(ack.startKey);
    child.kill('SIGKILL'); await closed;
    return ack;
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; }
}
for (const scenario of ['normal-all', 'normal-begin', 'full']) {
  it(`recovers a synced disk image after acknowledged begin (${scenario})`, async () => {
    const path = join(root, scenario); mkdirSync(path);
    const ack = await acknowledgedThenLoseVolatileWrites(path, scenario);
    expect(ack.syncLevel).toBe(scenario.startsWith('full') ? 2 : 1);
    if (scenario !== 'normal-all') expect(ack.syncCalls).toBeGreaterThan(0);
    const recoveredPath = join(path, 'recovered.db');
    copyFileSync(join(path, 'durable.db'), recoveredPath);
    if (existsSync(join(path, 'durable.wal'))) copyFileSync(join(path, 'durable.wal'), `${recoveredPath}-wal`);
    // Unflushed writer.db bytes and its SHM are deliberately NOT used for recovery.
    const localB = join(path, 'controller-b-empty'); mkdirSync(localB); expect(readdirSync(localB)).toEqual([]);
    const database = createDatabase({ path: recoveredPath, busyTimeoutMs: 1000 });
    try {
      expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(database.sqlite.pragma('synchronous', { simple: true })).toBe(2);
      const runtime = createServices(database).nativeDelivery;
      const controllerId = randomUUID(); const { epoch } = runtime.open(ack.connectionId, controllerId);
      const recovered = runtime.next(ack.connectionId, controllerId, epoch).delivery!;
      expect(recovered.ticket.eventId).toBe(ack.eventId);
      if (scenario.startsWith('full')) {
        expect(recovered.started).toBe(true);
        expect(recovered.startKey).toBe(ack.startKey);
        expect(() => runtime.begin(ack.connectionId, recovered.ticket)).toThrow();
      } else {
        // The negative controls must reproduce the bug: a second start is authorized.
        expect(recovered.started).toBe(false);
        expect(recovered.startKey === ack.startKey).toBe(scenario === 'normal-begin');
        expect(() => runtime.begin(ack.connectionId, recovered.ticket)).not.toThrow();
      }
    } finally { database.close(); }
  });
}
