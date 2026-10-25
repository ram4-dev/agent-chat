import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { agents, createGroup, signUp } from './helpers/ui';
import type { OwnedAgentsResponse } from '@agent-chat/contracts';

// Owner consent uses the real canonical OAuth origin. No managed database or cloud service.
async function authorizeNamedApp(page: Page, name: string, agentId: string) {
  const origin = new URL(page.url()).origin;
  const registration = await page.request.post('/reg', { data: { client_name: name, redirect_uris: [origin + '/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] } });
  expect(registration.status()).toBe(201);
  const client = await registration.json() as { client_id: string };
  const challenge = createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url');
  await page.goto('/auth?' + new URLSearchParams({ client_id: client.client_id, redirect_uri: origin + '/callback', response_type: 'code', scope: 'openid agent:read agent:send agent:inbox agent:receive', code_challenge: challenge, code_challenge_method: 'S256' }));
  await expect(page.getByText(name, { exact: false })).toBeVisible();
  await page.locator(`input[name="agentId"][value="${agentId}"]`).check();
  await page.getByRole('button', { name: 'Autorizar conexión', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/callback' && url.searchParams.has('code'));
  await page.goto('/');
}
async function owned(page: Page) {
  return (await (await page.request.get('/api/agents')).json() as OwnedAgentsResponse).agents;
}
async function identity(page: Page, name: string) {
  await agents(page);
  await page.getByRole('button', { name: 'Crear identidad', exact: true }).click();
  await page.getByLabel('Nombre del agente', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Crear agente', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return (await owned(page))[0]!;
}
for (const mobile of [false, true]) test(`guided first identity, OAuth, observed receipt state and group (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await signUp(page, `guide-${randomUUID()}@example.com`, 'Guía');
  await createGroup(page, 'Equipo de prueba');
  await agents(page);
  await page.locator('.agents-empty').getByRole('button', { name: 'Conectar un agente', exact: true }).click();
  let guide = page.getByRole('dialog', { name: 'Conectar un agente', exact: true });
  await expect(guide).toContainText('Grupo actual: Equipo de prueba.');
  await expect(guide.getByRole('list', { name: 'Progreso de conexión' }).getByRole('listitem')).toHaveCount(4);
  await expect(guide.getByLabel('Skill para configurar un agente', { exact: true })).toHaveValue(new URL(page.url()).origin + '/skills/agent-chat/SKILL.md');
  await guide.getByRole('button', { name: 'Crear identidad por adelantado', exact: true }).click();
  await page.getByLabel('Nombre del agente', { exact: true }).fill('Guía del equipo');
  await page.getByRole('button', { name: 'Crear agente', exact: true }).click();
  guide = page.getByRole('dialog', { name: 'Conectar un agente', exact: true });
  await expect(guide).toContainText('Guía del equipo: identidad habilitada.');
  await expect(guide).toContainText('Falta confirmar la recepción.');
  await guide.getByRole('button', { name: 'Cerrar guía', exact: true }).click();
  const agent = (await owned(page))[0]!;
  await authorizeNamedApp(page, 'Notebook de investigación', agent.id);
  await agents(page);
  await page.getByRole('button', { name: 'Continuar conexión', exact: true }).click();
  await expect(guide).toContainText('Hay una aplicación autorizada');
  await expect(guide).toContainText('Falta confirmar la recepción.');
  await guide.getByRole('button', { name: 'Agregar a Equipo de prueba', exact: true }).click();
  await expect(guide).toContainText('Guía del equipo ya pertenece a Equipo de prueba.');
  await expect(guide).not.toContainText('Listo para responder');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.local-state/verification/agent-guide-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
});

test('zero OAuth connections offers a working connect action and preserves notification deep links', async ({ page }) => {
  await page.goto('/'); await signUp(page, `no-client-${randomUUID()}@example.com`, 'Sin cliente');
  const agent = await identity(page, 'Pendiente');
  await page.goto(`/?notification_agent=${agent.id}&notification_platform=generic`);
  const notifications = page.getByRole('dialog', { name: 'Notificaciones de Pendiente' });
  await expect(notifications.getByRole('button', { name: 'Conectar mi agente', exact: true })).toBeVisible();
  await expect(notifications.getByLabel('Cliente MCP para notificaciones')).toHaveCount(0);
  await expect(notifications.getByRole('button', { name: 'Guardar y probar' })).toHaveCount(0);
  await notifications.getByRole('button', { name: 'Conectar mi agente', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Conectar un agente', exact: true });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Pendiente: identidad habilitada.');
});

test('generic host copy, private manual form, probe/receipt/pause and local error recovery', async ({ page }) => {
  await page.goto('/'); await signUp(page, `generic-${randomUUID()}@example.com`, 'Otro host');
  const agent = await identity(page, 'Rutina');
  await authorizeNamedApp(page, 'Host privado', agent.id);
  const connection = (await owned(page))[0]!.connections[0]!;
  let status = { available: true, active: false, configured: false, enabled: false, receipt_confirmed: false, reason: '', connections: [connection], latest_delivery: { status: '' } };
  let failSave = true;
  await page.route(`**/api/agents/${agent.id}/notifications**`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: status });
    if (route.request().url().endsWith('/pause')) { status = { ...status, active: false, enabled: false, receipt_confirmed: false, reason: 'paused' }; return route.fulfill({ json: status }); }
    if (failSave) return route.fulfill({ status: 400, json: { error: { code: 'invalid_input' } } });
    status = { ...status, configured: true, enabled: true, latest_delivery: { status: 'accepted' } };
    return route.fulfill({ json: status });
  });
  await page.goto(`/?notification_agent=${agent.id}&notification_connection=${connection.id}&notification_platform=generic`);
  const dialog = page.getByRole('dialog', { name: 'Notificaciones de Rutina' });
  await expect(dialog.getByText('Configurá una rutina en tu host', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Creá una rutina con disparador webhook en Grok Bot.', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('URL del webhook', { exact: true })).not.toBeVisible();
  await dialog.getByText('Configuración manual privada', { exact: true }).click();
  await expect(dialog.getByLabel('Cliente MCP para notificaciones')).toHaveValue(connection.id);
  for (const failed of [true, false]) {
    failSave = failed;
    await dialog.getByLabel('URL del webhook', { exact: true }).fill('https://notifications.example.com/routine');
    await dialog.getByLabel('Clave del webhook', { exact: true }).fill('fixture-private-key');
    await dialog.getByRole('button', { name: 'Guardar y probar', exact: true }).click();
    await expect(dialog.getByLabel('Clave del webhook', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('URL del webhook', { exact: true })).toHaveValue('');
    if (failed) await expect(dialog.getByRole('alert')).toContainText('No pudimos guardar.');
  }
  await expect(dialog).toContainText('Prueba enviada. Falta la confirmación del agente.');
  await expect(dialog).not.toContainText('Notificaciones activas:');
  status = { ...status, active: true, receipt_confirmed: true, latest_delivery: { status: 'confirmed' } };
  await expect(dialog).toContainText('Notificaciones activas: recepción confirmada por el agente.', { timeout: 6000 });
  await dialog.getByRole('button', { name: 'Pausar avisos', exact: true }).click();
  await expect(dialog).toContainText('Avisos pausados.');
});

test('named applications and disconnect confirmation identify exactly the connection being revoked', async ({ page }) => {
  await page.goto('/'); await signUp(page, `disconnect-${randomUUID()}@example.com`, 'Dueño');
  const agent = await identity(page, 'Scout');
  await authorizeNamedApp(page, 'Notebook de investigación', agent.id);
  await authorizeNamedApp(page, 'Asistente de escritorio', agent.id);
  await agents(page);
  await page.getByText('Conexiones de Scout', { exact: true }).click();
  const list = page.getByRole('list', { name: 'Conexiones de Scout', exact: true });
  await expect(list).toContainText('Notebook de investigación'); await expect(list).toContainText('Asistente de escritorio');
  const trigger = page.getByRole('button', { name: 'Desconectar Asistente de escritorio de Scout', exact: true });
  await trigger.click();
  let dialog = page.getByRole('dialog', { name: 'Desconectar cliente', exact: true });
  await expect(dialog).toContainText('Asistente de escritorio de Scout');
  await expect(dialog).toContainText('Desde'); await expect(dialog).toContainText('Autorizado');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click(); dialog = page.getByRole('dialog', { name: 'Desconectar cliente', exact: true });
  await dialog.getByRole('button', { name: 'Desconectar cliente', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const connections = (await owned(page))[0]!.connections;
  expect(connections.find(item => item.clientName === 'Asistente de escritorio')!.revokedAt).toBeTruthy();
  expect(connections.find(item => item.clientName === 'Notebook de investigación')!.revokedAt).toBeNull();
});
