import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeHermes } from '../helpers/native-hermes';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('native Codex profile entrypoint preserves persona, rules, tools and conversation without inference', async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto('/');
  // The existing UI remains available while the new capability probe is isolated.
  await expect(page.getByRole('tab', { name: 'Ingresar', exact: true })).toBeVisible();
  const parentHome = await mkdtemp(join(tmpdir(), 'native-parent-config-canary-'));
  let stdout: string;
  try {
    // Loading the caller's config would fail before catalog discovery succeeds.
    await writeFile(join(parentHome, 'config.toml'), 'invalid private fixture config = [');
    ({ stdout } = await promisify(execFile)(process.execPath, [resolve('apps/bridge/dist/native-capabilities.js')], {
      cwd: parentHome, env: { PATH: process.env['PATH'], HOME: parentHome, CODEX_HOME: parentHome },
      timeout: 65_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    }));
  } finally { await rm(parentHome, { recursive: true, force: true }); }
  expect(JSON.parse(stdout)).toEqual({
    codex: { profileSelected: true, instructionsPreserved: true, workspaceRulesPreserved: true, toolsPreserved: true, conversationResumed: true, requests: 2 },
    hermes: { verified: false }, grokBot: { verified: false }, automaticActivationAllowed: false,
  });
});

test('installed Hermes returns durable terminal results with profile tools and group sessions', async () => {
  const source = process.env['AGENT_CHAT_HERMES_SOURCE'];
  test.skip(!source, 'Requires AGENT_CHAT_HERMES_SOURCE: installed runtime, fake provider, isolated profile');
  test.setTimeout(180_000);
  const fixture = await nativeHermes(source!);
  try {
    let probe = await fixture.start();
    async function completed(id: string) {
      await expect.poll(async () => (await probe.status(id)).status, { timeout: 30_000 }).toBe('completed');
      return await probe.status(id);
    }
    const expectedTools = ['patch', 'read_file', 'search_files', 'write_file'];
    async function observed(input: string) {
      await expect.poll(async () => (await fixture.observations()).requests
        .some(r => r.fixture_kind === 'streamed_turn' && [...r.messages].reverse().find(m => m.role === 'user')?.content === input), { timeout: 5000 }).toBe(true);
      const snapshot = await fixture.observations();
      const request = snapshot.requests.findLast(r => r.fixture_kind === 'streamed_turn' && [...r.messages].reverse().find(m => m.role === 'user')?.content === input)!;
      expect(request.fixture_generation).toBe(snapshot.generation);
      expect(request.fixture_sequence).toBeGreaterThan(0);
      expect(request.tools?.map(t => t.function?.name).sort()).toEqual(expectedTools);
      return { snapshot, request };
    }
    const first = await probe.start('binding-one-group-a', 'Actor A: KEY-427', 'event-one');
    const firstResult = (await completed(first)).output;
    expect(firstResult).toMatch(/^native fixture reply /);
    const initial = await observed('Actor A: KEY-427');
    expect(JSON.stringify(initial.request)).toContain('NATIVE_PROFILE_SENTINEL');
    // Hermes also titles a new session. Wait for that separately observed request
    // before the replay baseline, so a late title cannot hide or mimic regeneration.
    await expect.poll(async () => (await fixture.observations()).requests.some(r =>
      r.fixture_kind === 'auxiliary' && [...r.messages].reverse().find(m => m.role === 'user')?.content === 'Actor A: KEY-427'),
    { timeout: 5000 }).toBe(true);
    const initialCount = (await fixture.observations()).requests.length;
    expect(await probe.start('binding-one-group-a', 'Actor A: KEY-427', 'event-one')).toBe(first);
    expect((await completed(first)).output).toBe(firstResult);
    await expect(probe.start('binding-one-group-a', 'Different content', 'event-one')).rejects.toThrow('(409)');
    expect((await fixture.observations()).requests).toHaveLength(initialCount);
    await completed(await probe.start('binding-one-group-a', 'Actor B: followup', 'event-two'));
    const followup = await observed('Actor B: followup');
    expect(JSON.stringify(followup.request)).toContain('KEY-427');
    await completed(await probe.start('binding-one-group-b', 'OTHER-GROUP', 'event-three'));
    const other = await observed('OTHER-GROUP');
    expect(JSON.stringify(other.request)).not.toContain('KEY-427');
    const silent = await completed(await probe.start('binding-one-group-a', 'SILENT', 'event-four'));
    expect(JSON.parse(silent.output!)).toEqual({ decision: 'no_reply', text: '' });
    const beforeRestart = await observed('SILENT');
    for (const input of ['Actor A: KEY-427', 'Actor B: followup', 'OTHER-GROUP', 'SILENT']) {
      expect(beforeRestart.snapshot.requests.filter(r => r.fixture_kind === 'streamed_turn' && [...r.messages].reverse().find(m => m.role === 'user')?.content === input)).toHaveLength(1);
    }
    await fixture.stop();
    probe = await fixture.start();
    const restarted = await fixture.observations();
    expect(restarted.generation).not.toBe(initial.snapshot.generation);
    expect(restarted.requests).toHaveLength(0);
    expect((await probe.status(first)).output).toBe(firstResult);
    expect(await probe.start('binding-one-group-a', 'Actor A: KEY-427', 'event-one')).toBe(first);
    expect((await completed(first)).output).toBe(firstResult);
    expect((await fixture.observations()).requests).toHaveLength(0);
    await completed(await probe.start('binding-one-group-a', 'Actor B: after restart', 'event-five'));
    const last = await observed('Actor B: after restart');
    expect(JSON.stringify(last.request)).toContain('KEY-427');
    expect(JSON.stringify(last.request)).not.toContain('OTHER-GROUP');
    // Provider sequence restarts with the process, while the original run stayed durable.
    expect(last.request.fixture_sequence).toBe(1);
    expect(last.snapshot.requests.filter(r => r.fixture_kind === 'streamed_turn' && [...r.messages].reverse().find(m => m.role === 'user')?.content === 'Actor A: KEY-427')).toHaveLength(0);
  } finally { await fixture.close(); }
});
