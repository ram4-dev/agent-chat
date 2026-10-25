import { expect, test } from "@playwright/test";
import {
  expectNamedControls,
  expectVisibleKeyboardFocus,
} from "./helpers/accessibility";
import { createGroup, details, signUp } from "./helpers/ui";

test("access screens expose labeled inputs, selected tabs, panels and keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("main")).toHaveCount(1);
  const access = page.getByRole("region", { name: "Acceso", exact: true });
  await expectNamedControls(access);
  const register = access.getByRole("tab", {
    name: "Crear cuenta",
    exact: true,
  });
  const login = access.getByRole("tab", { name: "Ingresar", exact: true });
  await expect(register).toHaveAttribute("aria-selected", "true");
  await expect(login).toHaveAttribute("aria-selected", "false");
  const panel = access.getByRole("tabpanel", {
    name: "Crear cuenta",
    exact: true,
  });
  await expect(panel).toHaveAttribute(
    "id",
    (await register.getAttribute("aria-controls"))!,
  );
  await expectVisibleKeyboardFocus(page, register);
  await login.click();
  await expect(login).toHaveAttribute("aria-selected", "true");
  await expect(register).toHaveAttribute("aria-selected", "false");
  await expect(
    access.getByRole("tabpanel", { name: "Ingresar", exact: true }),
  ).toBeVisible();
  await expectNamedControls(access);
  await expectVisibleKeyboardFocus(
    page,
    access.getByLabel("Correo electrónico"),
  );
  await access
    .getByLabel("Correo electrónico")
    .fill("a11y-unknown@example.com");
  await access
    .getByLabel("Contraseña", { exact: true })
    .fill("incorrect-password-for-qa");
  await access.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(access.getByRole("alert")).toContainText(/\S/);
});

test("conversations, details and invitation dialogs retain accessible roles and keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  await signUp(page, "a11y-chat@example.com", "Ada");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "Espacio de trabajo" }),
  ).toBeVisible();
  await expectNamedControls(page);
  await page.getByRole("button", { name: "Nuevo grupo", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Crear grupo", exact: true });
  await expect(create).toHaveAttribute("aria-modal", "true");
  await expect(
    create.getByRole("button", { name: "Cerrar ventana" }),
  ).toBeFocused();
  await expectNamedControls(create);
  await expectVisibleKeyboardFocus(page, create.getByLabel("Nombre del grupo"));
  await create.getByLabel("Nombre del grupo").fill("Accesible");
  await create
    .getByRole("button", { name: "Crear grupo", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Conversación de Accesible" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Mensajes", exact: true }),
  ).toHaveCount(1);
  await expectNamedControls(page);
  await page.getByLabel("Mensaje", { exact: true }).fill("Borrador accesible");
  await expectVisibleKeyboardFocus(
    page,
    page.getByLabel("Mensaje", { exact: true }),
    page.locator(".composer"),
  );
  await details(page);
  const members = page.getByRole("complementary", {
    name: "Detalles del grupo",
  });
  await expect(members).toHaveAttribute(
    "id",
    (await page
      .getByRole("button", { name: "Ver miembros" })
      .getAttribute("aria-controls"))!,
  );
  await expectNamedControls(members);
  await page.getByRole("button", { name: "Cerrar detalles" }).click();
  const invite = page.getByRole("button", { name: "Invitar", exact: true });
  await invite.click();
  const invitation = page.getByRole("dialog", {
    name: "Invitar personas",
    exact: true,
  });
  await expect(invitation).toHaveAttribute("aria-modal", "true");
  await expectNamedControls(invitation);
  await expectVisibleKeyboardFocus(
    page,
    invitation.getByRole("textbox", {
      name: "Enlace de invitación",
      exact: true,
    }),
    invitation.locator(".copy-field"),
  );
  await page.keyboard.press("Escape");
  await expect(invitation).toHaveCount(0);
  await expect(invite).toBeFocused();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(
    page.getByRole("region", { name: "Acceso", exact: true }),
  ).toBeVisible();
});

test("mobile agent screens and profile dialogs name their controls and show keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await signUp(page, "a11y-agents@example.com", "Sol");
  await createGroup(page, "Equipo accesible");
  const menu = page.getByRole("button", { name: "Abrir navegación", includeHidden: true });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const navigation = page.getByRole("complementary", {
    name: "Navegación principal",
  });
  await expect(navigation).toHaveAttribute(
    "id",
    (await menu.getAttribute("aria-controls"))!,
  );
  await expectNamedControls(navigation);
  await page.getByRole("button", { name: "Mis agentes", exact: true }).click();
  const view = page.getByRole("region", { name: "Mis agentes", exact: true });
  await expectNamedControls(view);
  await expectVisibleKeyboardFocus(
    page,
    view.getByRole("button", { name: "Crear identidad", exact: true }),
  );
  await view.getByRole("button", { name: "Crear identidad", exact: true }).click();
  const profile = page.getByRole("dialog", {
    name: "Crear agente",
    exact: true,
  });
  await expect(profile).toHaveAttribute("aria-modal", "true");
  await expectNamedControls(profile);
  await expectVisibleKeyboardFocus(
    page,
    profile.getByLabel("Nombre del agente"),
  );
  await profile.getByText("Imagen de perfil", { exact: true }).click();
  await expectNamedControls(profile);
  await profile.getByLabel("Nombre del agente").fill("Scout accesible");
  await profile
    .getByRole("button", { name: "Crear agente", exact: true })
    .click();
  await expect(
    view.getByRole("heading", { name: "Scout accesible", exact: true }),
  ).toBeVisible();
  await expectNamedControls(view);
  await view
    .getByRole("button", { name: "Conectar un agente", exact: true })
    .click();
  const connect = page.getByRole("dialog", {
    name: "Conectar un agente",
    exact: true,
  });
  await expectNamedControls(connect);
  await expectVisibleKeyboardFocus(
    page,
    connect.getByRole("button", { name: "Copiar dirección mcp", exact: true }),
  );
  await page.keyboard.press("Escape");
  await expect(connect).toHaveCount(0);
});
