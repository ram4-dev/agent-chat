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
  agents,
  selectGroup,
} from "./helpers/ui";

test("owner revokes connection and agent while historical authorship survives", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  await page.goto("/");
  await signUp(page, "lifecycle-e2e@example.com", "Ada");
  const agent = await authorizeAgent(page, origin);
  await page.goto("/");
  const groupId = await createGroup(page, "Lifecycle");
  await addAgent(page, "Scout");
  const client = await mcpClient(origin, agent.token);
  const socket = await openReceiver(origin, agent.token);
  try {
    const sent = payload<{
      message: { id: string; author: { kind: string; id: string } };
    }>(
      await client.callTool({
        name: "send_message",
        arguments: {
          group_id: groupId,
          text: "Spontaneous update",
          idempotency_key: "spontaneous",
        },
      }),
    );
    expect(sent.message.author).toMatchObject({
      kind: "agent",
      id: agent.agentId,
    });
    await expect(
      page.getByRole("article", { name: "Scout (agente de Ada)", exact: true }),
    ).toContainText("Spontaneous update");
    await agents(page);
    await page.getByText("Conexiones de Scout", { exact: true }).click();
    await page
      .getByRole("button", { name: "Desconectar cliente 1 de Scout" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Desconectar cliente" });
    await expect(dialog).toContainText(
      "Los mensajes anteriores conservan el agente y su dueño.",
    );
    const closed = once(socket, "close");
    await dialog
      .getByRole("button", { name: "Desconectar cliente", exact: true })
      .click();
    expect((await closed)[0]).toBe(4401);
    await expect(
      client.callTool({ name: "get_identity", arguments: {} }),
    ).rejects.toThrow("unauthenticated");
    expect(
      (
        await page.request.post("/token", {
          form: {
            grant_type: "refresh_token",
            refresh_token: agent.refreshToken,
            client_id: agent.clientId,
          },
        })
      ).status(),
    ).toBe(400);
    await selectGroup(page, "Lifecycle");
    await expect(
      page.getByRole("article", { name: "Scout (agente de Ada)", exact: true }),
    ).toContainText("Spontaneous update");
  } finally {
    socket.terminate();
    await client.close();
  }
  const reconnected = await authorizeAgent(page, origin, agent.agentId);
  expect(reconnected.agentId).toBe(agent.agentId);
  const second = await mcpClient(origin, reconnected.token);
  const receiver = await openReceiver(origin, reconnected.token);
  try {
    await page.goto("/");
    await agents(page);
    await page
      .getByRole("button", { name: "Revocar agente", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Revocar agente" });
    const closed = once(receiver, "close");
    await dialog.getByRole("button", { name: "Revocar acceso" }).click();
    expect((await closed)[0]).toBe(4401);
    await expect(
      second.callTool({ name: "get_identity", arguments: {} }),
    ).rejects.toThrow("unauthenticated");
    await expect(
      page.getByRole("list", { name: "Agentes propios" }),
    ).toContainText("Acceso revocado");
    await selectGroup(page, "Lifecycle");
    await expect(
      page.getByRole("article", { name: "Scout (agente de Ada)", exact: true }),
    ).toContainText("Spontaneous update");
  } finally {
    receiver.terminate();
    await second.close();
  }
});
