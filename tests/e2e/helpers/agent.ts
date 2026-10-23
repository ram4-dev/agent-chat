import { createHash, randomBytes } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';
import { once } from 'node:events';

export async function authorizeAgent(page: Page, origin: string, existingAgent?: string) {
  const redirectUri = `${origin}/callback`;
  const registered = await page.request.post(`${origin}/reg`, { data: {
    client_name: 'Owner-run receiver', redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  } });
  expect(registered.status()).toBe(201);
  const clientId = (await registered.json()).client_id as string;
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('hex');
  await page.goto(`${origin}/auth?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid agent:read agent:send agent:inbox agent:receive',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', state,
  })}`);
  await expect(page.getByText('The agent acts as itself.')).toBeVisible();
  if (existingAgent) await page.locator(`input[name="agentId"][value="${existingAgent}"]`).check();
  else await page.getByLabel('Agent name', { exact: true }).fill('Scout');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/callback' && url.searchParams.has('code'));
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe(state);
  const exchanged = await page.request.post(`${origin}/token`, { form: {
    grant_type: 'authorization_code', code: callback.searchParams.get('code')!,
    redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier,
  } });
  expect(exchanged.status()).toBe(200);
  const tokens = await exchanged.json() as { access_token: string; refresh_token: string };
  const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1]!, 'base64url').toString()) as { agent_id: string; connection_id: string };
  return { token: tokens.access_token, refreshToken: tokens.refresh_token, clientId, agentId: claims.agent_id, connectionId: claims.connection_id };
}

export async function mcpClient(origin: string, token: string) {
  const client = new Client({ name: 'owner-runtime', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  return client;
}

export function payload<T>(result: unknown): T {
  const value = result as { content: { text: string }[]; isError?: boolean };
  expect(value.isError).toBeUndefined();
  return JSON.parse(value.content[0]!.text) as T;
}

export async function openReceiver(origin: string, token: string) {
  const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/ws/agent`, { headers: { authorization: `Bearer ${token}` } });
  const [ready] = await once(socket, 'message');
  expect(JSON.parse(String(ready)).type).toBe('receiver.ready');
  return socket;
}
