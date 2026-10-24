import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signUp } from './helpers/ui';

test.skip(!process.env['MANAGED_E2E'], 'Requires disposable local Supabase Auth and its local mail inbox.');

test('recovers through a real email, invalidates old sessions and rejects link reuse', async ({ page, baseURL }) => {
  const email = `recovery-${randomUUID()}@example.com`;
  await page.goto('/');
  await signUp(page, email, 'Recovery QA');
  const oldCookie = (await page.context().cookies()).find((c) => c.name === 'agent_chat_session')!;
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.getByRole('button', { name: 'Olvidé mi contraseña' }).click();
  const request = page.getByRole('dialog', { name: 'Recuperar acceso' });
  await request.getByLabel('Correo de la cuenta').fill(email);
  await request.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(request.getByRole('status')).toContainText('Si existe una cuenta');
  let messageId = '';
  await expect.poll(async () => {
    const response = await fetch('http://127.0.0.1:54324/api/v1/messages');
    const body = await response.json() as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
    messageId = body.messages.find((m) => m.To.some((to) => to.Address === email))?.ID ?? '';
    return !!messageId;
  }).toBe(true);
  const response = await fetch(`http://127.0.0.1:54324/api/v1/message/${messageId}`);
  const emailBody = await response.json() as { HTML: string };
  const link = [...emailBody.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&')).find((url) => url.includes('/auth/v1/verify'));
  expect(link).toBeTruthy();
  await page.goto(link!);
  const reset = page.getByRole('region', { name: 'Cambiar contraseña' });
  await expect(reset).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await reset.getByLabel('Nueva contraseña', { exact: true }).fill('a-new-sufficiently-long-password');
  await reset.getByLabel('Repetir contraseña').fill('a-new-sufficiently-long-password');
  await reset.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(reset.getByRole('status')).toContainText('Tu contraseña cambió');
  const stale = await page.request.get(`${baseURL}/api/auth/me`, { headers: { cookie: `${oldCookie.name}=${oldCookie.value}` } });
  expect(stale.status()).toBe(401);
  await reset.getByRole('button', { name: 'Volver a ingresar' }).click();
  await page.getByRole('tab', { name: 'Ingresar', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('a-new-sufficiently-long-password');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('main')).toHaveClass(/workspace/);
  const replay = await fetch(link!, { redirect: 'manual' });
  const replayLocation = replay.headers.get('location') ?? '';
  expect(replayLocation).toContain('error');
  expect(replayLocation).not.toContain('access_token=');
});

test('does not reveal account existence or accept an invalid recovery credential', async ({ page }) => {
  await page.goto('/');
  const unknown = await page.request.post('/api/auth/recover', { headers: { origin: new URL(page.url()).origin }, data: { email: `unknown-${randomUUID()}@example.com` } });
  expect(unknown.status()).toBe(200);
  expect(await unknown.json()).toEqual({ status: 'sent_if_registered' });
  const invalid = await page.request.post('/api/auth/reset-password', { headers: { origin: new URL(page.url()).origin }, data: { accessToken: 'invalid', password: 'a-valid-password-for-recovery' } });
  expect(invalid.status()).toBe(401);
});
