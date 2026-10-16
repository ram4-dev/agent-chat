import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Provider from 'oidc-provider';
import type Database from 'better-sqlite3';
import { AGENT_SCOPES, parseRequestedScopes } from '../../modules/agents/index.js';
import type { AgentsModule } from '../../modules/agents/index.js';
import type { AuthModule } from '../../modules/auth/index.js';
import { SESSION_COOKIE_NAME, type PublicUser } from '@agent-chat/contracts';
import { readCookie } from '../http/cookie.js';
import { writeConnectionGrantDetail } from './grant-claims.js';
import { ensureClientRegistered } from '../../persistence/oauth-clients-repository.js';

export const INTERACTION_PREFIX = '/oauth/interaction';

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
  app.get<{ Params: { uid: string } }>(`${INTERACTION_PREFIX}/:uid`, (request, reply) => {
    return handleDetails(request, reply, async (details) => {
      const user = currentUser(request, auth);

      if (details.prompt.name === 'login') {
        if (user === undefined) {
          return html(reply, 401, renderLoginPage(details.uid, 'Sign in to continue'));
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
        return html(reply, 401, renderLoginPage(details.uid, 'Sign in to continue'));
      }

      if (details.prompt.name === 'consent') {
        return html(reply, 200, renderConsentPage(details, agents.listOwnedAgents(user.id)));
      }

      // Any other prompt has no screen in this MVP; refusing is better than
      // silently answering a question the human was never asked.
      return html(reply, 400, renderNotice('This authorization step is not supported.'));
    });
  });

  app.post<{ Params: { uid: string }; Body: URLSearchParams }>(
    `${INTERACTION_PREFIX}/:uid/consent`,
    (request, reply) => {
      return handleDetails(request, reply, async (details) => {
        const user = currentUser(request, auth);
        if (user === undefined) {
          return html(reply, 401, renderLoginPage(details.uid, 'Sign in to continue'));
        }
        if (details.prompt.name !== 'consent') {
          return html(reply, 400, renderNotice('Nothing to approve here.'));
        }

        const clientId = details.params.client_id;
        if (typeof clientId !== 'string') {
          return html(reply, 400, renderNotice('The client did not identify itself.'));
        }

        const granted = parseRequestedScopes(scopeStringOf(details));
        if (!granted.ok) {
          return html(reply, 400, renderNotice('The client asked for unsupported access.'));
        }

        // The connection is bound to a real client row, so a client the
        // application has never seen must be refused before an agent exists.
        ensureClientRegistered(sqlite, clientId);

        const agent = selectOrCreateAgent({
          agents,
          user,
          requestedAgentId: request.body?.get('agentId') ?? undefined,
          newAgentName: request.body?.get('newAgentName') ?? undefined,
        });

        const connection = agents.createConnection({
          agentId: agent.id,
          oauthClientId: clientId,
          scopes: granted.value,
        });

        // A fresh grant is created for each approval, so consent here is an
        // explicit human decision rather than a reused earlier one.
        const grant = new provider.Grant({ accountId: user.id, clientId });
        grant.addOIDCScope('openid');
        for (const scope of granted.value) {
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
  handle: (details: Awaited<ReturnType<Provider['interactionDetails']>>) => Promise<FastifyReply | undefined>,
): Promise<FastifyReply> {
  reply.hijack();

  try {
    const details = await request.server.oidcProvider.interactionDetails(request.raw, reply.raw);
    const handled = await handle(details);
    return handled ?? reply;
  } catch (error) {
    request.server.log.warn({ err: error }, 'interaction could not be completed');
    writeRaw(reply, 400, renderNotice('This authorization request is no longer valid.'));
    return reply;
  }
}

function currentUser(request: FastifyRequest, auth: AuthModule): PublicUser | undefined {
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
  if (requestedAgentId !== undefined && requestedAgentId !== '') {
    // Ownership is enforced by the module: another person's agent is `not_found`.
    return agents.getOwnedAgent(requestedAgentId, user.id);
  }

  const name = (newAgentName ?? '').trim();
  if (name === '') {
    throw new Error('An agent identity is required to approve this connection');
  }

  return agents.createAgent({ ownerUserId: user.id, name });
}

function scopeStringOf(
  details: Awaited<ReturnType<Provider['interactionDetails']>>,
): string | undefined {
  const scope = details.params.scope;
  return typeof scope === 'string' ? scope : undefined;
}

function html(reply: FastifyReply, statusCode: number, body: string): FastifyReply {
  writeRaw(reply, statusCode, body);
  return reply;
}

function writeRaw(reply: FastifyReply, statusCode: number, body: string): void {
  reply.raw.statusCode = statusCode;
  reply.raw.setHeader('content-type', 'text/html; charset=utf-8');
  // A consent decision must never be served from a cache.
  reply.raw.setHeader('cache-control', 'no-store');
  reply.raw.end(body);
}

/** Escapes untrusted text before it is placed in the server-rendered page. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLoginPage(uid: string, message: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign in</title></head>
<body><main>
<h1>Sign in</h1>
<p>${escapeHtml(message)}</p>
<form id="login">
  <label for="email">Email</label><input id="email" type="email" required>
  <label for="password">Password</label><input id="password" type="password" required>
  <button type="submit">Sign in</button>
</form>
<p id="status" role="status"></p>
</main>
<script>
document.getElementById('login').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value
    })
  });
  if (response.ok) {
    window.location.reload();
    return;
  }
  document.getElementById('status').textContent = 'Those credentials were not accepted.';
});
</script></body></html>`;
}

function renderConsentPage(
  details: Awaited<ReturnType<Provider['interactionDetails']>>,
  ownedAgents: Array<{ id: string; name: string }>,
): string {
  const clientId = typeof details.params.client_id === 'string' ? details.params.client_id : '';
  const requested = scopeStringOf(details) ?? AGENT_SCOPES.join(' ');

  const existing = ownedAgents
    .map(
      (agent) =>
        `<li><label><input type="radio" name="agentId" value="${escapeHtml(agent.id)}"> ${escapeHtml(agent.name)}</label></li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authorize agent</title></head>
<body><main>
<h1>Authorize an agent</h1>
<p><code>${escapeHtml(clientId)}</code> is asking to act as one of your agents.</p>
<p>The agent acts as itself. It never acts as you.</p>
<p>Requested access: <code>${escapeHtml(requested)}</code></p>
<form method="post" action="${INTERACTION_PREFIX}/${escapeHtml(details.uid)}/consent">
  ${ownedAgents.length > 0 ? `<fieldset><legend>Use an existing agent</legend><ul>${existing}</ul></fieldset>` : ''}
  <fieldset>
    <legend>Or create a new agent</legend>
    <label for="newAgentName">Agent name</label>
    <input id="newAgentName" name="newAgentName" maxlength="60">
  </fieldset>
  <button type="submit">Approve</button>
</form>
</main></body></html>`;
}

function renderNotice(message: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authorization</title></head>
<body><main><h1>Authorization</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Set once during composition so handlers can reach the provider. */
    oidcProvider: Provider;
  }
}
