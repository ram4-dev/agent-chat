import { it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeHermes } from '../helpers/native-hermes';

const execute = promisify(execFile);
it('archives committed source without private env, local modifications, untracked files or symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-source-isolation-'));
  try {
    const source = join(root, 'source'); await mkdir(source);
    await execute('git', ['init', source]);
    const git = (args: string[]) => execute('git', ['-C', source, ...args], {
      env: { PATH: process.env['PATH'], HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
    await writeFile(join(source, 'run_agent.py'), 'ORIGINAL_VERSIONED_SOURCE');
    await writeFile(join(source, '.env'), 'SYNTHETIC_PRIVATE_CANARY=not-a-real-secret');
    await writeFile(join(source, '.op.env'), 'SYNTHETIC_OP_CANARY=not-a-real-secret');
    await symlink(join(root, 'outside'), join(source, 'linked'));
    await git(['add', '.']);
    await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'fixture']);
    await writeFile(join(source, 'run_agent.py'), 'LOCAL_MODIFICATION');
    await writeFile(join(source, 'untracked.py'), 'NOT_VERSIONED');
    const destination = join(root, 'clean');
    await execute('python3', [resolve('tests/fixtures/native-runtimes/hermes-server.py'), '--copy-only', source, 'HEAD', destination, root], {
      env: { PATH: process.env['PATH'], HOME: root }, timeout: 15_000, killSignal: 'SIGKILL',
    });
    expect(await readdir(destination)).toEqual(['run_agent.py']);
    expect(await readFile(join(destination, 'run_agent.py'), 'utf8')).toBe('ORIGINAL_VERSIONED_SOURCE');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('cleans temporary Hermes discovery data when discovery rejects', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'native-discovery-cleanup-'));
  const bin = join(parent, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'hermes'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const homes = join(parent, 'homes'); await mkdir(homes);
  vi.stubEnv('PATH', `${bin}:${process.env['PATH'] ?? ''}`);
  try {
    await expect(nativeHermes('/nonexistent/native-hermes-source', homes)).rejects.toThrow('Isolated Hermes discovery failed');
    expect(await readdir(homes)).toEqual([]);
  } finally { vi.unstubAllEnvs(); await rm(parent, { recursive: true, force: true }); }
});
