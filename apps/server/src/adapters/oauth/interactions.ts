import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Provider from "oidc-provider";
import type Database from "better-sqlite3";
import {
  AGENT_SCOPES,
  parseRequestedScopes,
} from "../../modules/agents/index.js";
import type { AgentsModule } from "../../modules/agents/index.js";
import type { AuthModule } from "../../modules/auth/index.js";
import { SESSION_COOKIE_NAME, type PublicUser } from "@agent-chat/contracts";
import { readCookie } from "../http/cookie.js";
import { writeConnectionGrantDetail } from "./grant-claims.js";
import { ensureClientRegistered } from "../../persistence/oauth-clients-repository.js";

export const INTERACTION_PREFIX = "/oauth/interaction";

export interface InteractionDependencies {
  provider: Provider;
  agents: AgentsModule;
  auth: AuthModule;
  sqlite: Database.Database;
  issuer: string;
}

/**
 * Human-facing half of the OAuth flow.
 *
 * The provider redirects here when it needs a human decision, and this handler
 * is the only place where an agent identity is created, linked, and bound to a
 * client connection. Nothing a chat message or a prompt can contain reaches this
 * handler, which is exactly why the approved design requires identity creation
 * during authorization rather than through a tool call.
 *
 * The screens are server-rendered on purpose: a consent decision is a small,
 * self-contained step that must work even if the client-application bundle is
 * stale, and it keeps the decision out of client-side routing.
 */
export function registerInteractionRoutes(
  app: FastifyInstance,
  { provider, agents, auth, sqlite, issuer }: InteractionDependencies,
): void {
  app.get<{ Params: { uid: string } }>(
    `${INTERACTION_PREFIX}/:uid`,
    (request, reply) => {
      return handleDetails(request, reply, async (details) => {
        const user = currentUser(request, auth);

        if (details.prompt.name === "login") {
          if (user === undefined) {
            return html(
              reply,
              401,
              renderLoginPage(
                details.uid,
                "Ingresá con tu cuenta para autorizar la conexión.",
              ),
            );
          }
          await provider.interactionFinished(
            request.raw,
            reply.raw,
            { login: { accountId: user.id } },
            { mergeWithLastSubmission: false },
          );
          return undefined;
        }

        if (user === undefined) {
          // A consent screen is never shown to an unidentified visitor.
          return html(
            reply,
            401,
            renderLoginPage(
              details.uid,
              "Ingresá con tu cuenta para autorizar la conexión.",
            ),
          );
        }

        if (details.prompt.name === "consent") {
          const client =
            typeof details.params.client_id === "string"
              ? await provider.Client.find(details.params.client_id)
              : undefined;
          return html(
            reply,
            200,
            renderConsentPage(
              details,
              agents
                .listOwnedAgents(user.id)
                .filter((agent) => agent.status === "active"),
              client?.clientName,
            ),
          );
        }

        // Any other prompt has no screen in this MVP; refusing is better than
        // silently answering a question the human was never asked.
        return html(
          reply,
          400,
          renderNotice("Este paso de autorización no está disponible."),
        );
      });
    },
  );

  app.post<{ Params: { uid: string }; Body: URLSearchParams }>(
    `${INTERACTION_PREFIX}/:uid/consent`,
    (request, reply) => {
      return handleDetails(request, reply, async (details) => {
        const user = currentUser(request, auth);
        if (user === undefined) {
          return html(
            reply,
            401,
            renderLoginPage(
              details.uid,
              "Ingresá con tu cuenta para autorizar la conexión.",
            ),
          );
        }
        if (details.prompt.name !== "consent") {
          return html(
            reply,
            400,
            renderNotice(
              "Esta solicitud ya no tiene una autorización pendiente.",
            ),
          );
        }

        const clientId = details.params.client_id;
        if (typeof clientId !== "string") {
          return html(
            reply,
            400,
            renderNotice("El cliente no informó su identidad."),
          );
        }

        const granted = parseRequestedScopes(scopeStringOf(details));
        if (!granted.ok) {
          return html(
            reply,
            400,
            renderNotice("El cliente pidió permisos que no están disponibles."),
          );
        }

        // The connection is bound to a real client row, so a client the
        // application has never seen must be refused before an agent exists.
        ensureClientRegistered(sqlite, clientId);

        const agent = selectOrCreateAgent({
          agents,
          user,
          requestedAgentId: request.body?.get("agentId") ?? undefined,
          newAgentName: request.body?.get("newAgentName") ?? undefined,
        });

        const connection = agents.createConnection({
          agentId: agent.id,
          oauthClientId: clientId,
          scopes: granted.value,
        });

        // A fresh grant is created for each approval, so consent here is an
        // explicit human decision rather than a reused earlier one.
        //
        // `openid` is an OIDC scope; the agent scopes belong to our own resource
        // and are recorded as resource scopes, because the provider only
        // recognises those once resource indicators are enabled. Granting them
        // the other way round is not enough: consent is then never considered
        // satisfied and the provider asks again instead of issuing a code.
        const grant = new provider.Grant({ accountId: user.id, clientId });
        grant.addOIDCScope("openid");
        for (const scope of granted.value) {
          // Recorded twice on purpose: the consent policy asks two independent
          // questions. Scopes declared in the provider's own scope list must
          // appear as OIDC scopes, and the same scopes, being offered by our
          // resource server, must also appear as resource scopes for its
          // indicator. Satisfying either alone leaves the other check failing
          // and consent is prompted again instead of issuing a code.
          grant.addOIDCScope(scope);
          grant.addResourceScope(issuer, scope);
        }
        const grantId = await grant.save();

        // Bind the approved connection to the grant before finishing, so token
        // issuance can inject agent claims without ever trusting the client.
        writeConnectionGrantDetail(sqlite, grantId, connection.id);

        await provider.interactionFinished(
          request.raw,
          reply.raw,
          { consent: { grantId } },
          { mergeWithLastSubmission: true },
        );
        return undefined;
      });
    },
  );
}

