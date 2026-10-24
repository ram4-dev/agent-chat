import { once } from "node:events";
import { expect, test } from "@playwright/test";
import {
  authorizeAgent,
  mcpClient,
  openReceiver,
  payload,
} from "./helpers/agent";
import { signUp, createGroup, addAgent, send, agents } from "./helpers/ui";

test("owner-run receiver gets a durable event live without an automatic reply", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  await page.goto("/");
  await signUp(page, "receiver-e2e@example.com", "Ada");
  const agent = await authorizeAgent(page, origin);
  await page.goto("/");
  const groupId = await createGroup(page, "Receiver");
  await addAgent(page, "Scout");
  await expect(
    page.getByRole("list", { name: "Agentes del grupo" }),
  ).toContainText("De Ada");
  await expect(
    page.getByRole("list", { name: "Agentes del grupo" }),
  ).toContainText("Sin receptor activo");
  const client = await mcpClient(origin, agent.token);
  const socket = await openReceiver(origin, agent.token);
  try {
    await expect(
      page.getByRole("list", { name: "Agentes del grupo" }),
    ).toContainText("Receptor activo");
    const live = once(socket, "message");
    await send(page, "Please review");
    const event = JSON.parse(String((await live)[0]));
    expect(event).toMatchObject({
      type: "inbox.event",
      group_id: groupId,
      message: { text: "Please review" },
    });
    const inbox = payload<{ events: { eventId: string }[] }>(
      await client.callTool({ name: "get_inbox", arguments: {} }),
    );
    expect(inbox.events.map((e) => e.eventId)).toContain(event.event_id);
    const history = payload<{ messages: unknown[] }>(
      await client.callTool({
        name: "read_messages",
        arguments: { group_id: groupId },
      }),
    );
    expect(history.messages).toHaveLength(1);
    socket.close();
    await once(socket, "close");
    await expect(
      page.getByRole("list", { name: "Agentes del grupo" }),
    ).toContainText("Sin receptor activo");
    await agents(page);
    await expect(
      page.getByText("Sin receptor activo", { exact: true }),
    ).toBeVisible();
    const reconnected = await openReceiver(origin, agent.token);
    try {
      await expect(
        page.getByText("Receptor activo", { exact: true }),
      ).toBeVisible();
      reconnected.close();
      await once(reconnected, "close");
      await expect(
        page.getByText("Sin receptor activo", { exact: true }),
      ).toBeVisible();
    } finally {
      reconnected.terminate();
    }
  } finally {
    socket.terminate();
    await client.close();
  }
});
