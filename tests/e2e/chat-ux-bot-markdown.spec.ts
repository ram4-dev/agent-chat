import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authorizeAgent, mcpClient, payload } from './helpers/agent';
import { addAgent, createGroup, signUp } from './helpers/ui';

// OAuth/MCP uses the suite's canonical configured HTTP loopback origin.
test('real MCP bot messages use the same safe Markdown renderer as human messages', async ({ page }) => {
  await page.goto('/');
  await signUp(page, `chat-bot-markdown-${randomUUID()}@example.com`, 'Markdown QA');
  const origin = new URL(page.url()).origin;
  const identity = await authorizeAgent(page, origin);
  const client = await mcpClient(origin, identity.token);
  try {
    await page.goto(origin);
    const groupId = await createGroup(page, 'Respuesta con formato');
    await addAgent(page, 'Scout');
    payload(await client.callTool({ name: 'send_message', arguments: {
      group_id: groupId,
      text: '**Respuesta del bot**\n\n- Paso uno\n- Paso dos\n\nhttps://example.com/bot\n\n```sh\necho seguro\n```\n\n<script>window.botXss=1</script>\n\n[peligro](javascript:alert%281%29)',
      idempotency_key: randomUUID(),
    } }));
    const article = page.getByRole('article', { name: 'Scout (agente de Markdown QA)', exact: true });
    await expect(article.locator('strong').filter({ hasText: 'Respuesta del bot' })).toBeVisible();
    await expect(article.getByRole('link', { name: 'https://example.com/bot' })).toBeVisible();
    await expect(article.locator('.chat-markdown li')).toHaveCount(2);
    await expect(article.getByRole('button', { name: 'Copiar código', exact: true })).toBeVisible();
    await expect(article.locator('script, a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, 'botXss'))).toBeUndefined();
  } finally { await client.close(); }
});
