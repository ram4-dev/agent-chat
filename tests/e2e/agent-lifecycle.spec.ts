import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { authorizeAgent, mcpClient, openReceiver, payload } from './helpers/agent';

test('owner revokes connection and agent while historical authorship survives', async ({ page, baseURL }) => {
  const origin = baseURL!;
  await page.goto('/');
  await page.getByLabel('Email').fill('lifecycle-e2e@example.com');
  await page.getByLabel('Display name').fill('Ada');
  await page.getByLabel('Password').fill('a-sufficiently-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Signed in as Ada.')).toBeVisible();
  const agent = await authorizeAgent(page, origin);
  await page.goto('/');
  await page.getByLabel('New group name').fill('Lifecycle');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await page.getByRole('button', { name: 'Lifecycle', exact: true }).click();
  const groupId = await page.getByRole('region', { name: 'Chat in Lifecycle' }).getAttribute('data-group-id');
  await page.getByRole('button', { name: 'Add Scout to selected group', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Members' })).toContainText('Scout (agent, owner: Ada)');
  const client = await mcpClient(origin, agent.token);
  const socket = await openReceiver(origin, agent.token);
  try {
    const sent = payload<{ message: { id: string; author: { kind: string; id: string } } }>(await client.callTool({ name: 'send_message', arguments: { group_id: groupId, text: 'Spontaneous update', idempotency_key: 'spontaneous' } }));
    expect(sent.message.author).toMatchObject({ kind: 'agent', id: agent.agentId });
    await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Scout (agent of Ada): Spontaneous update');
    await page.getByRole('button', { name: 'Revoke connection', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirm revocation' })).toContainText('Previous messages keep the agent name and human owner.');
    await page.screenshot({ path: '.local-state/s8-revocation.png', fullPage: true });
    const closed = once(socket, 'close');
    await page.getByRole('button', { name: 'Confirm revocation', exact: true }).click();
    expect((await closed)[0]).toBe(4401);
    await expect(client.callTool({ name: 'get_identity', arguments: {} })).rejects.toThrow('unauthenticated');
    expect((await page.request.post('/token', { form: { grant_type: 'refresh_token', refresh_token: agent.refreshToken, client_id: agent.clientId } })).status()).toBe(400);
    await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Scout (agent of Ada): Spontaneous update');
  } finally { socket.terminate(); await client.close(); }

  const reconnected = await authorizeAgent(page, origin, agent.agentId);
  expect(reconnected.agentId).toBe(agent.agentId);
  const second = await mcpClient(origin, reconnected.token);
  const receiver = await openReceiver(origin, reconnected.token);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Lifecycle', exact: true }).click();
    await page.getByRole('button', { name: 'Revoke agent Scout', exact: true }).click();
    const closed = once(receiver, 'close');
    await page.getByRole('button', { name: 'Confirm revocation', exact: true }).click();
    expect((await closed)[0]).toBe(4401);
    await expect(second.callTool({ name: 'get_identity', arguments: {} })).rejects.toThrow('unauthenticated');
    await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Scout (agent of Ada): Spontaneous update');
    await expect(page.getByRole('list', { name: 'Owned agents' })).toContainText('Status: revoked');
  } finally { receiver.terminate(); await second.close(); }
});
