import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import {
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthTokens,
  OAuthClientInformationMixed,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import WebSocket from "ws";
import { once } from "node:events";

export async function authorizeAgent(
  page: Page,
  origin: string,
  existingAgent?: string,
  resource?: string,
  scope = "openid agent:read agent:send agent:inbox agent:receive",
) {
  let registration: OAuthClientInformationMixed | undefined;
  let tokens: OAuthTokens | undefined;
  let verifier = "";
  let authorizationUrl: URL | undefined;
  const state = randomBytes(16).toString("hex");
  const provider: OAuthClientProvider = {
    ...(resource ? { validateResourceURL: async () => new URL(resource) } : {}),
    redirectUrl: `${origin}/callback`,
    clientMetadata: {
      client_name: "Owner-run SDK MCP client",
      redirect_uris: [`${origin}/callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
    },
    state: () => state,
    clientInformation: () => registration,
    saveClientInformation: (value) => {
      registration = value;
    },
    tokens: () => tokens,
    saveTokens: (value) => {
      tokens = value;
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
    redirectToAuthorization: (url) => {
      authorizationUrl = url;
    },
  };
  expect(await auth(provider, { serverUrl: `${origin}/mcp`, scope })).toBe("REDIRECT");
  expect(authorizationUrl).toBeDefined();
  await page.goto(authorizationUrl!.href);
  await expect(
    page.getByText("El agente actúa con su propia identidad, nunca como vos."),
  ).toBeVisible();
  if (existingAgent)
    await page
      .locator(`input[name="agentId"][value="${existingAgent}"]`)
      .check();
  else
    await page.getByLabel("Nombre del agente", { exact: true }).fill("Scout");
  await page.screenshot({
    path: `.local-state/s9-consent-${existingAgent ? "reuse" : "new"}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Autorizar conexión", exact: true })
    .click();
  await page.waitForURL(
    (url) => url.pathname === "/callback" && url.searchParams.has("code"),
  );
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(state);
  expect(
    await auth(provider, {
      serverUrl: `${origin}/mcp`,
      authorizationCode: callback.searchParams.get("code")!,
      scope,
    }),
  ).toBe("AUTHORIZED");
  if (!tokens || !registration)
    throw new Error("SDK did not persist OAuth credentials");
  const clientId = registration.client_id;
  const claims = JSON.parse(
    Buffer.from(tokens.access_token.split(".")[1]!, "base64url").toString(),
  ) as { agent_id: string; connection_id: string };
  return {
    token: tokens.access_token,
    refreshToken: tokens.refresh_token!,
    clientId,
    agentId: claims.agent_id,
    connectionId: claims.connection_id,
  };
}

export async function mcpClient(origin: string, token: string) {
  const client = new Client({ name: "owner-runtime", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

export function payload<T>(result: unknown): T {
  const value = result as { content: { text: string }[]; isError?: boolean };
  expect(value.isError).toBeUndefined();
  return JSON.parse(value.content[0]!.text) as T;
}

export async function openReceiver(origin: string, token: string) {
  const socket = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/agent`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const [ready] = await once(socket, "message");
  expect(JSON.parse(String(ready)).type).toBe("receiver.ready");
  return socket;
}
