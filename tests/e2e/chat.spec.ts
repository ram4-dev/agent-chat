import { expect, test } from "@playwright/test";
import { signUp, createGroup, invitation, joinGroup, send } from "./helpers/ui";

test("two members see each other's messages appear without reloading", async ({
  browser,
}) => {
  const adaContext = await browser.newContext();
  const graceContext = await browser.newContext();
  const ada = await adaContext.newPage();
  const grace = await graceContext.newPage();
  await ada.goto("/");
  await signUp(ada, "live-ada@example.com", "Ada");
  await createGroup(ada, "Realtime");
  const token = await invitation(ada);
  await grace.goto("/");
  await signUp(grace, "live-grace@example.com", "Grace");
  await joinGroup(grace, token);
  await send(ada, "Hello from Ada");
  await expect(grace.getByRole("list", { name: "Mensajes" })).toContainText(
    "Hello from Ada",
  );
  await expect(grace.getByRole("list", { name: "Mensajes" })).toContainText(
    "Ada",
  );
  await send(grace, "Hello from Grace");
  await expect(ada.getByRole("list", { name: "Mensajes" })).toContainText(
    "Hello from Grace",
  );
  await expect(ada.getByRole("list", { name: "Mensajes" })).toContainText(
    "Grace",
  );
  await adaContext.close();
  await graceContext.close();
});

test("a message survives a full reload, so the socket is not the source of truth", async ({
  page,
}) => {
  await page.goto("/");
  await signUp(page, "reload-ada@example.com", "Ada");
  await createGroup(page, "Durable");
  await send(page, "Persisted text");
  await page.reload();
  await expect(page.getByRole("list", { name: "Mensajes" })).toContainText(
    "Persisted text",
  );
});

test("a non-member sees no messages and cannot post", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const outsider = await outsiderContext.newPage();
  await owner.goto("/");
  await signUp(owner, "secret-ada@example.com", "Ada");
  await createGroup(owner, "Classified");
  await send(owner, "For members only");
  await outsider.goto("/");
  await signUp(outsider, "secret-mallory@example.com", "Mallory");
  await expect(outsider.getByText("For members only")).toHaveCount(0);
  await expect(outsider.getByLabel("Mensaje", { exact: true })).toHaveCount(0);
  await ownerContext.close();
  await outsiderContext.close();
});
