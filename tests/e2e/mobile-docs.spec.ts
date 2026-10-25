import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createGroup, signUp } from "./helpers/ui";

test.use({ hasTouch: true });

async function fits(page: Page) {
  const size = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(
    size.content,
    `Content must fit the ${size.viewport}px viewport`,
  ).toBeLessThanOrEqual(size.viewport);
}

async function clipboard(page: Page, fail = false) {
  await page.evaluate((reject) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (reject) throw new Error("Clipboard denied by test");
          document.body.dataset["copied"] = text;
        },
      },
    });
  }, fail);
}

test("canonical docs have local styling, task links and keyboard copy feedback at every width", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const resources: string[] = [];
  page.on("request", (request) => resources.push(request.url()));
  await page.goto("/docs");
  await expect(
    page.getByRole("heading", {
      name: "Configurar un agente por API",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Guías por tarea" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".docs-header")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(23, 46, 37)");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
    await page.screenshot({
      path: `.local-state/mobile-docs/docs-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "Guías por tarea" })
    .getByRole("link", { name: "Configuración sin interfaz", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Configuración sin interfaz",
      exact: true,
    }),
  ).toBeInViewport();
  const copy = page.getByRole("button", {
    name: "Copiar ejemplo 1",
    exact: true,
  });
  const code = page.locator("#example-1");
  await clipboard(page);
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Ejemplo copiado.");
  await expect(copy).toHaveText("Copiado");
  expect(await page.locator("body").getAttribute("data-copied")).toBe(
    await code.textContent(),
  );
  await expect(copy).toBeFocused();
  await clipboard(page, true);
  await copy.click();
  await expect(page.getByRole("status")).toContainText("No pudimos copiar.");
  await expect(code).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    await code.textContent(),
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local-state/mobile-docs/docs-text-200.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(
    resources.every(
      (url) => new URL(url).origin === new URL(page.url()).origin,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Volver a la app", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Acceso", exact: true }),
  ).toBeVisible();
});

test("docs remain complete and task navigation works without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/docs");
    await expect(
      page.getByRole("heading", {
        name: "Confirmar el correo e ingresar",
        exact: true,
      }),
    ).toBeAttached();
    await expect(
      page.getByRole("button", { name: /Copiar ejemplo/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Guía en Markdown", exact: true }),
    ).toHaveAttribute("href", "/docs/agent-api.md");
    await fits(page);
  } finally {
    await context.close();
  }
});

test("mobile chat retains readable copy and touch actions through text enlargement and a short viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await signUp(
    page,
    `mobile-docs-${randomUUID()}@example.com`,
    "Lectura móvil",
  );
  await createGroup(page, "Planificación del equipo con un nombre largo");
  const message = page.getByLabel("Mensaje", { exact: true });
  const send = page.getByRole("button", {
    name: "Enviar mensaje",
    exact: true,
  });
  await message.fill("Mensaje de prueba para comprobar la lectura y el envío.");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
    const sizes = await page.evaluate(() => ({
      input: parseFloat(
        getComputedStyle(document.querySelector(".composer textarea")!)
          .fontSize,
      ),
      footer: parseFloat(
        getComputedStyle(document.querySelector(".composer-footer")!).fontSize,
      ),
      metadata: parseFloat(
        getComputedStyle(
          document.querySelector(".conversation-title > div > span")!,
        ).fontSize,
      ),
      privacy: parseFloat(
        getComputedStyle(document.querySelector(".composer-tools > span")!)
          .fontSize,
      ),
    }));
    expect(sizes.input).toBeGreaterThanOrEqual(16);
    expect(sizes.footer).toBeGreaterThanOrEqual(12);
    expect(sizes.metadata).toBeGreaterThanOrEqual(12);
    expect(sizes.privacy).toBeGreaterThanOrEqual(12);
    for (const action of [
      send,
      page.getByRole("button", { name: "Ver miembros", exact: true }),
      page.getByRole("button", { name: "Invitar", exact: true }),
    ]) {
      const box = (await action.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `.local-state/mobile-docs/chat-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(page);
    await expect(message).toBeInViewport();
    await expect(send).toBeInViewport();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local-state/mobile-docs/chat-text-200.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  // 320 CSS px also exercises reflow at a narrow zoom-equivalent layout width.
  await page.setViewportSize({ width: 320, height: 700 });
  await fits(page);
  await expect(send).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 420 });
  await message.focus();
  await expect(send).toBeInViewport();
  await expect(message).toBeInViewport();
  await fits(page);
  await page.screenshot({
    path: ".local-state/mobile-docs/chat-short-viewport.png",
    fullPage: true,
  });
  await send.tap();
  await expect(page.getByRole("list", { name: "Mensajes" })).toContainText(
    "Mensaje de prueba para comprobar la lectura y el envío.",
  );
  await expect(message).toHaveValue("");
});

test("shared copy feedback, Escape and focus restoration survive mobile dialog styling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await signUp(page, `mobile-copy-${randomUUID()}@example.com`, "Copiar");
  await createGroup(page, "Invitaciones");
  const trigger = page.getByRole("button", { name: "Invitar", exact: true });
  await trigger.tap();
  const dialog = page.getByRole("dialog", { name: "Invitar personas" });
  const copy = dialog.getByRole("button", {
    name: "Copiar enlace de invitación",
    exact: true,
  });
  await clipboard(page);
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Copiado.");
  expect(await page.locator("body").getAttribute("data-copied")).toBe(
    await dialog
      .getByLabel("Enlace de invitación", { exact: true })
      .inputValue(),
  );
  await clipboard(page, true);
  await copy.click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Seleccioná y copiá el texto del campo.",
  );
  await fits(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("mobile supporting copy meets normal text contrast on its actual background", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await signUp(
    page,
    `mobile-contrast-${randomUUID()}@example.com`,
    "Contraste",
  );
  await createGroup(page, "Texto legible");
  const pairs = await page.evaluate(() =>
    [
      ".composer-footer",
      ".composer-tools > span",
      ".conversation-title > div > span",
      ".private-note p",
      ".private-note span",
      ".sidebar-hint",
    ].flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      let parent: Element | null = element;
      while (
        parent &&
        getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)"
      )
        parent = parent.parentElement;
      return [
        [
          getComputedStyle(element).color,
          getComputedStyle(parent!).backgroundColor,
        ],
      ];
    }),
  );
  const luminance = (color: string) => {
    const rgb = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  expect(pairs.length).toBeGreaterThanOrEqual(5);
  for (const [foreground, background] of pairs) {
    const a = luminance(foreground!);
    const b = luminance(background!);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  }
});
