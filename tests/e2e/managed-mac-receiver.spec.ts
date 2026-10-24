import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ManagedAuth } from '../../apps/bridge/src/managed/auth';
import { runManagedReceiver } from '../../apps/bridge/src/managed/runtime';
import { CodexWorker } from '../../apps/bridge/src/codex/worker';
import { payload } from './helpers/agent';
import { signUp, createGroup, addAgent, send } from './helpers/ui';

for (const real of [false, true]) {
  test(`${real ? 'real Codex' : 'protocol worker'}: Mac receiver authorizes, replies and recovers pending work after restart`, async ({ page, baseURL }) => {
    test.skip(real && process.env['AGENT_CHAT_REAL_MANAGED_RECEIVER'] !== '1', 'Explicit opt-in requires a logged-in Codex model account');
    if (real) test.setTimeout(180_000);
    const directory = await mkdtemp(join(tmpdir(), 'mac-receiver-e2e-'));
    const consentAbort = new AbortController();
    let controller = new AbortController();
    let runtime: Promise<void> | undefined;
    let runtimeError: unknown;
    let monitor: Client | undefined;
    try {
      await page.goto('/');
      await signUp(page, `mac-receiver-${randomUUID()}@example.com`, 'Mac receiver owner');
      const provider = new ManagedAuth(baseURL!, directory); await provider.load();
      let opened: (url: URL) => void = () => {};
      const authorization = new Promise<URL>((resolve) => { opened = resolve; });
      const login = provider.login((url) => { opened(url); }, consentAbort.signal);
      void login.catch(() => {});
      const url = await authorization;
      expect((await page.request.get(`${provider.redirectUrl}?state=wrong&code=wrong`)).status()).toBe(400);
      await page.goto(url.href);
      await page.getByLabel('Nombre del agente', { exact: true }).fill('Scout');
      await page.getByRole('button', { name: 'Autorizar conexión', exact: true }).click();
      await login;
      expect((await stat(join(directory, 'oauth.json'))).mode & 0o777).toBe(0o600);
      await page.goto('/');
      await createGroup(page, 'Mac receiver'); await addAgent(page, 'Scout');
      let generations = 0;
      const previousThreads: Array<string | undefined> = [];
      const model = new CodexWorker(directory);
      const worker = {
        prepare: async () => { if (real) await model.prepare(); },
        run: async (prompt: string, threadId?: string) => {
          generations++; previousThreads.push(threadId);
          return real ? model.run(prompt, threadId, controller.signal)
            : { decision: 'reply' as const, text: `Respuesta de la Mac ${generations}`, threadId: 'protocol-thread-one' };
        },
      };
      const start = async () => {
        runtimeError = undefined;
        runtime = runManagedReceiver(provider, controller.signal, worker).catch((error: unknown) => { runtimeError = error; });
        await expect(page.getByRole('list', { name: 'Agentes del grupo' })).toContainText('Receptor activo', { timeout: real ? 60_000 : 10_000 });
        expect(runtimeError).toBeUndefined();
      };
      await start();
      monitor = new Client({ name: 'mac-receiver-monitor', version: '1.0.0' });
      await monitor.connect(new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), { authProvider: provider }));
      await send(page, 'Respondé exactamente: Respuesta de la Mac 1');
      await expect(page.getByText('Respuesta de la Mac 1', { exact: true })).toBeVisible({ timeout: real ? 60_000 : 10_000 });
      await expect.poll(async () => payload<{ events: unknown[] }>(await monitor!.callTool({ name: 'get_inbox', arguments: {} })).events.length).toBe(0);
      expect(generations).toBe(1);
      controller.abort(); await runtime;
      await expect(page.getByRole('list', { name: 'Agentes del grupo' })).toContainText('Sin receptor activo');
      await send(page, 'Respondé exactamente: Respuesta de la Mac 2');
      controller = new AbortController();
      await provider.load();
      await start();
      await expect(page.getByText('Respuesta de la Mac 2', { exact: true })).toBeVisible({ timeout: real ? 60_000 : 10_000 });
      await expect.poll(async () => payload<{ events: unknown[] }>(await monitor!.callTool({ name: 'get_inbox', arguments: {} })).events.length).toBe(0);
      expect(generations).toBe(2);
      expect(previousThreads[0]).toBeUndefined();
      expect(previousThreads[1]).toEqual(expect.any(String));
      expect(runtimeError).toBeUndefined();
    } finally {
      consentAbort.abort(); controller.abort(); await runtime;
      await monitor?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
