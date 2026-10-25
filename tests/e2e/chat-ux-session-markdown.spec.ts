import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { agents, createGroup, navigation, selectGroup, signUp } from './helpers/ui';

async function addFixtureBot(page: Page, groupId: string, name: string) {
  const created = await page.request.post('/api/agents', { headers: { origin: new URL(page.url()).origin }, data: { name } });
  expect(created.status()).toBe(201);
  const { agent } = await created.json() as { agent: { id: string } };
  const added = await page.request.post(`/api/groups/${groupId}/agents/${agent.id}`, { headers: { origin: new URL(page.url()).origin } });
  expect(added.status(), await added.text()).toBe(201);
  return agent.id;
}
const messages = (page: Page) => page.getByRole('list', { name: 'Mensajes', exact: true });
const input = (page: Page) => page.getByLabel('Mensaje', { exact: true });

for (const mobile of [false, true]) {
  test(`chat drafts, exact duplicate-name recipients and Markdown (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await signUp(page, `chat-ux-${randomUUID()}@example.com`, 'Chat QA');
    const firstGroup = await createGroup(page, 'Equipo uno');
    const first = await addFixtureBot(page, firstGroup, 'Analista');
    const second = await addFixtureBot(page, firstGroup, 'Analista');
    await createGroup(page, 'Equipo dos');
    await page.reload();
    await selectGroup(page, 'Equipo uno');
    await expect(page.locator('#recipient-summary')).toContainText('Todos los bots habilitados del grupo');
    await input(page).fill('@Ana');
    await page.locator(`#mention-${second}`).click();
    await input(page).fill('@Analista revisá esta propuesta');
    await selectGroup(page, 'Equipo dos');
    await expect(input(page)).toHaveValue('');
    await expect(page.locator('#recipient-summary')).toContainText('Ningún bot');
    await input(page).fill('@Alguien');
    await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('cada @ pendiente');
    await expect(messages(page).locator('article')).toHaveCount(0);
    await input(page).fill('Borrador del segundo grupo');
    await selectGroup(page, 'Equipo uno');
    await expect(input(page)).toHaveValue('@Analista revisá esta propuesta');
    await expect(page.locator('#recipient-summary')).toContainText(second.slice(-6));
    await expect(page.locator('#recipient-summary')).not.toContainText(first.slice(-6));
    await agents(page);
    await selectGroup(page, 'Equipo uno');
    await expect(input(page)).toHaveValue('@Analista revisá esta propuesta');
    const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/messages'));
    await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    const sent = await response;
    expect(sent.status()).toBe(201);
    expect(sent.request().postDataJSON().mentionedAgentIds).toEqual([second]);
    expect((await sent.json()).message.mentionedAgentIds).toEqual([second]);
    await expect(input(page)).toHaveValue('');
    await selectGroup(page, 'Equipo dos');
    await expect(input(page)).toHaveValue('Borrador del segundo grupo');
    await page.getByRole('button', { name: 'Descartar borrador', exact: true }).click();
    await expect(input(page)).toHaveValue('');
    const text = '**Propuesta**\n\n- Revisar\n- Aprobar\n\nhttps://example.com/plan\n\n```js\nconst answer = "<safe>";\n// long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-\n```\n\n<img src=x onerror="window.chatXss=1">\n\n[malicioso](javascript:alert%281%29) [dato](data:text/html,bad)';
    await input(page).fill(text);
    await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(messages(page).locator('strong').filter({ hasText: 'Propuesta' })).toBeVisible();
    await expect(messages(page).getByRole('link', { name: 'https://example.com/plan' })).toHaveAttribute('href', 'https://example.com/plan');
    await expect(messages(page).locator('.chat-markdown li')).toHaveCount(2);
    await expect(messages(page).locator('.chat-markdown img, .chat-markdown script')).toHaveCount(0);
    await expect(messages(page).locator('a[href^="javascript:"], a[href^="data:"]')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, 'chatXss'))).toBeUndefined();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { Reflect.set(window, 'copiedChatCode', text); } } }));
    await messages(page).getByRole('button', { name: 'Copiar código', exact: true }).click();
    await expect(messages(page).getByRole('status')).toHaveText('Copiado');
    expect(await page.evaluate(() => Reflect.get(window, 'copiedChatCode'))).toBe('const answer = "<safe>";\n// long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-long-code-');
    if (mobile) {
      expect(await input(page).evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
      expect((await page.getByRole('button', { name: 'Enviar mensaje' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: `.local-state/uiux-chat/chat-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await input(page).fill('Sesión privada');
    await navigation(page);
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await signUp(page, `chat-other-${randomUUID()}@example.com`, 'Otra persona');
    await createGroup(page, 'Equipo privado nuevo');
    await expect(input(page)).toHaveValue('');
  });
}

test('unresolved @ intent never broadcasts; emails/code, removal and IME remain usable', async ({ page }) => {
  await page.goto('/'); await signUp(page, `chat-intent-${randomUUID()}@example.com`, 'Intent QA');
  const group = await createGroup(page, 'Intención');
  const id = await addFixtureBot(page, group, 'Analista');
  await page.reload();
  let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/messages')) posts++; });
  await input(page).fill('@Analista revisá esto');
  await expect(page.locator('#recipient-summary')).toContainText('menciones pendientes');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('cada @ pendiente');
  expect(posts).toBe(0);
  await input(page).fill('@Ana');
  await input(page).dispatchEvent('compositionstart');
  await input(page).press('Enter');
  await expect(input(page)).not.toHaveValue('@Analista ');
  expect(posts).toBe(0);
  await input(page).dispatchEvent('compositionend');
  await input(page).fill('@Ana');
  await input(page).press('Enter');
  await expect(page.getByRole('button', { name: 'Quitar mención a Analista', exact: true })).toBeVisible();
  await input(page).fill('@AnalistaOther');
  await expect(page.getByRole('button', { name: 'Quitar mención a Analista', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  expect(posts).toBe(0);
  await input(page).fill('@Ana'); await page.locator(`#mention-${id}`).click();
  await page.getByRole('button', { name: 'Quitar mención a Analista', exact: true }).click();
  await expect(input(page)).toHaveValue('Analista ');
  await expect(page.locator('#recipient-summary')).toContainText('Todos los bots');
  await input(page).fill('ana@example.com y `@codigo`\n\n```js\n@literal\n```');
  const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/messages'));
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  expect((await response).request().postDataJSON().mentionedAgentIds).toBeUndefined();
  await expect(input(page)).toHaveValue('');
  expect(posts).toBe(1);
});

test('failed sends retain their retry key across navigation; late success preserves newer edits', async ({ page }) => {
  await page.goto('/'); await signUp(page, `chat-send-${randomUUID()}@example.com`, 'Send QA');
  await createGroup(page, 'Envío');
  await input(page).fill('Enviar una vez');
  let retryKey = '';
  await page.route('**/api/groups/*/messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    retryKey = route.request().postDataJSON().idempotencyKey;
    await route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } });
    await page.unroute('**/api/groups/*/messages');
  });
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Tu borrador sigue acá');
  await agents(page); await selectGroup(page, 'Envío');
  await expect(input(page)).toHaveValue('Enviar una vez');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void;
  const intercepted = new Promise<void>(resolve => { arrived = resolve; });
  await page.route('**/api/groups/*/messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    expect(route.request().postDataJSON().idempotencyKey).toBe(retryKey);
    arrived(); await gate; await route.continue();
  });
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await intercepted;
  await agents(page); await selectGroup(page, 'Envío');
  await input(page).fill('Edición mientras llega la respuesta');
  release();
  await expect(messages(page)).toContainText('Enviar una vez');
  await expect(input(page)).toHaveValue('Edición mientras llega la respuesta');
  await expect(page.getByRole('button', { name: 'Enviar mensaje', exact: true })).toBeEnabled();
});
