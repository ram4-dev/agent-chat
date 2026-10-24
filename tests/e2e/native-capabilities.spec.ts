import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeHermes } from '../helpers/native-hermes';

test('native Codex profile entrypoint preserves persona, rules, tools and conversation without inference', async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto('/');
  // The existing UI remains available while the new capability probe is isolated.
  await expect(page.getByRole('tab', { name: 'Ingresar', exact: true })).toBeVisible();
  const { stdout } = await promisify(execFile)(process.execPath, ['apps/bridge/dist/native-capabilities.js'], {
    timeout: 65_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
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
    const first = await probe.start('binding-one-group-a', 'Actor A: KEY-427', 'event-one');
    expect((await completed(first)).output).toBe('native fixture reply');
    expect(await probe.start('binding-one-group-a', 'Actor A: KEY-427', 'event-one')).toBe(first);
    await expect(probe.start('binding-one-group-a', 'Different content', 'event-one')).rejects.toThrow('(409)');
    await completed(await probe.start('binding-one-group-a', 'Actor B: followup', 'event-two'));
    await completed(await probe.start('binding-one-group-b', 'OTHER-GROUP', 'event-three'));
    const silent = await completed(await probe.start('binding-one-group-a', 'SILENT', 'event-four'));
    expect(JSON.parse(silent.output!)).toEqual({ decision: 'no_reply', text: '' });
    const observations = (await fixture.observations()).filter(r => r.tools?.length);
    expect(observations.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(observations[0])).toContain('NATIVE_PROFILE_SENTINEL');
    expect(JSON.stringify(observations[1])).toContain('KEY-427');
    const other = observations.find(r => JSON.stringify(r).includes('OTHER-GROUP'))!;
    expect(JSON.stringify(other)).not.toContain('KEY-427');
    await fixture.stop();
    probe = await fixture.start();
    expect((await probe.status(first)).output).toBe('native fixture reply');
    expect(await probe.start('binding-one-group-a', 'Actor A: KEY-427', 'event-one')).toBe(first);
    await completed(await probe.start('binding-one-group-a', 'Actor B: after restart', 'event-five'));
    const last = (await fixture.observations()).filter(r => r.tools?.length).at(-1)!;
    expect(JSON.stringify(last)).toContain('KEY-427');
    expect(JSON.stringify(last)).not.toContain('OTHER-GROUP');
  } finally { await fixture.close(); }
});
