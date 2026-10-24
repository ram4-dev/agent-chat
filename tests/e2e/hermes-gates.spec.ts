import { hermesRunFingerprint } from '../../apps/bridge/src/adapters/hermes-runs';
import { expect, test } from '@playwright/test';
import { nativeHermes } from '../helpers/native-hermes';

test('Hermes native approval blocks its tool until an exact human decision and exposes the persisted session', async () => {
  const source = process.env['AGENT_CHAT_HERMES_SOURCE'];
  test.skip(!source, 'Requires the installed Hermes source and fake provider fixture');
  test.setTimeout(180000);
  const fixture = await nativeHermes(source!, undefined, { mode: 'approval', persona: 'APPROVAL_PROFILE_ALPHA', profileName: 'alpha', plugin: true });
  try {
    const probe = await fixture.start();
    expect(await fixture.evidence()).toMatchObject({ handlers: 1 });
    const capabilities = await probe.capabilities();
    expect(capabilities.platform).toBe('hermes-agent');
    expect(await probe.recoveryCapabilities()).toMatchObject({ profileRef: 'alpha', durable: true, readOnlyKeyLookup: true, normalCompletionQuiescent: true, cancelQuiescence: false });
    const runId = await probe.start('binding-group-approval', 'APPROVAL_NATIVE', 'approval-event');
    await expect.poll(async () => (await probe.status(runId)).status, { timeout: 30000 }).toBe('waiting_for_approval');
    const waiting = await probe.status(runId);
    expect(waiting.completed).toBe(false);
    expect(waiting.approval?.requestId).toBeTruthy();
    expect((await fixture.evidence()).approvalTargetExists).toBe(true);
    await expect(probe.approve(runId, 'wrong-request-id', 'once')).rejects.toThrow();
    expect((await probe.status(runId)).status).toBe('waiting_for_approval');
    await probe.approve(runId, waiting.approval!.requestId, 'once');
    await expect.poll(async () => (await probe.status(runId)).status, { timeout: 30000 }).toBe('completed');
    expect((await probe.status(runId)).output).toBe('Native approval completed');
    expect((await fixture.evidence()).workerCount).toBe(0);
    expect((await fixture.evidence()).approvalTargetExists).toBe(false);
    const observations = await fixture.observations();
    expect(JSON.stringify(observations)).toContain('APPROVAL_PROFILE_ALPHA');
    expect(observations.requests.some(r => r.tools?.some(t => t.function?.name === 'terminal'))).toBe(true);
    expect(JSON.stringify(await probe.history('binding-group-approval'))).toContain('APPROVAL_NATIVE');
    await fixture.stop();
    const restarted = await fixture.start();
    expect((await restarted.status(runId)).output).toBe('Native approval completed');
    expect((await fixture.observations()).requests).toHaveLength(0);
  } finally { await fixture.close(); }
});

test('Hermes handler cancellation can report terminal while a native executor is still active', async () => {
  const source = process.env['AGENT_CHAT_HERMES_SOURCE'];
  test.skip(!source, 'Requires the installed Hermes source and fake provider fixture');
  test.setTimeout(180000);
  const fixture = await nativeHermes(source!, undefined, { mode: 'approval', plugin: true });
  try {
    const probe = await fixture.start();
    const runId = await probe.start('binding-group-blocked', 'BLOCK_NATIVE', 'blocked-event');
    await expect.poll(async () => (await fixture.evidence()).workerCount, { timeout: 30000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await fixture.observations()).requests.some(r => r.fixture_kind === 'streamed_turn')).toBe(true);
    await fixture.cancelHandler(runId);
    await expect.poll(async () => (await probe.status(runId)).status).toBe('cancelled');
    expect((await fixture.evidence()).workerCount).toBeGreaterThan(0);
    expect(await probe.lookup('blocked-event', hermesRunFingerprint('binding-group-blocked', 'BLOCK_NATIVE'))).toMatchObject({ state: 'unknown', runRef: runId });
    await fixture.release();
    await expect.poll(async () => (await fixture.evidence()).workerCount, { timeout: 30000 }).toBe(0);
  } finally { await fixture.close(); }
});

test('two named Hermes profiles keep their native persona and session histories separate', async () => {
  const source = process.env['AGENT_CHAT_HERMES_SOURCE'];
  test.skip(!source, 'Requires Hermes source and isolated fake provider');
  test.setTimeout(180000);
  const alpha = await nativeHermes(source!, undefined, { profileName: 'alpha', persona: 'PROFILE_ALPHA_ONLY', plugin: true });
  const beta = await nativeHermes(source!, undefined, { profileName: 'beta', persona: 'PROFILE_BETA_ONLY', plugin: true });
  try {
    const a = await alpha.start(); const b = await beta.start();
    expect(await a.recoveryCapabilities()).toMatchObject({ profileRef: 'alpha' });
    expect(await b.recoveryCapabilities()).toMatchObject({ profileRef: 'beta' });
    const first = await a.start('same-logical-session', 'ALPHA_HISTORY_ONLY', 'alpha-key');
    const second = await b.start('same-logical-session', 'BETA_HISTORY_ONLY', 'beta-key');
    await expect.poll(async () => (await a.status(first)).status).toBe('completed');
    await expect.poll(async () => (await b.status(second)).status).toBe('completed');
    expect(JSON.stringify(await a.history('same-logical-session'))).not.toContain('BETA_HISTORY_ONLY');
    expect(JSON.stringify(await b.history('same-logical-session'))).not.toContain('ALPHA_HISTORY_ONLY');
    const aRequests = JSON.stringify(await alpha.observations()); const bRequests = JSON.stringify(await beta.observations());
    expect(aRequests).toContain('PROFILE_ALPHA_ONLY'); expect(aRequests).not.toContain('PROFILE_BETA_ONLY');
    expect(bRequests).toContain('PROFILE_BETA_ONLY'); expect(bRequests).not.toContain('PROFILE_ALPHA_ONLY');
  } finally { await beta.close(); await alpha.close(); }
});
