import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { authorizeAgent, openReceiver } from './helpers/agent';
import { agents, createGroup, signUp } from './helpers/ui';
import type { OwnedAgentsResponse } from '@agent-chat/contracts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const scenario of [
  { action: 'save', suffix: '', dismiss: 'Escape' },
  { action: 'test', suffix: '/test', dismiss: 'close button' },
  { action: 'pause', suffix: '/pause', dismiss: 'backdrop' },
] as const) test(`pending notification ${scenario.action} allows ${scenario.dismiss} and ignores a late reply`, async ({ page }) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  await signUp(page, `dismiss-${randomUUID()}@example.com`, 'Dueño');
  const identity = await authorizeAgent(page, origin);
  await page.goto('/'); await agents(page);
  const owned = (await (await page.request.get('/api/agents')).json() as OwnedAgentsResponse).agents[0]!;
  const target = `/api/agents/${identity.agentId}/notifications`;
  const pending = deferred(), release = deferred(), completed = deferred();
  const posts: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let status = { available: true, active: false, receipt_confirmed: false, configured: scenario.action !== 'save', enabled: true, connections: owned.connections };
  await page.route('**/api/agents/*/notifications**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== target && !url.pathname.startsWith(target + '/')) {
      return route.fulfill({ json: { available: true, active: false, connections: [] } });
    }
    if (route.request().method() === 'GET') return route.fulfill({ json: status });
    posts.push(url.pathname);
    if (url.pathname !== target + scenario.suffix) return route.fulfill({ json: status });
    pending.resolve();
    await release.promise;
    // Simulate an operation that reached the server before the browser aborted.
    status = { ...status, configured: true, enabled: scenario.action !== 'pause' };
    try { await route.fulfill({ json: status }); } catch { /* Aborted browser transport can no longer accept the reply. */ }
    finally { completed.resolve(); }
  });
  const trigger = page.getByRole('button', { name: 'Notificaciones de Scout', exact: true });
  try {
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Notificaciones de Scout', exact: true });
    await dialog.getByText('Configuración manual privada', { exact: true }).click();
    await dialog.getByLabel('URL del webhook', { exact: true }).fill('https://notifications.example.com/pending');
    await dialog.getByLabel('Clave del webhook', { exact: true }).fill('fixture-private-pending-key');
    const failed = page.waitForEvent('requestfailed', request => request.method() === 'POST' && new URL(request.url()).pathname === target + scenario.suffix);
    await dialog.getByRole('button', { name: scenario.action === 'save' ? 'Guardar y probar' : scenario.action === 'test' ? 'Probar y activar' : 'Pausar avisos', exact: true }).click();
    await pending.promise;
    await expect(dialog).toContainText('La solicitud puede completarse en el servidor');
    if (scenario.action === 'save') {
      await expect(dialog.getByLabel('Clave del webhook', { exact: true })).toHaveValue('');
      await expect(dialog.getByLabel('URL del webhook', { exact: true })).toHaveValue('');
    }
    if (scenario.dismiss === 'Escape') await page.keyboard.press('Escape');
    else if (scenario.dismiss === 'close button') await dialog.getByRole('button', { name: 'Cerrar ventana', exact: true }).click();
    else await page.mouse.click(2, 2);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await failed;

    // The old POST is still held while another identity opens its own session.
    const second = await page.request.post('/api/agents', { headers: { origin }, data: { name: 'Otra identidad' } });
    expect(second.status()).toBe(201);
    await page.getByRole('button', { name: 'Actualizar agentes', exact: true }).click();
    const otherTrigger = page.getByRole('button', { name: 'Notificaciones de Otra identidad', exact: true });
    await otherTrigger.click();
    const other = page.getByRole('dialog', { name: 'Notificaciones de Otra identidad', exact: true });
    const connect = other.getByRole('button', { name: 'Conectar mi agente', exact: true });
    await connect.focus();
    release.resolve(); await completed.promise;
    await expect(other).toBeVisible(); await expect(connect).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(other.getByRole('alert')).toHaveCount(0);
    expect(posts).toEqual([target + scenario.suffix]); // No late save -> test continuation.
    await page.keyboard.press('Escape'); await expect(otherTrigger).toBeFocused();

    await trigger.click();
    await dialog.getByText('Configuración manual privada', { exact: true }).click();
    await expect(dialog.getByLabel('Clave del webhook', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('URL del webhook', { exact: true })).toHaveValue('');
    await expect(dialog).toContainText('Configurado: esperando que el agente confirme una prueba real.');
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    expect(pageErrors).toEqual([]);
  } finally { release.resolve(); }
});

test('authenticated persistent receiver on SQLite can continue without a webhook or processing claim', async ({ page }) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  await signUp(page, `receiver-guide-${randomUUID()}@example.com`, 'Receptor');
  const identity = await authorizeAgent(page, origin);
  const socket = await openReceiver(origin, identity.token);
  try {
    await page.goto('/'); await createGroup(page, 'Grupo con receptor'); await agents(page);
    const response = await page.request.get(`/api/agents/${identity.agentId}/notifications`);
    expect((await response.json()).available).toBe(false);
    await page.getByRole('button', { name: 'Continuar conexión', exact: true }).click();
    const guide = page.getByRole('dialog', { name: 'Conectar un agente', exact: true });
    const delivery = guide.getByRole('listitem').filter({ hasText: 'Recepción y avisos' });
    await expect(delivery).toContainText('Receptor autenticado conectado: puede recibir eventos en vivo.');
    await expect(delivery).toContainText('La conexión no demuestra que haya procesado un mensaje.');
    await expect(delivery).not.toHaveAttribute('aria-current', 'step');
    await expect(delivery).toContainText('La consulta periódica no requiere webhook.');
    await expect(delivery.getByRole('button', { name: 'Configurar notificaciones', exact: true })).toHaveCount(0);
    await delivery.getByText('Webhook opcional', { exact: true }).click();
    await expect(delivery).toContainText('podés continuar sin webhook');
    await guide.getByRole('button', { name: 'Agregar a Grupo con receptor', exact: true }).click();
    await expect(guide).toContainText('Scout ya pertenece a Grupo con receptor.');
    await expect(guide).not.toContainText('Recepción confirmada por el agente.');
    await expect(guide).not.toContainText('Listo para responder');
    const closed = once(socket, 'close'); socket.close(); await closed;
    await guide.getByRole('button', { name: 'Actualizar progreso', exact: true }).click();
    await expect(delivery).toContainText('Falta confirmar la recepción.');
    await expect(delivery.getByRole('button', { name: 'Configurar notificaciones', exact: true })).toBeVisible();
  } finally { socket.terminate(); }
});
