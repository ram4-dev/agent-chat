import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { NativeStatusView } from '@agent-chat/contracts';
import { signUp, createGroup, addAgent, agents, selectGroup } from './helpers/ui';
import { expectNamedControls, expectVisibleKeyboardFocus } from './helpers/accessibility';

test('owner sees native coverage, capabilities, empty activity and recoverable status errors', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/'); await signUp(page, `status-${randomUUID()}@example.com`, 'Estado');
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`${origin}${path}`, { headers: { origin }, data });
    expect(response.status()).toBe(201); return response.json();
  };
  const { agent } = await post('/api/agents', { name: 'Vista' });
  await page.reload(); const groupId = await createGroup(page, 'Estado nativo'); await addAgent(page, 'Vista');
  const { target } = await post('/api/native/targets', { provider: 'grok_bot', connectorId: 'Nube de prueba', nativeRef: 'bot-de-prueba', contextMode: 'shared_bot_context' });
  await post('/api/native/bindings', { agentId: agent.id, targetId: target.id, groupIds: [groupId] });
  const endpoint = `**/api/agents/${agent.id}/native-status/*`;
  let slowRequests = 0;
  await page.route(endpoint, async route => {
    slowRequests++;
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 4000));
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.reload(); await agents(page);
  const panel = page.getByRole('region', { name: 'Receptor nativo de Vista', exact: true });
  await expect(panel.getByRole('status')).toHaveText('Respuestas nativas pausadas', { timeout: 7000 });
  expect(slowRequests).toBe(1);
  await page.unroute(endpoint);
  await expect(panel.getByRole('heading')).toHaveText('Grok Bot en este grupo');
  await expect(panel.getByText('bot-de-prueba', { exact: true })).toBeVisible();
  await panel.getByText('Ver capacidades registradas', { exact: true }).click();
  await expect(panel.getByText('Sin verificar', { exact: true })).toHaveCount(5);
  await panel.getByText('Ver actividad nativa', { exact: true }).click();
  await expect(panel.getByText('Todavía no hay entregas nativas en este grupo.')).toBeVisible();
  await expectNamedControls(panel);
  await page.screenshot({ path: '.local-state/native-status-desktop.png', fullPage: true });
  await page.route(endpoint, route => route.fulfill({ status: 503, body: '{}' }));
  await expect(panel.getByRole('alert')).toHaveText('No pudimos consultar el estado nativo.', { timeout: 7000 });
  await expect(panel.getByText('bot-de-prueba', { exact: true })).toHaveCount(0);
  const retry = panel.getByRole('button', { name: 'Reintentar estado nativo' });
  await expectVisibleKeyboardFocus(page, retry);
  await page.unroute(endpoint); await retry.click();
  await expect(panel.getByRole('status')).toHaveText('Respuestas nativas pausadas');
  let held: import('@playwright/test').Route | undefined;
  await page.route(endpoint, route => { held = route; });
  await expect.poll(() => !!held).toBe(true);
  await expect(panel.getByRole('status')).toHaveText('Actualizando estado nativo…');
  await expect(panel.getByRole('alert')).toBeVisible({ timeout: 10000 });
  await expect(panel.getByText('bot-de-prueba', { exact: true })).toHaveCount(0);
  await held?.abort().catch(() => undefined); await page.unroute(endpoint);
  await panel.getByRole('button', { name: 'Reintentar estado nativo' }).click();
  await expect(panel.getByRole('status')).toHaveText('Respuestas nativas pausadas');
  const snapshot = (await (await page.request.get(`${origin}/api/agents/${agent.id}/native-status/${groupId}`)).json()).native as NativeStatusView;
  await panel.getByText('Ver actividad nativa', { exact: true }).click();
  for (const [pending, label] of [
    ['start_uncertain', 'Inicio pendiente de confirmar'],
    ['running', 'Procesamiento autorizado; resultado pendiente'],
    ['cancel_requested', 'Cancelación pendiente de verificar'],
  ] as const) {
    const native: NativeStatusView = { ...snapshot, jobs: [{ eventId: 'synthetic-pending', state: pending, started: true, providerStarted: true, input: null, output: null, decision: null, receipt: null, contentExpired: false, runRef: null, conversationRef: null, createdAt: Date.now(), completedAt: null }] };
    await page.route(endpoint, route => route.fulfill({ json: { native } }));
    await expect(panel.getByRole('status')).toHaveText(label);
    await expect(panel.getByText('Respuestas nativas pausadas. El turno pendiente conserva su estado hasta confirmar su finalización.')).toBeVisible();
    await expect(panel.getByRole('list').getByText(label, { exact: true })).toBeVisible();
    await page.unroute(endpoint);
  }
  await selectGroup(page, 'Estado nativo'); await createGroup(page, 'Otro grupo'); await addAgent(page, 'Vista');
  await agents(page);
  await expect(panel.getByRole('status')).toHaveText('Este grupo no está habilitado para este receptor');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local-state/native-status-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
