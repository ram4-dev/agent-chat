import { once } from "node:events";
import { expect, test } from "@playwright/test";
import {
  authorizeAgent,
  mcpClient,
  openReceiver,
  payload,
} from "./helpers/agent";
import {
  signUp,
  createGroup,
  addAgent,
  send,
  agents,
  details,
} from "./helpers/ui";

test("AC12: browser, SDK OAuth, MCP, live delivery, offline recovery and revocation", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  expect(
    (await page.request.get("/.well-known/oauth-protected-resource")).status(),
  ).toBe(200);
  await page.goto("/");
  await signUp(page, "full-loop@example.com", "Ada");
  await page.setViewportSize({ width: 390, height: 844 });
  const agent = await authorizeAgent(page, origin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const groupId = await createGroup(page, "Full loop");
  await addAgent(page, "Scout");
  await expect(
    page.getByRole("list", { name: "Agentes del grupo" }),
  ).toContainText("De Ada");
  let client = await mcpClient(origin, agent.token);
  let receiver = await openReceiver(origin, agent.token);
  try {
    const spontaneous = {
      group_id: groupId,
      text: "Ya revisé las notas del proyecto. Podemos empezar por el flujo de invitaciones.",
      idempotency_key: "runtime-first",
    };
    const first = payload<{ message: { id: string } }>(
      await client.callTool({ name: "send_message", arguments: spontaneous }),
    );
    const retry = payload<{ message: { id: string }; replayed: boolean }>(
      await client.callTool({ name: "send_message", arguments: spontaneous }),
    );
    expect(retry).toMatchObject({
      replayed: true,
      message: { id: first.message.id },
    });
    const live = once(receiver, "message");
    await send(
      page,
      "Perfecto, Scout. Revisemos los permisos antes de compartirlo con el equipo.",
    );
    const event = JSON.parse(String((await live)[0]));
    expect(event).toMatchObject({ type: "inbox.event", group_id: groupId });
    payload(
      await client.callTool({
        name: "ack_inbox",
        arguments: { event_id: event.event_id },
      }),
    );
    await page.screenshot({
      path: ".local-state/ui-chat-desktop.png",
      fullPage: true,
    });
    receiver.close();
    await once(receiver, "close");
    await client.close();
    await expect(
      page.getByRole("list", { name: "Agentes del grupo" }),
    ).toContainText("Sin receptor activo");
    await send(page, "Published while runtime is stopped");
    const reauthorized = await authorizeAgent(page, origin, agent.agentId);
    expect(reauthorized.agentId).toBe(agent.agentId);
    client = await mcpClient(origin, reauthorized.token);
    receiver = await openReceiver(origin, reauthorized.token);
    const readInbox = async () =>
      payload<{ events: { eventId: string; message: { text: string } }[] }>(
        await client.callTool({ name: "get_inbox", arguments: {} }),
      );
    const pending = await readInbox();
    expect(pending.events.map((e) => e.message.text)).toEqual([
      "Published while runtime is stopped",
    ]);
    expect(
      payload<{ messages: unknown[] }>(
        await client.callTool({
          name: "read_messages",
          arguments: { group_id: groupId },
        }),
      ).messages,
    ).toHaveLength(3);
    expect((await readInbox()).events).toHaveLength(1);
    for (let i = 0; i < 2; i++)
      payload(
        await client.callTool({
          name: "ack_inbox",
          arguments: { event_id: pending.events[0]!.eventId },
        }),
      );
    expect((await readInbox()).events).toEqual([]);
    await client.callTool({
      name: "send_message",
      arguments: {
        group_id: groupId,
        text: "Reviewed by the external runtime",
        idempotency_key: "reply-once",
      },
    });
    await page.goto("/");
    await expect(page.getByRole("list", { name: "Mensajes" })).toContainText(
      "Reviewed by the external runtime",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: ".local-state/ui-chat-mobile.png",
      fullPage: true,
    });
    await details(page);
    await expect(
      page.getByRole("list", { name: "Agentes del grupo" }),
    ).toContainText("Receptor activo");
    await page
      .getByRole("complementary", { name: "Detalles del grupo" })
      .getByRole("button", { name: "Cerrar detalles" })
      .click();
    await agents(page);
    await expect(
      page
        .getByRole("list", { name: "Agentes propios" })
        .getByRole("heading", { name: "Scout", exact: true }),
    ).toHaveCount(1);
    await page.screenshot({
      path: ".local-state/ui-agents-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Revocar agente", exact: true })
      .click();
    const closed = once(receiver, "close");
    await page
      .getByRole("dialog", { name: "Revocar agente" })
      .getByRole("button", { name: "Revocar acceso" })
      .click();
    expect((await closed)[0]).toBe(4401);
    await expect(
      client.callTool({
        name: "read_messages",
        arguments: { group_id: groupId },
      }),
    ).rejects.toThrow("unauthenticated");
    await expect(mcpClient(origin, agent.token)).rejects.toThrow(
      "unauthenticated",
    );
  } finally {
    receiver.terminate();
    await client.close();
  }
});
