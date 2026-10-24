import { expect, test } from "@playwright/test";
import { createGroup, signUp } from "./helpers/ui";

test("access tabs support arrows, Home/End and a single tab stop", async ({ page }) => {
  await page.goto("/");
  const register = page.getByRole("tab", { name: "Crear cuenta" });
  const login = page.getByRole("tab", { name: "Ingresar" });
  await register.focus();
  await page.keyboard.press("ArrowRight");
  await expect(login).toBeFocused();
  await expect(login).toHaveAttribute("aria-selected", "true");
  await expect(register).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowRight");
  await expect(register).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(login).toBeFocused();
  await page.keyboard.press("Home");
  await expect(register).toBeFocused();
  await page.keyboard.press("End");
  await expect(login).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Correo electrónico")).toBeFocused();
});

test("dialogs return focus on cancel and after creating a group", async ({ page }) => {
  await page.goto("/");
  await signUp(page, "focus-dialogs@example.com", "Ada");
  const create = page.getByRole("button", { name: "Nuevo grupo", exact: true });
  await create.click();
  await page.keyboard.press("Escape");
  await expect(create).toBeFocused();
  await create.click();
  await page.getByRole("button", { name: "Cerrar ventana" }).click();
  await expect(create).toBeFocused();
  await createGroup(page, "Foco");
  await expect(create).toBeFocused();
  await page.getByRole("button", { name: "Mis agentes", exact: true }).click();
  const profile = page.getByRole("button", { name: "Crear agente", exact: true });
  await profile.click();
  await page.getByLabel("Nombre del agente").fill("Agente de foco");
  await page.getByRole("dialog").getByRole("button", { name: "Crear agente", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agente de foco", exact: true })).toBeVisible();
  // The empty-state trigger disappeared after saving. Focus needs a usable fallback.
  await expect(page.getByRole("main")).toBeFocused();
});

test("mobile drawer excludes hidden controls, traps focus, restores it and handles resize", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await signUp(page, "focus-drawer@example.com", "Sol");
  await createGroup(page, "Teclado móvil");
  const sidebar = page.locator("#workspace-navigation");
  const menu = page.getByRole("button", { name: "Abrir navegación" });
  await expect(sidebar).toHaveAttribute("inert", "");
  await page.getByLabel("Mensaje", { exact: true }).focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  }
  await menu.click();
  const close = page.getByRole("button", { name: "Cerrar navegación", exact: true });
  await expect(close).toBeFocused();
  await expect(page.locator("main.workspace")).toHaveAttribute("inert", "");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("button", { name: "Mis agentes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Abrir navegación" })).toBeFocused();
  await page.getByRole("button", { name: "Abrir navegación" }).click();
  await page.getByRole("button", { name: "Nuevo grupo", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Cerrar ventana" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Abrir navegación" })).toBeFocused();
  await page.getByRole("button", { name: "Abrir navegación" }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(page.locator("main.workspace")).not.toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Conversaciones", exact: false }).click();
  await expect(page.getByLabel("Mensaje", { exact: true })).toBeVisible();
});

test("access secondary text, inactive tabs and placeholders reach normal-text contrast", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Acceso", exact: true })).toBeVisible();
  const colors = await page.evaluate(() => {
    const hint = document.querySelector(".auth-card > .muted")!;
    const tab = document.querySelector(".segmented button:not(.selected)")!;
    const input = document.querySelector(".auth-card input")!;
    return [
      [getComputedStyle(hint).color, getComputedStyle(document.querySelector(".auth-form-side")!).backgroundColor],
      [getComputedStyle(tab).color, getComputedStyle(tab.parentElement!).backgroundColor],
      [getComputedStyle(input, "::placeholder").color, getComputedStyle(input).backgroundColor],
    ];
  });
  const luminance = (color: string) => {
    const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  for (const [foreground, background] of colors) {
    const a = luminance(foreground!);
    const b = luminance(background!);
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
