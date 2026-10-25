import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { agents, navigation, signUp } from './helpers/ui';

for (const mobile of [false, true]) test(`agent navigation waits for a cold authenticated document (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await signUp(page, `navigation-ready-${randomUUID()}@example.com`, 'Navegación');
  // Return to a real document before its client/session is ready, as after OAuth.
  // No intercepted responses, fake data, forced clicks, delays or retries.
  await page.goto('/', { waitUntil: 'commit' });
  await agents(page);
  await expect(page.getByRole('heading', { name: 'Mis agentes', exact: true })).toBeVisible();
  await navigation(page);
  await navigation(page); // Readiness must also work when the panel is already open.
  const panel = page.getByRole('complementary', { name: 'Navegación principal', exact: true });
  await expect(panel).toBeInViewport();
  await expect(panel.getByRole('button', { name: 'Mis agentes', exact: true })).toBeInViewport();
  await panel.getByRole('button', { name: 'Mis agentes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mis agentes', exact: true })).toBeVisible();
});
