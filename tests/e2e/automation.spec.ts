import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authorizeAgent, mcpClient, payload } from './helpers/agent';
import { signUp, createGroup, addAgent, send, agents, selectGroup } from './helpers/ui';
import { processNext, type CallPort } from '../../apps/bridge/src/receiver';


test('automatic receiver wakes from browser messages, publishes once and supports pause', async ({ page, baseURL }) => {
  await page.goto('/'); await signUp(page, `automatic-${randomUUID()}@example.com`, 'Ada');
  const identity = await authorizeAgent(page, baseURL!);
  await page.goto('/'); const groupId = await createGroup(page, 'Automático'); await addAgent(page, 'Scout');
  const client = await mcpClient(baseURL!, identity.token);
  const control: CallPort = { async call<T>(tool: string, args: object) { return payload<T>(await client.callTool({ name: tool, arguments: args as Record<string, unknown> })); } };
  const instance = randomUUID(); const directory = await mkdtemp(join(tmpdir(), 'automatic-e2e-'));
  let turns = 0;
  const worker = { run: async () => { turns++; return { decision: 'reply' as const, text: 'Recibido automáticamente', threadId: 'test-thread' }; } };
  try {
    await control.call('configure_runtime', { group_id: groupId, enabled: true, model: 'gpt-6.1-sol' });
    const waiting = processNext(control, worker, instance, [groupId], directory);
    await send(page, 'Hola Scout'); await waiting;
    await expect(page.getByText('Recibido automáticamente', { exact: true })).toBeVisible();
    expect(turns).toBe(1);
    expect(payload<{ events: unknown[] }>(await client.callTool({ name: 'get_inbox', arguments: {} })).events).toHaveLength(0);
    await agents(page);
    const panel = page.getByRole('region', { name: 'Respuestas automáticas de Scout' });
    await panel.getByRole('button', { name: 'Pausar respuestas automáticas' }).click();
    await expect(panel.getByRole('status')).toHaveText('Respuestas automáticas pausadas');
    await panel.getByText('Ver actividad de Codex').click();
    await expect(panel.getByText('Respuesta publicada', { exact: true })).toBeVisible();
    await page.screenshot({ path: '.local-state/automation-paused.png', fullPage: true });
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test('real Codex model answers from the browser and resumes its dedicated group thread', async ({ page, baseURL }) => {
  test.skip(process.env['AGENT_CHAT_REAL_CODEX'] !== '1', 'Requires explicit opt-in to a real model run');
  test.setTimeout(180_000);
  await page.goto('/'); await signUp(page, `real-codex-${randomUUID()}@example.com`, 'Ramiro E2E');
  const identity = await authorizeAgent(page, baseURL!);
  await page.goto('/'); const groupId = await createGroup(page, 'Codex real'); await addAgent(page, 'Scout');
  const otherGroupId = await createGroup(page, 'Codex separado'); await addAgent(page, 'Scout');
  await selectGroup(page, 'Codex real');
  const client = await mcpClient(baseURL!, identity.token);
   const directory = await mkdtemp(join(tmpdir(), 'real-codex-e2e-'));
  const receiver = spawn(process.execPath, ['apps/bridge/dist/supervisor.js', '--group', randomUUID(), '--group', groupId, '--group', otherGroupId, '--state', directory], {
    env: { ...process.env, AGENT_CHAT_MCP_URL: baseURL!, AGENT_CHAT_MCP_TOKEN: identity.token, AGENT_CHAT_MCP_SERVER: 'agent-chat-e2e' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  receiver.stderr.resume();
  const ready: { pid: number; controlPid: number }[] = [];
  const lines = createInterface({ input: receiver.stdout });
  lines.on('line', (line) => { try { const event = JSON.parse(line) as { type: string; pid: number; controlPid: number }; if (event.type === 'receiver.ready') ready.push(event); } catch { /* No raw diagnostics or credentials are printed. */ } });
  try {
    await expect.poll(() => ready.length, { timeout: 60_000 }).toBe(1);
    await page.screenshot({ path: '.local-state/real-codex-01-group.png', fullPage: true });
    await send(page, 'La clave de este grupo es AZUL-427. Respondé exactamente: Recibido por Codex, AZUL-427.');
    await page.screenshot({ path: '.local-state/real-codex-02-incoming.png', fullPage: true });
    await expect(page.getByText('Recibido por Codex, AZUL-427.', { exact: true })).toBeVisible({ timeout: 60_000 });
    const state1 = await page.request.get(`/api/agents/${identity.agentId}/automation/${groupId}`);
    const thread1 = ((await state1.json()) as { binding: { threadId: string } }).binding.threadId;
    await page.screenshot({ path: '.local-state/real-codex-03-answer.png', fullPage: true });
    // Crash only the idle control-plane; the actual supervisor must restart it.
    process.kill(ready[0]!.controlPid, 'SIGKILL');
    // Publish during the reconnect window, before a new controller is ready.
    await send(page, 'Recordá la clave que te dije. Respondé exactamente: Recuerdo AZUL-427.');
    await expect.poll(() => ready.length, { timeout: 60_000 }).toBe(2);
    expect(ready[1]!.pid).not.toBe(ready[0]!.pid);
    await expect(page.getByText('Recuerdo AZUL-427.', { exact: true })).toBeVisible({ timeout: 60_000 });
    const state2 = await page.request.get(`/api/agents/${identity.agentId}/automation/${groupId}`);
    expect(((await state2.json()) as { binding: { threadId: string } }).binding.threadId).toBe(thread1);
    expect(payload<{ events: unknown[] }>(await client.callTool({ name: 'get_inbox', arguments: {} })).events).toHaveLength(0);
    await page.screenshot({ path: '.local-state/real-codex-04-context.png', fullPage: true });
    await selectGroup(page, 'Codex separado');
    await send(page, 'Respondé exactamente: Este es otro grupo.');
    await expect(page.getByText('Este es otro grupo.', { exact: true })).toBeVisible({ timeout: 60_000 });
    const otherState = await page.request.get(`/api/agents/${identity.agentId}/automation/${otherGroupId}`);
    expect(((await otherState.json()) as { binding: { threadId: string } }).binding.threadId).not.toBe(thread1);
    await page.screenshot({ path: '.local-state/real-codex-06-separated-group.png', fullPage: true });
    await selectGroup(page, 'Codex real');
    await agents(page); const panel = page.getByRole('region', { name: 'Respuestas automáticas de Scout' });
    await panel.getByText('Ver actividad de Codex').click();
    await expect(panel.getByRole('list', { name: 'Actividad automática de Scout' })).toContainText('Recuerdo AZUL-427.');
    await page.screenshot({ path: '.local-state/real-codex-05-activity.png', fullPage: true });
  } finally {
    receiver.kill('SIGTERM');
    await new Promise<void>((resolve) => { if (receiver.exitCode !== null || receiver.signalCode !== null) resolve(); else receiver.once('close', () => resolve()); });
    await client.close(); await rm(directory, { recursive: true, force: true });
  }
});
