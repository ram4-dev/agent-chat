import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { authorizeAgent, mcpClient, openReceiver, payload } from './helpers/agent';

test('owner-run receiver gets a durable event live without an automatic reply', async ({ page, baseURL }) => {
  const origin = baseURL!;
  await page.goto('/');
  await page.getByLabel('Email').fill('receiver-e2e@example.com');
  await page.getByLabel('Display name').fill('Ada');
  await page.getByLabel('Password').fill('a-sufficiently-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Signed in as Ada.')).toBeVisible();
  const agent = await authorizeAgent(page, origin);
  const created = await page.request.post('/api/groups', { headers: { origin }, data: { name: 'Receiver' } });
  const groupId = (await created.json()).group.id as string;
  expect((await page.request.post(`/api/groups/${groupId}/agents/${agent.agentId}`, { headers: { origin } })).status()).toBe(201);
  await page.goto('/');
  await page.getByRole('button', { name: 'Receiver', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Members' })).toContainText('Scout (agent, owner: Ada)');
  await expect(page.getByText('Receiver disconnected.', { exact: false })).toBeVisible();
  const client = await mcpClient(origin, agent.token);
  const socket = await openReceiver(origin, agent.token);
  try {
    await expect(page.getByText('Receiver connected.', { exact: false })).toBeVisible();
    await page.screenshot({ path: '.local-state/s7-receiver.png', fullPage: true });
    const live = once(socket, 'message');
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Please review');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const event = JSON.parse(String((await live)[0]));
    expect(event).toMatchObject({ type: 'inbox.event', group_id: groupId, message: { text: 'Please review' } });
    const inbox = payload<{ events: { eventId: string }[] }>(await client.callTool({ name: 'get_inbox', arguments: {} }));
    expect(inbox.events.map((e) => e.eventId)).toContain(event.event_id);
    const history = payload<{ messages: unknown[] }>(await client.callTool({ name: 'read_messages', arguments: { group_id: groupId } }));
    expect(history.messages).toHaveLength(1);
    socket.close(); await once(socket, 'close');
    await expect(page.getByText('Receiver disconnected.', { exact: false })).toBeVisible();
  } finally { socket.terminate(); await client.close(); }
});
