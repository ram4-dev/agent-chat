import { expect, test } from "@playwright/test";

/**
 * Real-route check for S1: the production entrypoint boots against a temporary
 * database, applies migrations before accepting traffic, and serves the built
 * web client and the liveness endpoint from one origin.
 *
 * Values are written literally on purpose: this spec verifies the shipped
 * artifact, not the shared contract module.
 */
test("serves the built web client and the liveness endpoint from one origin", async ({
  request,
}) => {
  const liveness = await request.get("/liveness");
  expect(liveness.status()).toBe(200);
  expect(await liveness.json()).toEqual({ status: "ok", database: "ok" });

  const shell = await request.get("/");
  expect(shell.status()).toBe(200);
  expect(shell.headers()["content-type"]).toContain("text/html");

  const html = await shell.text();
  expect(html).toContain('<div id="root"></div>');

  const scriptPath = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(scriptPath).toBeTruthy();

  const script = await request.get(scriptPath as string);
  expect(script.status()).toBe(200);
  expect(script.headers()["content-type"]).toContain("text/javascript");
});

test("renders the shell and reports the live server status in a real browser", async ({
  page,
  request,
}) => {
  const staticHtml = await (await request.get("/")).text();
  expect(staticHtml).not.toContain("Server: ok");

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Hacé lugar a tu equipo." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Crear cuenta", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Server: ok (database: ok)")).toHaveCount(0);
});

test("answers an unknown path with the stable not_found envelope", async ({
  request,
}) => {
  const response = await request.get("/assets/does-not-exist.js");

  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: { code: "not_found" } });
});
