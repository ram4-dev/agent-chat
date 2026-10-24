import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { expect, test } from '@playwright/test';
import { authorizeAgent, mcpClient, openReceiver, payload } from './helpers/agent';
import { addAgent, createGroup, send, signUp } from './helpers/ui';

for (const scope of ['agent:inbox', 'agent:receive']) {
  test(`${scope} grants only its consented inbox or live receiver operations`, async ({ page, baseURL }) => {
    await page.goto('/');
    await signUp(page, `scopes-${randomUUID()}@example.com`, 'Scoped owner');
    const agent = await authorizeAgent(page, baseURL!, undefined, undefined, `openid ${scope}`);
    await page.goto('/');
    await createGroup(page, 'Scope boundaries');
    await addAgent(page, 'Scout');
    const client = await mcpClient(baseURL!, agent.token);
    let receiver: WebSocket | undefined;
    try {
      if (scope === 'agent:inbox') {
        receiver = new WebSocket(`${baseURL!.replace(/^http/, 'ws')}/ws/agent`, {
          headers: { authorization: `Bearer ${agent.token}` },
        });
        receiver.on('error', () => {});
        const [, response] = await once(receiver, 'unexpected-response');
        expect(response.statusCode).toBe(403);
        response.resume();
        await send(page, 'Recover this pending event.');
        const inbox = payload<{ events: Array<{ eventId: string; message: { text: string } }> }>(
          await client.callTool({ name: 'get_inbox', arguments: {} }),
        );
        expect(inbox.events).toHaveLength(1);
        expect(inbox.events[0]!.message.text).toBe('Recover this pending event.');
        payload(await client.callTool({ name: 'ack_inbox', arguments: { event_id: inbox.events[0]!.eventId } }));
        expect(payload<{ events: unknown[] }>(await client.callTool({ name: 'get_inbox', arguments: {} })).events).toEqual([]);
      } else {
        receiver = await openReceiver(baseURL!, agent.token);
        const incoming = once(receiver, 'message');
        await send(page, 'Deliver this live event.');
        const event = JSON.parse(String((await incoming)[0]));
        expect(event.type).toBe('inbox.event');
        for (const request of [
          { name: 'get_inbox', arguments: {} },
          { name: 'ack_inbox', arguments: { event_id: event.event_id } },
        ]) {
          const denied = await client.callTool(request);
          expect(denied.isError).toBe(true);
          expect(denied.content).toEqual([{ type: 'text', text: 'forbidden' }]);
        }
      }
    } finally {
      receiver?.terminate();
      await client.close();
    }
  });
}
