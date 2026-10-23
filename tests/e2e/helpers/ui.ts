import { expect, type Page } from "@playwright/test";
export async function signUp(page: Page, email: string, name: string) {
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Correo electrónico").fill(email);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("a-sufficiently-long-password");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page.getByRole("main")).toHaveClass(/workspace/);
}
export async function navigation(page: Page) {
  const menu = page.getByRole("button", { name: "Abrir navegación" });
  if (await menu.isVisible()) await menu.click();
}
export async function createGroup(page: Page, name: string) {
  await navigation(page);
  await page.getByRole("button", { name: "Nuevo grupo", exact: true }).click();
  await page.getByLabel("Nombre del grupo").fill(name);
  await page.getByRole("button", { name: "Crear grupo", exact: true }).click();
  await expect(
    page.getByRole("region", { name: `Conversación de ${name}`, exact: true }),
  ).toBeVisible();
  return (await page
    .getByRole("region", { name: `Conversación de ${name}`, exact: true })
    .getAttribute("data-group-id"))!;
}
export async function selectGroup(page: Page, name: string) {
  await navigation(page);
  await page.getByRole("button", { name, exact: true }).click();
  await expect(
    page.getByRole("region", { name: `Conversación de ${name}`, exact: true }),
  ).toBeVisible();
}
export async function details(page: Page) {
  const button = page.getByRole("button", { name: "Ver miembros" });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  await expect(
    page.getByRole("complementary", { name: "Detalles del grupo" }),
  ).toBeVisible();
}
export async function invitation(page: Page) {
  await page.getByRole("button", { name: "Invitar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Invitar personas" });
  await expect(
    dialog.getByRole("textbox", { name: "Enlace de invitación", exact: true }),
  ).toBeVisible();
  const token = (await dialog.getByTestId("invitation-code").textContent())!;
  await dialog.getByRole("button", { name: "Listo", exact: true }).click();
  return token;
}
export async function joinGroup(page: Page, token: string) {
  await navigation(page);
  await page.getByRole("button", { name: "Unirme con invitación" }).click();
  await page.getByLabel("Enlace o código de invitación").fill(token);
  await page.getByRole("button", { name: "Unirme al grupo" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
export async function agents(page: Page) {
  await navigation(page);
  await page.getByRole("button", { name: "Mis agentes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mis agentes", exact: true }),
  ).toBeVisible();
}
export async function addAgent(page: Page, name: string) {
  await details(page);
  await page.getByRole("button", { name: "Agregar agente al grupo" }).click();
  await page.getByLabel("Elegir agente").selectOption({ label: name });
  await page
    .getByRole("button", { name: "Agregar al grupo", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Agentes del grupo" }),
  ).toContainText(name);
}
export async function send(page: Page, text: string) {
  await page.getByLabel("Mensaje", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("list", { name: "Mensajes" })).toContainText(
    text,
  );
}
