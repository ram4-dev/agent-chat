import { it, expect } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedCommand } from '../../apps/bridge/src/codex/isolated-command';

it.skipIf(process.platform === 'win32')('stops a background writer after its leader exits, before returning control to cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-process-group-'));
  const heartbeat = join(root, 'heartbeat');
  const writer = `setInterval(()=>require('node:fs').writeFileSync(${JSON.stringify(heartbeat)},'alive'),10)`;
  const leader = `
    const fs=require('node:fs');
    require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:['ignore','inherit','inherit']});
    const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(heartbeat)})){clearInterval(timer);console.log('ready');process.exit(0)}},10);
  `;
  try {
    expect(await isolatedCommand(process.execPath, ['-e', leader], {
      env: { PATH: process.env['PATH'], HOME: root }, cwd: root, timeoutMs: 3000, maxBytes: 1024,
    })).toBe('ready\n');
    await rm(heartbeat);
    await new Promise(resolve => setTimeout(resolve, 80));
    await expect(access(heartbeat)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