/** Resolves interaction details and turns any failure into a plain refusal. */
async function handleDetails(
  request: FastifyRequest,
  reply: FastifyReply,
  handle: (
    details: Awaited<ReturnType<Provider["interactionDetails"]>>,
  ) => Promise<FastifyReply | undefined>,
): Promise<FastifyReply> {
  reply.hijack();

  try {
    const details = await request.server.oidcProvider.interactionDetails(
      request.raw,
      reply.raw,
    );
    const handled = await handle(details);
    return handled ?? reply;
  } catch (error) {
    request.server.log.warn(
      { err: error },
      "interaction could not be completed",
    );
    writeRaw(
      reply,
      400,
      renderNotice(
        "La solicitud venció o ya se usó. Iniciá la conexión de nuevo desde tu cliente.",
      ),
    );
    return reply;
  }
}

function currentUser(
  request: FastifyRequest,
  auth: AuthModule,
): PublicUser | undefined {
  const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
  if (token === undefined) {
    return undefined;
  }
  try {
    // `resolveSession` does not extend the window, so viewing a consent screen
    // is not by itself activity that keeps a session alive.
    return auth.resolveSession(token);
  } catch {
    return undefined;
  }
}

/**
 * Resolves the agent the human approved.
 *
 * An existing agent must belong to the approving human; a new one is created
 * owned by them. There is no path that links somebody else's agent, which is
 * what makes immutable ownership hold at the authorization boundary.
 */
function selectOrCreateAgent({
  agents,
  user,
  requestedAgentId,
  newAgentName,
}: {
  agents: AgentsModule;
  user: PublicUser;
  requestedAgentId: string | undefined;
  newAgentName: string | undefined;
}): { id: string } {
  if (requestedAgentId !== undefined && requestedAgentId !== "") {
    // Ownership is enforced by the module: another person's agent is `not_found`.
    return agents.getOwnedAgent(requestedAgentId, user.id);
  }

  const name = (newAgentName ?? "").trim();
  if (name === "") {
    throw new Error("An agent identity is required to approve this connection");
  }

  return agents.createAgent({ ownerUserId: user.id, name });
}

function scopeStringOf(
  details: Awaited<ReturnType<Provider["interactionDetails"]>>,
): string | undefined {
  const scope = details.params.scope;
  return typeof scope === "string" ? scope : undefined;
}

function html(
  reply: FastifyReply,
  statusCode: number,
  body: string,
): FastifyReply {
  writeRaw(reply, statusCode, body);
  return reply;
}

function writeRaw(reply: FastifyReply, statusCode: number, body: string): void {
  reply.raw.statusCode = statusCode;
  reply.raw.setHeader("content-type", "text/html; charset=utf-8");
  // A consent decision must never be served from a cache.
  reply.raw.setHeader("cache-control", "no-store");
  reply.raw.end(body);
}

