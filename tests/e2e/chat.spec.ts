import { expect, test, type Page } from '@playwright/test';

/**
 * Real-route check for AC1: two people in the same private group exchange
 * messages and each sees the other's message appear without a reload.
 *
 * The spec drives the shipped bundle in two real browser contexts against the
 * running server. Values are literal on purpose: this verifies the artifact,
 * not the shared contract module.
 */
const password = 'a-sufficiently-long-password';

async function signUp(page: Page, email: string, displayName: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Signed in as ${displayName}.`)).toBeVisible();
}

test("two members see each other's messages appear without reloading", async ({ browser }) => {
  const adaContext = await browser.newContext();
  const graceContext = await browser.newContext();
  const ada = await adaContext.newPage();
  const grace = await graceContext.newPage();

  await ada.goto('/');
  await signUp(ada, 'live-ada@example.com', 'Ada');
  await ada.getByLabel('New group name').fill('Realtime');
  await ada.getByRole('button', { name: 'Create group' }).click();
  await ada.getByRole('button', { name: 'Realtime' }).click();
  await expect(ada.getByRole('list', { name: 'Members' })).toContainText('Ada (admin)');

  await ada.getByRole('button', { name: 'Create invitation link' }).click();
  const token = (await ada.getByLabel('Invitation').locator('code').textContent()) ?? '';

  await grace.goto('/');
  await signUp(grace, 'live-grace@example.com', 'Grace');
  await grace.getByLabel('Invitation token').fill(token);
  await grace.getByRole('button', { name: 'Join group' }).click();
  await expect(grace.getByText('You are in 1 group(s).')).toBeVisible();
  await grace.getByRole('button', { name: 'Realtime' }).click();

  // Ada writes; Grace must see it through the socket, without navigating.
  await ada.getByRole('button', { name: 'Realtime' }).click();
  await ada.getByRole('textbox', { name: 'Message' }).fill('Hello from Ada');
  await ada.getByRole('button', { name: 'Send' }).click();

  await expect(grace.getByRole('list', { name: 'Messages' })).toContainText('Hello from Ada');
  await expect(grace.getByRole('list', { name: 'Messages' })).toContainText('Ada');

  // And the other direction, so realtime is proven to be mutual.
  await grace.getByRole('textbox', { name: 'Message' }).fill('Hello from Grace');
  await grace.getByRole('button', { name: 'Send' }).click();

  await expect(ada.getByRole('list', { name: 'Messages' })).toContainText('Hello from Grace');
  await expect(ada.getByRole('list', { name: 'Messages' })).toContainText('Grace');

  await adaContext.close();
  await graceContext.close();
});

test('a message survives a full reload, so the socket is not the source of truth', async ({
  browser,
}) => {
  const adaContext = await browser.newContext();
  const ada = await adaContext.newPage();

  await ada.goto('/');
  await signUp(ada, 'reload-ada@example.com', 'Ada');
  await ada.getByLabel('New group name').fill('Durable');
  await ada.getByRole('button', { name: 'Create group' }).click();
  await ada.getByRole('button', { name: 'Durable' }).click();
  await ada.getByRole('textbox', { name: 'Message' }).fill('Persisted text');
  await ada.getByRole('button', { name: 'Send' }).click();
  await expect(ada.getByRole('list', { name: 'Messages' })).toContainText('Persisted text');

  await ada.reload();
  await ada.getByRole('button', { name: 'Durable' }).click();

  await expect(ada.getByRole('list', { name: 'Messages' })).toContainText('Persisted text');

  await adaContext.close();
});

test('a non-member sees no messages and cannot post', async ({ browser }) => {
  const adaContext = await browser.newContext();
  const malloryContext = await browser.newContext();
  const ada = await adaContext.newPage();
  const mallory = await malloryContext.newPage();

  await ada.goto('/');
  await signUp(ada, 'secret-ada@example.com', 'Ada');
  await ada.getByLabel('New group name').fill('Classified');
  await ada.getByRole('button', { name: 'Create group' }).click();
  await ada.getByRole('button', { name: 'Classified' }).click();
  await ada.getByRole('textbox', { name: 'Message' }).fill('For members only');
  await ada.getByRole('button', { name: 'Send' }).click();

  await mallory.goto('/');
  await signUp(mallory, 'secret-mallory@example.com', 'Mallory');

  await expect(mallory.getByText('For members only')).toHaveCount(0);
  await expect(mallory.getByRole('list', { name: 'Messages' })).toHaveCount(0);

  await adaContext.close();
  await malloryContext.close();
});
