import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authorizeAgent, mcpClient, payload } from './helpers/agent';
import { signUp, createGroup, addAgent, selectGroup, send } from './helpers/ui';
import type { NativeGrant } from '@agent-chat/contracts';

test('owner pairs separate interactive and automatic OAuth connections; browser sees explicit identity without consuming inbox', async ({ page, baseURL }) => {
  const origin = baseURL!;
  await page.goto('/');
  await signUp(page, 'native-pairing-e2e@example.com', 'Native owner');
  const interactiveConnection = await authorizeAgent(page, origin);
  const automaticConnection = await authorizeAgent(page, origin, interactiveConnection.agentId);
  expect(automaticConnection.connectionId).not.toBe(interactiveConnection.connectionId);
  await page.goto('/');
  const a = await createGroup(page, 'Native A'); await addAgent(page, 'Scout');
  const b = await createGroup(page, 'Native B'); await addAgent(page, 'Scout');
  await selectGroup(page, 'Native A');
  await send(page, 'Mensaje pendiente para el agente nativo');
  await page.screenshot({ path: '.local-state/native-access-01-pending.png', fullPage: true });
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers: { origin }, data });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const { target } = await post('/api/native/targets', { provider: 'hermes', connectorId: 'e2e-local', nativeRef: 'e2e-profile', contextMode: 'native_per_group' });
  const { binding } = await post('/api/native/bindings', { agentId: interactiveConnection.agentId, targetId: target.id, groupIds: [a, b] });
  expect(binding.enabled).toBe(false);
  const interactive = await mcpClient(origin, interactiveConnection.token);
  const automatic = await mcpClient(origin, automaticConnection.token);
  try {
    const { events } = payload<{ events: { eventId: string }[] }>(await automatic.callTool({ name: 'get_inbox', arguments: {} }));
    expect(events.length).toBeGreaterThan(0);
    expect((await automatic.callTool({ name: 'ack_inbox', arguments: { event_id: events[0]!.eventId } })).isError).toBe(true);
    const interactiveChallenge = await post('/api/native/pairings', { kind: 'interactive', connectionId: interactiveConnection.connectionId, scopes: ['native:read', 'native:send'], selections: [{ agentId: interactiveConnection.agentId, groupIds: [a] }] });
    const { grant } = payload<{ grant: NativeGrant }>(await interactive.callTool({ name: 'pair_native', arguments: { challenge: interactiveChallenge.challenge } }));
    expect((await interactive.callTool({ name: 'send_message', arguments: { group_id: a, text: 'Sin identidad', idempotency_key: randomUUID() } })).isError).toBe(true);
    expect((await interactive.callTool({ name: 'send_message', arguments: { as_agent_id: interactiveConnection.agentId, group_id: b, text: 'Grupo ajeno al grant', idempotency_key: randomUUID() } })).isError).toBe(true);
    payload(await interactive.callTool({ name: 'send_message', arguments: { as_agent_id: interactiveConnection.agentId, group_id: a, text: 'Respuesta interactiva con identidad explícita', idempotency_key: 'native-e2e-interactive' } }));
    await expect(page.getByRole('list', { name: 'Mensajes' })).toContainText('Respuesta interactiva con identidad explícita');
    await page.screenshot({ path: '.local-state/native-access-02-explicit-identity.png', fullPage: true });
    const remaining = payload<{ events: { eventId: string }[] }>(await automatic.callTool({ name: 'get_inbox', arguments: {} }));
    expect(remaining.events.map(e => e.eventId)).toContain(events[0]!.eventId);
    const automaticChallenge = await post('/api/native/pairings', { kind: 'automatic', connectionId: automaticConnection.connectionId, bindingId: binding.id, revision: binding.revision, targetId: target.id, scopes: ['native:read', 'native:claim', 'native:start', 'native:complete'] });
    const paired = payload<{ grant: NativeGrant }>(await automatic.callTool({ name: 'pair_native', arguments: { challenge: automaticChallenge.challenge, binding_id: binding.id, revision: binding.revision, target_id: target.id } }));
    expect(paired.grant.kind).toBe('automatic');
    const tools = await automatic.listTools();
    expect(tools.tools.map(t => t.name)).not.toContain('ack_inbox');
    expect((await automatic.callTool({ name: 'send_message', arguments: { as_agent_id: interactiveConnection.agentId, group_id: a, text: 'Envío automático fuera de delivery', idempotency_key: randomUUID() } })).isError).toBe(true);
    payload(await automatic.callTool({ name: 'read_messages', arguments: { as_agent_id: interactiveConnection.agentId, group_id: a } }));
    const revoked = await page.request.delete(`/api/native/grants/${grant.id}`, { headers: { origin } });
    expect(revoked.ok()).toBe(true);
    expect((await interactive.callTool({ name: 'read_messages', arguments: { as_agent_id: interactiveConnection.agentId, group_id: a } })).isError).toBe(true);
    await expect(page.getByRole('list', { name: 'Mensajes' })).toContainText('Respuesta interactiva con identidad explícita');
    await page.screenshot({ path: '.local-state/native-access-03-revoked.png', fullPage: true });
  } finally { await interactive.close(); await automatic.close(); }
});
