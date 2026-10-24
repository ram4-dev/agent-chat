import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { expect, test } from '@playwright/test';
import { authorizeAgent, mcpClient, payload } from './helpers/agent';
import { addAgent, createGroup, send, signUp } from './helpers/ui';

test('an agent discovers its instructions and follows the documented receive, reply and ACK cycle', async ({ page, baseURL }) => {
  await page.goto('/');
  await signUp(page, `participation-${randomUUID()}@example.com`, 'Participation owner');
  const agent = await authorizeAgent(page, baseURL!);
  await page.goto('/');
  const groupId = await createGroup(page, 'Participation guide');
  await addAgent(page, 'Scout');
  const client = await mcpClient(baseURL!, agent.token);
  let receiver: WebSocket | undefined;
  try {
    expect(client.getInstructions()).toContain('get_agent_instructions');
    const guide = payload<{ guide_uri: string; instructions: string; receiver: { url: string; ready_event: string; notification_event: string } }>(
      await client.callTool({ name: 'get_agent_instructions', arguments: {} }),
    );
    const document = await client.readResource({ uri: guide.guide_uri });
    const content = document.contents[0];
    expect(guide.instructions).toEqual(expect.any(String));
    expect(content && 'text' in content ? content.text : undefined).toBe(guide.instructions);
    receiver = new WebSocket(guide.receiver.url, { headers: { authorization: `Bearer ${agent.token}` } });
    const [ready] = await once(receiver, 'message');
    expect(JSON.parse(String(ready)).type).toBe(guide.receiver.ready_event);
    const incoming = once(receiver, 'message');
    await send(page, 'Scout, confirmá que recibiste la tarea.');
    const event = JSON.parse(String((await incoming)[0]));
    expect(event.type).toBe(guide.receiver.notification_event);
    const pending = payload<{ events: Array<{ eventId: string }> }>(await client.callTool({ name: 'get_inbox', arguments: {} }));
    expect(pending.events.map((item) => item.eventId)).toContain(event.event_id);
    const reply = { group_id: groupId, text: 'Recibí la tarea y estoy atendiendo las notificaciones.', idempotency_key: `reply:${event.event_id}:final` };
    const sent = payload<{ message: { id: string } }>(await client.callTool({ name: 'send_message', arguments: reply }));
    const retry = payload<{ message: { id: string }; replayed: boolean }>(await client.callTool({ name: 'send_message', arguments: reply }));
    expect(retry).toMatchObject({ replayed: true, message: { id: sent.message.id } });
    await expect(page.getByRole('list', { name: 'Mensajes' })).toContainText(reply.text);
    const beforeAck = payload<{ events: Array<{ eventId: string }> }>(await client.callTool({ name: 'get_inbox', arguments: {} }));
    expect(beforeAck.events.map((item) => item.eventId)).toContain(event.event_id);
    await client.callTool({ name: 'ack_inbox', arguments: { event_id: event.event_id } });
    expect(payload<{ events: unknown[] }>(await client.callTool({ name: 'get_inbox', arguments: {} })).events).toEqual([]);
  } finally {
    receiver?.terminate();
    await client.close();
  }
});
