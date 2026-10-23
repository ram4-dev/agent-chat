import { expect, test } from "@playwright/test";

test("a new account can create a conversation immediately and agents have a separate view", async ({
  page,
}) => {
  await page.goto("/");
  await page.screenshot({ path: ".local-state/ui-auth.png", fullPage: true });
  await page.getByLabel("Nombre").fill("Sofía");
  await page.getByLabel("Correo electrónico").fill("ui-sofia@example.com");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("a-sufficiently-long-password");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Empezá una conversación" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Crear un grupo", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Crear grupo" });
  await modal.getByLabel("Nombre del grupo").fill("Diseño de producto");
  await modal.getByRole("button", { name: "Crear grupo", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Conversación de Diseño de producto" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Mensaje", { exact: true })).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Mensaje", { exact: true }).fill("Hola equipo");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();
    await expect(
      page
        .getByRole("list", { name: "Mensajes" })
        .getByText("Hola equipo", { exact: true }),
    ).toHaveCount(i + 1);
  }
  await page.getByRole("button", { name: "Mis agentes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mis agentes", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Mensaje", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Crear agente", exact: true }).click();
  const agentModal = page.getByRole("dialog", { name: "Crear agente" });
  await agentModal.getByLabel("Nombre del agente").fill("Explorador");
  await agentModal
    .getByRole("button", { name: "Crear agente", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Explorador", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Diseño de producto", exact: true })
    .click();
  await expect(
    page
      .getByRole("list", { name: "Mensajes" })
      .getByText("Hola equipo", { exact: true }),
  ).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Diseño de producto", exact: true }),
  ).toBeVisible();
});

test("mobile navigation, dialogs, and errors keep the active conversation usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Luz");
  await page.getByLabel("Correo electrónico").fill("ui-mobile@example.com");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("a-sufficiently-long-password");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await page
    .getByRole("button", { name: "Crear un grupo", exact: true })
    .click();
  await page.getByLabel("Nombre del grupo").fill("Móvil");
  await page.getByRole("button", { name: "Crear grupo", exact: true }).click();
  await expect(page.getByLabel("Mensaje", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Ver miembros" }).click();
  await expect(
    page.getByRole("complementary", { name: "Detalles del grupo" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar detalles" }).click();
  await page.getByRole("button", { name: "Abrir navegación" }).click();
  await page.getByRole("button", { name: "Unirme con invitación" }).click();
  const join = page.getByRole("dialog", { name: "Unirme a un grupo" });
  await join
    .getByLabel("Enlace o código de invitación")
    .fill("not-a-real-invitation");
  await join.getByRole("button", { name: "Unirme al grupo" }).click();
  await expect(join.getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Mensaje", { exact: true })).toBeVisible();
  await page.route("**/api/groups/*/messages", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          json: { error: { code: "temporarily_unavailable" } },
        })
      : route.continue(),
  );
  await page
    .getByLabel("Mensaje", { exact: true })
    .fill("No pierdas este borrador");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("alert")).toContainText("No pudimos enviar");
  await expect(page.getByLabel("Mensaje", { exact: true })).toHaveValue(
    "No pierdas este borrador",
  );
});

test("an invitation link survives signup and joins the intended group", async ({
  browser,
  baseURL,
}) => {
  const owner = await browser.newContext();
  const guest = await browser.newContext();
  const a = await owner.newPage();
  const b = await guest.newPage();
  await a.goto("/");
  const { signUp, createGroup } = await import("./helpers/ui");
  await signUp(a, "ui-invite-owner@example.com", "Ada");
  await createGroup(a, "Compartido");
  await a.getByRole("button", { name: "Invitar", exact: true }).click();
  const link = await a
    .getByRole("textbox", { name: "Enlace de invitación", exact: true })
    .inputValue();
  expect(new URL(link).origin).toBe(baseURL);
  await b.goto(link);
  await signUp(b, "ui-invite-guest@example.com", "Sol");
  const join = b.getByRole("dialog", { name: "Unirme a un grupo" });
  await expect(
    join.getByLabel("Enlace o código de invitación"),
  ).not.toHaveValue("");
  await join.getByRole("button", { name: "Unirme al grupo" }).click();
  await expect(
    b.getByRole("region", { name: "Conversación de Compartido" }),
  ).toBeVisible();
  await expect(
    b.getByRole("button", { name: "Invitar", exact: true }),
  ).toHaveCount(0);
  await owner.close();
  await guest.close();
});

test("chat pages older history and profile editing reports saved changes", async ({
  page,
}) => {
  const { signUp, createGroup, agents, send } = await import("./helpers/ui");
  await page.goto("/");
  await signUp(page, "ui-history@example.com", "Ada");
  const id = await createGroup(page, "Archivo");
  const origin = new URL(page.url()).origin;
  for (let i = 1; i <= 53; i++)
    expect(
      (
        await page.request.post(`/api/groups/${id}/messages`, {
          headers: { origin },
          data: {
            text: `Mensaje de archivo ${i}`,
            idempotencyKey: `history-${i}`,
          },
        })
      ).status(),
    ).toBe(201);
  await page.reload();
  const list = page.getByRole("list", { name: "Mensajes" });
  await expect(list.locator("[data-message-id]")).toHaveCount(50);
  await page.getByRole("button", { name: "Ver mensajes anteriores" }).click();
  await expect(list.locator("[data-message-id]")).toHaveCount(53);
  await expect(list.locator("[data-message-id]").first()).toContainText(
    "Mensaje de archivo 1",
  );
  await send(page, "Una nueva entrada del archivo");
  await expect(list.locator("[data-message-id]")).toHaveCount(54);
  await expect(list.locator("[data-message-id]").first()).toContainText(
    "Mensaje de archivo 1",
  );
  await agents(page);
  await page.getByRole("button", { name: "Crear agente", exact: true }).click();
  await page.getByLabel("Nombre del agente").fill("Scout");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Crear agente", exact: true })
    .click();
  await page.getByRole("button", { name: "Editar Scout" }).click();
  await page.getByLabel("Nombre del agente").fill("Explorador");
  await page
    .getByLabel("Descripción")
    .fill("Revisa decisiones y propone próximos pasos.");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("heading", { name: "Explorador", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Revisa decisiones y propone próximos pasos.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local-state/ui-agents-desktop.png",
    fullPage: true,
  });
});
