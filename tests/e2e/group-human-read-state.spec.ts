import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Browser } from '@playwright/test';
import { createGroup, invitation, joinGroup, selectGroup, signUp } from './helpers/ui';

async function activity(page: Page, id: string) {
  return page.evaluate(async groupId => {
    const response = await fetch('/api/groups');
    const body = await response.json();
    return body.groups.find((group: { id: string }) => group.id === groupId)?.activity;
  }, id);
}
async function postMessage(page: Page, groupId: string, text: string) {
  return page.evaluate(async input => {
    const response = await fetch(`/api/groups/${input.groupId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: input.text, idempotencyKey: input.text }),
    });
    if (!response.ok) throw new Error(`send: ${response.status}`);
    return (await response.json()).message.id as string;
  }, { groupId, text });
}
async function people(browser: Browser) {
  const a = await browser.newContext(); const b = await browser.newContext();
  const ada = await a.newPage(); const grace = await b.newPage();
  const suffix = randomUUID();
  await ada.goto('/'); await signUp(ada, `read-ada-${suffix}@example.com`, 'Ada');
  const first = await createGroup(ada, 'Primero'); const firstInvite = await invitation(ada);
  const second = await createGroup(ada, 'Segundo'); const secondInvite = await invitation(ada);
  await grace.goto('/'); await signUp(grace, `read-grace-${suffix}@example.com`, 'Grace');
  await joinGroup(grace, firstInvite); await joinGroup(grace, secondInvite);
  return { a, b, ada, grace, first, second };
}

test('group-list local retry preserves selected conversation, filter, draft and document', async ({ page }) => {
  await page.goto('/'); await signUp(page, `retry-${randomUUID()}@example.com`, 'Retry');
  const id = await createGroup(page, 'Grupo estable');
  const composer = page.getByLabel('Mensaje', { exact: true });
  await composer.fill('Borrador sin enviar'); await page.getByLabel('Buscar grupo').fill('estable');
  const origin = await page.evaluate(() => performance.timeOrigin);
  let fail = true;
  await page.route('**/api/groups', async route => {
    if (route.request().method() === 'GET' && fail) await route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } });
    else await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const nav = page.getByRole('navigation', { name: 'Grupos', exact: true });
  await expect(nav.getByRole('alert')).toContainText('última lista guardada');
  await page.screenshot({ path: '.local-state/group-read-e2e/retry-error-desktop.png' });
  await expect(page.getByRole('region', { name: 'Conversación de Grupo estable', exact: true })).toHaveAttribute('data-group-id', id);
  await expect(composer).toHaveValue('Borrador sin enviar');
  fail = false; await nav.getByRole('button', { name: 'Volver a intentar' }).click();
  await expect(nav.getByRole('alert')).toHaveCount(0);
  await expect(composer).toHaveValue('Borrador sin enviar');
  await expect(page.getByLabel('Buscar grupo')).toHaveValue('estable');
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  expect(new URL(page.url()).searchParams.get('group')).toBe(id);
  await page.screenshot({ path: '.local-state/group-read-e2e/retry-desktop.png' });
});

test('an older list response cannot evict a newly opened group', async ({ page }) => {
  await page.goto('/'); await signUp(page, `list-race-${randomUUID()}@example.com`, 'Race');
  await createGroup(page, 'Grupo anterior');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let received!: () => void;
  const started = new Promise<void>(resolve => { received = resolve; });
  let hold = true;
  await page.route('**/api/groups', async route => {
    if (route.request().method() !== 'GET' || !hold) { await route.continue(); return; }
    hold = false;
    const snapshot = await route.fetch(); received();
    await held;
    await route.fulfill({ response: snapshot });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  const id = await createGroup(page, 'Grupo nuevo');
  release();
  await expect(page.getByRole('navigation', { name: 'Grupos', exact: true }).getByRole('button', { name: 'Grupo nuevo', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conversación de Grupo nuevo', exact: true })).toHaveAttribute('data-group-id', id);
  await expect(page.getByRole('main')).not.toContainText('Ya no tenés acceso');
});

test('initial group-list failure retries locally and permission loss never masquerades as empty groups', async ({ page }) => {
  await page.goto('/'); await signUp(page, `initial-${randomUUID()}@example.com`, 'Initial');
  await createGroup(page, 'Grupo privado');
  let status = 503;
  await page.route('**/api/groups', async route => {
    if (route.request().method() === 'GET' && status !== 200) await route.fulfill({ status, json: { error: { code: status === 403 ? 'forbidden' : 'internal_error' } } });
    else await route.continue();
  });
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Grupos', exact: true });
  await expect(nav.getByRole('alert')).toContainText('No pudimos cargar');
  await expect(nav).not.toContainText('Tus grupos van a aparecer');
  status = 200; await nav.getByRole('button', { name: 'Volver a intentar' }).click();
  await expect(page.getByRole('region', { name: 'Conversación de Grupo privado', exact: true })).toBeVisible();
  status = 403; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(nav.getByRole('alert')).toContainText('No tenés acceso');
  await expect(nav.getByRole('button', { name: 'Grupo privado', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Conversación de Grupo privado', exact: true })).toHaveCount(0);
});

test('two-human background-group metadata refreshes live and exact read endpoint survives reload', async ({ browser }) => {
  const f = await people(browser);
  try {
    const id = await postMessage(f.ada, f.first, 'Pendiente en otro grupo');
    const row = f.grace.getByRole('navigation', { name: 'Grupos', exact: true }).getByRole('button', { name: 'Primero', exact: true });
    await expect(row.locator('.group-unread-count')).toHaveText('1'); await expect(row.locator('time')).toHaveAttribute('aria-label', /Última actividad/);
    expect((await activity(f.grace, f.first)).unreadCount).toBe(1);
    await f.grace.screenshot({ path: '.local-state/group-read-e2e/unread-desktop.png' });
    await f.grace.evaluate(async ({ groupId, messageId }) => {
      // Protocol check: the integrated display callback is tested separately below.
      const response = await fetch(`/api/groups/${groupId}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageIds: [messageId] }) });
      if (!response.ok) throw new Error(`read: ${response.status}`);
    }, { groupId: f.first, messageId: id });
    await f.grace.reload(); expect((await activity(f.grace, f.first)).unreadCount).toBe(0);
    await postMessage(f.grace, f.first, 'Mensaje propio');
    expect((await activity(f.grace, f.first)).unreadCount).toBe(0);
  } finally { await f.a.close(); await f.b.close(); }
});

