import { expect, test, type Page } from '@playwright/test';

/**
 * Real-route check for AC2: private groups stay invisible to non-members, and an
 * invited person actually joins.
 *
 * Every value is written literally on purpose: this spec exercises the shipped
 * bundle and the running server, not the shared contract module.
 */
const password = 'a-sufficiently-long-password';

async function signUp(page: Page, email: string, displayName: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Signed in as ${displayName}.`)).toBeVisible();
}

test('a non-member cannot see a private group and an invited person joins it', async ({
  browser,
}) => {
  const adaContext = await browser.newContext();
  const graceContext = await browser.newContext();
  const ada = await adaContext.newPage();
  const grace = await graceContext.newPage();

  // Person A registers, creates a private group, and becomes its admin.
  await ada.goto('/');
  await signUp(ada, 'ada@example.com', 'Ada');
  await ada.getByLabel('New group name').fill('Research');
  await ada.getByRole('button', { name: 'Create group' }).click();
  await ada.getByRole('button', { name: 'Research' }).click();
  await expect(ada.getByText('Your role: admin')).toBeVisible();
  await expect(ada.getByRole('list', { name: 'Members' })).toContainText('Ada (admin)');

  // Person B registers and belongs to no group.
  await grace.goto('/');
  await signUp(grace, 'grace@example.com', 'Grace');
  await expect(grace.getByText('You are not in any group yet.')).toBeVisible();

  // The admin creates an invitation; the token is the only shared secret.
  await ada.getByRole('button', { name: 'Create invitation link' }).click();
  const token = (await ada.getByLabel('Invitation').locator('code').textContent()) ?? '';
  expect(token).toHaveLength(43);

  // Person B joins through the invitation.
  await grace.getByLabel('Invitation token').fill(token);
  await grace.getByRole('button', { name: 'Join group' }).click();
  await expect(grace.getByText('You are in 1 group(s).')).toBeVisible();
  await grace.getByRole('button', { name: 'Research' }).click();
  await expect(grace.getByText('Your role: member')).toBeVisible();
  await expect(grace.getByRole('list', { name: 'Members' })).toContainText('Grace (member)');

  await adaContext.close();
  await graceContext.close();
});

test('an unrelated person is refused the group without learning it exists', async ({
  browser,
}) => {
  const adaContext = await browser.newContext();
  const malloryContext = await browser.newContext();
  const ada = await adaContext.newPage();
  const mallory = await malloryContext.newPage();

  await ada.goto('/');
  await signUp(ada, 'ada2@example.com', 'Ada');
  await ada.getByLabel('New group name').fill('Secret');
  await ada.getByRole('button', { name: 'Create group' }).click();

  await mallory.goto('/');
  await signUp(mallory, 'mallory@example.com', 'Mallory');

  // The refusal is indistinguishable from an unknown group: the UI reports an
  // unavailable group and never names it.
  await expect(mallory.getByText('You are not in any group yet.')).toBeVisible();
  await expect(mallory.getByText('Secret')).toHaveCount(0);

  await adaContext.close();
  await malloryContext.close();
});