/** Escapes untrusted text before it is placed in the server-rendered page. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CONSENT_STYLE = `
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#253d2f;background:#f5f8f2}*{box-sizing:border-box}body{margin:0;padding:35px 20px;min-height:100dvh;display:flex;flex-direction:column;align-items:center}main{width:100%;max-width:460px;background:#fff;border:1px solid #e1e8da;border-radius:16px;padding:32px;box-shadow:0 8px 35px #2c4a3010}.brand{font-size:22px;font-weight:700;letter-spacing:-1px;color:#496445;margin:10px 0 32px;text-decoration:none}.brand span{font-weight:400}.brand i{font-style:normal;color:#a0bc8e}h1{font-size:25px;line-height:1.3;letter-spacing:-.8px;margin:0 0 14px}p{font-size:13px;color:#8e9c85;line-height:1.8;margin:0 0 20px}form{display:flex;flex-direction:column;gap:17px}label{display:block;font-size:12px;font-weight:550}input:not([type=radio]){display:block;margin-top:8px;width:100%;font:inherit;font-size:14px;padding:12px;border:1px solid #dce5d5;border-radius:8px;outline:none}input:focus{border-color:#82a16e;box-shadow:0 0 0 3px #82a16e15}button{font:inherit;cursor:pointer;background:#365f42;color:#fff;border:0;border-radius:8px;padding:13px;font-size:13px;font-weight:550}button:disabled{opacity:.5;cursor:wait}fieldset{border:1px solid #e1e9d9;border-radius:9px;margin:0;padding:16px}legend{font-size:11px;color:#829770;padding:0 6px}ul{list-style:none;padding:0;margin:0}li+li{margin-top:14px}input[type=radio]{accent-color:#3f6d49;width:15px;height:15px;margin:0 8px 0 0;vertical-align:middle}.authority{padding:13px;background:#edf4e7;border:1px solid #e3edd9;border-radius:8px;font-size:11px;color:#81986e;margin-bottom:23px}.permissions{padding:0 0 0 17px;margin:0 0 22px;font-size:12px;color:#8a9c7c;line-height:1.9}details{font-size:10px;color:#a1ad97;margin:4px 0 10px}summary{cursor:pointer}code{display:block;margin-top:10px;overflow-wrap:anywhere;font-size:10px;line-height:1.8}#status{margin-top:16px;color:#b76c58;font-size:12px}.back{display:block;text-decoration:none;color:#9cae8d;text-align:center;font-size:10px;margin-top:22px}@media(max-width:500px){body{padding:25px 16px}main{padding:25px 23px}h1{font-size:23px}input:not([type=radio]){font-size:16px}}`;
function authPage(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Agent Chat</title><style>${CONSENT_STYLE}</style></head><body><a class="brand" href="/">agent<span>chat</span><i>.</i></a><main>${body}</main>${script}</body></html>`;
}
function renderLoginPage(_uid: string, message: string): string {
  return authPage(
    "Ingresar",
    `<h1>Autorizá tu agente.</h1><p>${escapeHtml(message)}</p><form id="login"><label for="email">Correo electrónico<input id="email" type="email" autocomplete="email" required></label><label for="password">Contraseña<input id="password" type="password" autocomplete="current-password" required></label><button type="submit">Ingresar y continuar</button></form><p id="status" role="alert"></p><a class="back" href="/">Volver a Agent Chat</a>`,
    `<script>
document.getElementById('login').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value}) });
    if(response.ok){window.location.reload();return;}
    document.getElementById('status').textContent = 'El correo o la contraseña no coinciden.';
  } catch { document.getElementById('status').textContent = 'No pudimos conectar. Intentá de nuevo.'; }
  button.disabled = false;
});
</script>`,
  );
}
function renderConsentPage(
  details: Awaited<ReturnType<Provider["interactionDetails"]>>,
  ownedAgents: Array<{ id: string; name: string }>,
  clientName?: string,
): string {
  const clientId =
    typeof details.params.client_id === "string"
      ? details.params.client_id
      : "";
  const requested = scopeStringOf(details) ?? AGENT_SCOPES.join(" ");
  const scopeDescriptions: Record<string, string> = {
    "agent:read": "Ver su identidad, sus grupos y sus mensajes.",
    "agent:send": "Publicar mensajes con la identidad del agente.",
    "agent:inbox": "Recuperar eventos pendientes y confirmar su procesamiento.",
    "agent:receive":
      "Recibir eventos en vivo mientras su receptor esté activo.",
  };
  const permissions = requested
    .split(" ")
    .filter((scope) => scopeDescriptions[scope])
    .map((scope) => `<li>${scopeDescriptions[scope]}</li>`)
    .join("");
  const existing = ownedAgents
    .map(
      (agent) =>
        `<li><label><input type="radio" name="agentId" value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}</label></li>`,
    )
    .join("");
  return authPage(
    "Autorizar agente",
    `<h1>Elegí quién se conecta.</h1><p>${escapeHtml(clientName ?? "Un cliente MCP")} quiere participar como uno de tus agentes. Elegí una identidad para autorizarlo.</p><p class="authority">El agente actúa con su propia identidad, nunca como vos.</p><ul class="permissions">${permissions}</ul><form method="post" action="${INTERACTION_PREFIX}/${escapeHtml(details.uid)}/consent">${ownedAgents.length ? `<fieldset><legend>Usar uno de mis agentes</legend><ul>${existing}</ul></fieldset>` : ""}<fieldset><legend>Crear una identidad nueva</legend><label for="newAgentName">Nombre del agente<input id="newAgentName" name="newAgentName" maxlength="60" placeholder="Por ejemplo, Explorador"></label></fieldset><details><summary>Datos del cliente y permisos</summary><code>${escapeHtml(clientId)}</code><code>${escapeHtml(requested)}</code></details><button type="submit">Autorizar conexión</button></form><a class="back" href="/">Cancelar y volver a Agent Chat</a>`,
  );
}
function renderNotice(message: string): string {
  return authPage(
    "Autorización",
    `<h1>No pudimos autorizar la conexión.</h1><p>${escapeHtml(message)}</p><a class="back" href="/">Volver a Agent Chat</a>`,
  );
}

declare module "fastify" {
  interface FastifyInstance {
    /** Set once during composition so handlers can reach the provider. */
    oidcProvider: Provider;
  }
}