// Requires the chat worker's actual-visibility callback; parent runs after combining commits.
test('automatic display callback reads opened visible messages and leaves hidden or unloaded messages pending', async ({ browser }) => {
  const f = await people(browser);
  try {
    await postMessage(f.ada, f.first, 'Pendiente hasta abrir');
    await expect.poll(async () => (await activity(f.grace, f.first)).unreadCount).toBe(1);
    await f.grace.bringToFront(); await selectGroup(f.grace, 'Primero');
    await expect.poll(async () => (await activity(f.grace, f.first)).unreadCount).toBe(0);
    // Exercise the document visibility contract with a controlled hidden state.
    await f.grace.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
    await f.grace.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await postMessage(f.ada, f.first, 'Llegó con pestaña oculta');
    await expect(f.grace.getByRole('list', { name: 'Mensajes', exact: true })).toContainText('Llegó con pestaña oculta');
    await expect.poll(async () => (await activity(f.grace, f.first)).unreadCount).toBe(1);
    await f.grace.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await f.grace.bringToFront();
    await expect.poll(async () => (await activity(f.grace, f.first)).unreadCount).toBe(0);
    await f.grace.reload(); await expect.poll(async () => (await activity(f.grace, f.first)).unreadCount).toBe(0);
  } finally { await f.a.close(); await f.b.close(); }
});
