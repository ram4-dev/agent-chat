import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authorizeAgent, mcpClient, payload } from './helpers/agent';
import { signUp } from './helpers/ui';

test('a client normalizing the root resource can authorize once and use MCP', async ({ page, baseURL }) => {
  await page.goto('/');
  await signUp(page, `normalized-${randomUUID()}@example.com`, 'Normalized resource owner');
  const agent = await authorizeAgent(page, baseURL!, undefined, `${baseURL}/`);
  const client = await mcpClient(baseURL!, agent.token);
  try {
    const identity = payload<{ agent: { id: string } }>(await client.callTool({ name: 'get_identity', arguments: {} }));
    expect(identity.agent.id).toBe(agent.agentId);
  } finally {
    await client.close();
  }
});
