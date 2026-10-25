import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createGroup, signUp } from './helpers/ui';

test('formatted intent blocks broadcasts and real duplicate-token deletions preserve the surviving ID', async ({ page }) => {
  await page.goto('/');
  await signUp(page, `mention-edit-${randomUUID()}@example.com`, 'Mention edit QA');
  const group = await createGroup(page, 'Menciones con formato');
  const origin = new URL(page.url()).origin;
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const created = await page.request.post('/api/agents', { headers: { origin }, data: { name: 'Analista' } });
    expect(created.status()).toBe(201);
    const { agent } = await created.json() as { agent: { id: string } };
    ids.push(agent.id);
    const added = await page.request.post(`/api/groups/${group}/agents/${agent.id}`, { headers: { origin } });
    expect(added.status()).toBe(201);
  }
  await page.reload();
  const input = page.getByLabel('Mensaje', { exact: true });
  const send = page.getByRole('button', { name: 'Enviar mensaje', exact: true });
  const posts: string[][] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/messages')) posts.push(request.postDataJSON().mentionedAgentIds ?? []);
  });
  async function submitTo(id: string) {
    const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/messages'));
    await send.click();
    const sent = await response;
    expect(sent.status()).toBe(201);
    expect((await sent.json()).message.mentionedAgentIds).toEqual([id]);
    expect(posts.at(-1)).toEqual([id]);
    await expect(input).toHaveValue('');
  }
  for (const text of ['**@Analista** revisá esto', '[@Analista](https://example.com)', '[**@Analista**](https://example.com/@destination)', '~~@Analista~~']) {
    const count = posts.length;
    await input.fill(text); await send.click();
    await expect(page.getByRole('alert')).toContainText('cada @ pendiente');
    expect(posts).toHaveLength(count);
    await page.locator(`#mention-${ids[1]}`).click();
    await expect(page.locator('#recipient-summary')).toContainText(ids[1]!.slice(-6));
    await expect(page.locator('#recipient-summary')).not.toContainText('menciones pendientes');
    await submitTo(ids[1]!);
  }
  for (const text of [
    '| Bot |\n| --- |\n|@Analista|',
    'Bot|Otro\n---|---\n@Analista|texto',
    '| Bot |\n| --- |\n|**@Analista**|',
    '![@Analista](https://example.com/@destination)',
    '![**@Analista**](https://example.com/@destination)',
    '![`@Analista`](https://example.com/@destination)',
    '![@Analista][bot]\n\n[bot]: https://example.com/@destination',
  ]) {
    const count = posts.length;
    await input.fill(text); await send.click();
    await expect(page.getByRole('alert')).toContainText('cada @ pendiente');
    expect(posts).toHaveLength(count);
    // Resolve through an explicit picker choice, then preserve that same token inside GFM.
    await input.fill('@Ana'); await page.locator(`#mention-${ids[1]}`).click();
    await input.fill(text);
    await expect(page.locator('#recipient-summary')).toContainText(ids[1]!.slice(-6));
    await expect(page.locator('#recipient-summary')).not.toContainText('menciones pendientes');
    await submitTo(ids[1]!);
    const article = page.getByRole('list', { name: 'Mensajes', exact: true }).locator('article').last();
    await expect(article.locator('.chat-markdown')).toContainText('@Analista');
    await expect(article.locator('img')).toHaveCount(0);
    if (text.includes('|')) await expect(article.getByRole('cell', { name: '@Analista', exact: true })).toBeVisible();
  }
  for (const text of ['<span>@Analista</span>', '![[ref]: @Analista](https://example.com)']) {
    // Even a previously selected identity cannot resolve an ambiguous visible source mapping.
    await input.fill('@Ana'); await page.locator(`#mention-${ids[1]}`).click();
    const count = posts.length;
    await input.fill(text); await send.click();
    await expect(page.getByRole('alert')).toContainText('cada @ pendiente');
    expect(posts).toHaveLength(count);
    await input.fill('');
  }
  // Insert formatting around an explicitly selected token, one real browser edit at a time.
  for (const [opening, closing] of [['**', '**'], ['[', '](https://example.com/@destination)']]) {
    await input.fill('@Ana'); await page.locator(`#mention-${ids[1]}`).click();
    await input.press('Backspace'); // Remove the picker-added trailing space.
    await input.press('Home'); await input.pressSequentially(opening!);
    await input.press('End'); await input.pressSequentially(closing!);
    await expect(input).toHaveValue(`${opening}@Analista${closing}`);
    await expect(page.locator('#recipient-summary')).not.toContainText('menciones pendientes');
    await submitTo(ids[1]!);
  }
  for (const removeFirst of [true, false]) {
    await input.fill('@Ana'); await page.locator(`#mention-${ids[0]}`).click();
    await input.pressSequentially('@'); await page.locator(`#mention-${ids[1]}`).click();
    await expect(input).toHaveValue('@Analista @Analista ');
    await input.evaluate((node, first) => { if (!(node instanceof HTMLTextAreaElement)) throw new Error('Expected textarea'); node.focus(); node.setSelectionRange(first ? 0 : 10, first ? 10 : 20); }, removeFirst);
    await input.press('Backspace');
    const survivor = ids[removeFirst ? 1 : 0]!, removed = ids[removeFirst ? 0 : 1]!;
    await expect(input).toHaveValue('@Analista ');
    await expect(page.getByRole('button', { name: 'Quitar mención a Analista', exact: true })).toHaveCount(1);
    await expect(page.locator('#recipient-summary')).toContainText(survivor.slice(-6));
    await expect(page.locator('#recipient-summary')).not.toContainText(removed.slice(-6));
    await submitTo(survivor);
  }
});
