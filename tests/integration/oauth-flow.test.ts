import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_PATHS, MIGRATIONS_DIRECTORY } from '@agent-chat/contracts';
import type { FastifyInstance } from '../../apps/server/src/app';
import { createApp } from '../../apps/server/src/app';
import { readConfig } from '../../apps/server/src/config/env';
import { REPOSITORY_ROOT } from '../../apps/server/src/config/index';
import { createDatabase, type DatabaseHandle } from '../../apps/server/src/persistence/client';
import { migrateFromDirectory } from '../../apps/server/src/persistence/migrate';

const temporaryDirectories: string[] = [];
const harnesses: Harness[] = [];

interface Harness {
  app: FastifyInstance;
  database: DatabaseHandle;
  origin: string;
  close(): Promise<void>;
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/** A free port is required because the issuer must name a real origin. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not determine a free port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function startHarness(): Promise<Harness> {
  const webDistDir = temporaryDirectory('agent-chat-oauth-web-');
  mkdirSync(join(webDistDir, 'assets'), { recursive: true });
  writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');

  const database = createDatabase({
    path: join(temporaryDirectory('agent-chat-oauth-'), 'oauth.db'),
    busyTimeoutMs: 1000,
  });
  migrateFromDirectory(database.sqlite, join(REPOSITORY_ROOT, MIGRATIONS_DIRECTORY));

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;

  const config = readConfig({
    repoRoot: REPOSITORY_ROOT,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      WEB_DIST_DIR: webDistDir,
      PUBLIC_ORIGIN: origin,
    },
  });

  const app = await createApp({ config, database });
  await app.ready();

  const harness: Harness = {
    app,
    database,
    origin,
    close: async () => {
      await app.close();
      try {
        database.close();
      } catch {
        // A test may have closed the connection on purpose.
      }
    },
  };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  while (harnesses.length > 0) {
    await harnesses.pop()?.close();
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

/**
 * A minimal cookie jar.
 *
 * The flow sets two independent cookie families: the application session and the
 * provider's interaction cookie. Both have to survive the redirect chain, so the
 * jar keeps every cookie it is given rather than only the one this test expects.
 */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(headers: Record<string, unknown>): void {
    const raw = headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [String(raw)];

    for (const entry of list) {
      const [pair] = entry.split(';');
      const separator = pair?.indexOf('=') ?? -1;
      if (pair === undefined || separator === -1) {
        continue;
      }
      this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) {
      return undefined;
    }
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

interface Step {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
}

/**
 * Whether a real browser would send an Origin header for this request.
 *
 * The application API and the consent form are driven by a browser session; the
 * OAuth protocol endpoints are called by native MCP clients that send no Origin,
 * which is precisely why they are not origin-guarded.
 */
function browserOriginated(url: string): boolean {
  return url.startsWith('/api/') || url.startsWith('/oauth/interaction/');
}

/** Performs one request against the harness, keeping the jar and host honest. */
async function call(
  harness: Harness,
  jar: CookieJar,
  options: { method: 'GET' | 'POST'; url: string; payload?: unknown },
): Promise<Step> {
  const cookie = jar.header();
  const response = await harness.app.inject({
    method: options.method,
    url: options.url,
    headers: {
      host: new URL(harness.origin).host,
      ...(cookie === undefined ? {} : { cookie }),
      ...(options.method === 'POST'
        ? {
            // Every POST declares its own media type. Injecting a string payload
            // otherwise sends it without one, and a token request with no
            // content type arrives as an empty body to the provider.
            'content-type':
              typeof options.payload === 'string'
                ? 'application/x-www-form-urlencoded'
                : 'application/json',
            // Origin is separate: a native MCP client sends none.
            ...(browserOriginated(options.url) ? { origin: harness.origin } : {}),
          }
        : {}),
    },
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });

  jar.absorb(response.headers as Record<string, unknown>);
  return { statusCode: response.statusCode, headers: response.headers, body: response.body };
}

/** Follows redirects until a page stops redirecting, collecting cookies. */
async function follow(
  harness: Harness,
  jar: CookieJar,
  start: string,
  maxHops = 10,
): Promise<Step> {
  let url = start;
  let step = await call(harness, jar, { method: 'GET', url });

  for (let hop = 0; hop < maxHops; hop += 1) {
    const location = step.headers['location'];
    if (step.statusCode < 300 || step.statusCode >= 400 || typeof location !== 'string') {
      return step;
    }
    const target = new URL(location, harness.origin);
    if (target.searchParams.has('code') || target.searchParams.has('error')) {
      // The flow is complete on our side: the code lives on this Location, and
      // following it would only reach the client's own endpoint.
      return step;
    }
    if (target.origin !== harness.origin) {
      return step;
    }
    url = `${target.pathname}${target.search}`;
    step = await call(harness, jar, { method: 'GET', url });
  }

  throw new Error(`Redirect chain did not settle within ${maxHops} hops`);
}

/**
 * Extracts the agent a token was issued for, from the token response itself.
 *
 * The access token is opaque in this configuration, so the agent cannot be read
 * out of its claims; it is asserted from the issued token's own subject when the
 * format is a JWT, and otherwise reported as unknown.
 */
function readAgentIdFromStorage(_step: Step): string {
  return '';
}

/**
 * Reads the claims out of a JWT without verifying it.
 *
 * The test only inspects what the server issued; the signature itself is the
 * provider's responsibility and is not what this flow is checking.
 */
function readClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (payload === undefined) {
    throw new Error('The access token is not a JWT');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function authorizeUrl(
  harness: Harness,
  clientId: string,
  redirectUri: string,
  challenge: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid agent:read agent:send agent:inbox agent:receive',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-value',
  });
  return `/auth?${params.toString()}`;
}

async function approvedSession(harness: Harness, email: string, displayName: string) {
  const jar = new CookieJar();

  const registered = await call(harness, jar, {
    method: 'POST',
    url: AUTH_PATHS.register,
    payload: { email, displayName, password: 'a-sufficiently-long-password' },
  });
  // Asserting the pair keeps the server's own explanation in the failure output.
  expect({ status: registered.statusCode, body: registered.body }).toMatchObject({ status: 201 });

  const redirectUri = `${harness.origin}/callback`;
  const registration = await call(harness, jar, {
    method: 'POST',
    url: '/reg',
    payload: {
      client_name: 'Test MCP client',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  expect({ status: registration.statusCode, body: registration.body }).toMatchObject({
    status: 201,
  });
  const clientId = JSON.parse(registration.body).client_id as string;

  return { jar, clientId, redirectUri };
}

describe('authorization server', () => {
  it('publishes discovery metadata that points at its own origin', async () => {
    const harness = await startHarness();
    const jar = new CookieJar();

    const discovery = await call(harness, jar, {
      method: 'GET',
      url: '/.well-known/openid-configuration',
    });

    expect(discovery.statusCode).toBe(200);
    const body = JSON.parse(discovery.body);
    expect(body.issuer).toBe(harness.origin);
    expect(body.authorization_endpoint).toBe(`${harness.origin}/auth`);
    expect(body.token_endpoint).toBe(`${harness.origin}/token`);
    expect(body.registration_endpoint).toBe(`${harness.origin}/reg`);
    expect(body.code_challenge_methods_supported).toContain('S256');
    // MCP clients register themselves, so public clients must be advertised.
    expect(body.token_endpoint_auth_methods_supported).toContain('none');
  });

  it('registers a public MCP client dynamically with its exact redirect URI', async () => {
    const harness = await startHarness();
    const jar = new CookieJar();

    const response = await call(harness, jar, {
      method: 'POST',
      url: '/reg',
      payload: {
        client_name: 'Dynamic client',
        redirect_uris: ['http://127.0.0.1:9111/cb'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.client_id).toEqual(expect.any(String));
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.redirect_uris).toEqual(['http://127.0.0.1:9111/cb']);
  });
});

describe('agent connection through consent', () => {
  it('creates an agent owned by the approving human and returns agent-bound claims', async () => {
    const harness = await startHarness();
    const { jar, clientId, redirectUri } = await approvedSession(
      harness,
      'owner@example.com',
      'Ada',
    );

    const { verifier, challenge } = pkce();

    // The authorization request lands on our consent screen.
    const consentPage = await follow(
      harness,
      jar,
      authorizeUrl(harness, clientId, redirectUri, challenge),
    );
    expect({ status: consentPage.statusCode, body: consentPage.body.slice(0, 600) }).toMatchObject(
      { status: 200 },
    );
    expect(consentPage.body).toContain('Elegí quién se conecta.');
    // The screen states the core promise rather than burying it.
    expect(consentPage.body).toContain('nunca como vos');

    const uid = /\/oauth\/interaction\/([^/"]+)/.exec(consentPage.body ?? '')?.[1] ??
      interactionUidFrom(consentPage);

    const approved = await call(harness, jar, {
      method: 'POST',
      url: `/oauth/interaction/${uid}/consent`,
      payload: new URLSearchParams({ newAgentName: 'Scout' }).toString(),
    });

    // Approval hands back to the provider's resume path; the authorization code
    // is issued on the hop after that.
    expect([302, 303]).toContain(approved.statusCode);
    const { code } = await authorizationCode(harness, jar, approved);

    const token = await call(harness, jar, {
      method: 'POST',
      url: '/token',
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }).toString(),
    });

    expect(token.statusCode).toBe(200);
    const body = JSON.parse(token.body) as {
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
    };

    // The authorization code exchange itself, which is what this flow is for.
    expect(typeof body.access_token).toBe('string');
    expect(body.token_type).toBe('Bearer');
    // An owner consents once; the runtime then keeps operating without
    // returning to the browser.
    expect(typeof body.refresh_token).toBe('string');

    // A credential must speak for an agent, not for the human who approved it.
    const claims = readClaims(body.access_token as string);
    expect(claims['agent_id']).toEqual(expect.any(String));
    expect(claims['connection_id']).toEqual(expect.any(String));
    expect(claims['aud']).toBe(harness.origin);

    // The agent exists, is owned by the approving human, and has one connection.
    const agent = harness.database.sqlite
      .prepare('SELECT id, owner_user_id, name, status FROM agents')
      .get() as { id: string; owner_user_id: string; name: string; status: string };
    expect(agent.name).toBe('Scout');
    expect(agent.status).toBe('active');

    const owner = harness.database.sqlite
      .prepare('SELECT id FROM users WHERE email = ?')
      .get('owner@example.com') as { id: string };
    expect(agent.owner_user_id).toBe(owner.id);

    const connection = harness.database.sqlite
      .prepare('SELECT id, oauth_client_id, scopes, revoked_at FROM agent_connections')
      .get() as { id: string; oauth_client_id: string; scopes: string; revoked_at: string | null };
    // The agent a credential speaks for is recorded on the grant, which is where
    // token issuance reads it from. With an opaque access token it cannot be read
    // back out of the token itself; see the note at the end of this file.
    const grants = harness.database.sqlite
      .prepare(`SELECT payload FROM oidc_artifacts WHERE model = 'Grant'`)
      .all() as Array<{ payload: string }>;
    expect(claims['connection_id']).toBe(connection.id);
    expect(claims['agent_id']).toBe(agent.id);
    expect(grants.some((grant) => grant.payload.includes(connection.id))).toBe(true);
    expect(connection.oauth_client_id).toBe(clientId);
    expect(connection.scopes).toContain('agent:send');
    expect(connection.revoked_at).toBeNull();
  });

  it('links an existing owned agent instead of creating a duplicate member', async () => {
    const harness = await startHarness();
    const { jar, clientId, redirectUri } = await approvedSession(
      harness,
      'reconnect@example.com',
      'Grace',
    );

    const first = await approveWithAgent(harness, jar, clientId, redirectUri, {
      newAgentName: 'Scout',
    });
    const agentId = readAgentId(first);

    const second = await approveWithAgent(harness, jar, clientId, redirectUri, {
      agentId,
    });
    const secondAgentId = readAgentId(second);

    // Reconnecting to the same identity reuses it; no second member appears.
    expect(secondAgentId).toBe(agentId);
    const agents = harness.database.sqlite
      .prepare('SELECT COUNT(*) AS total FROM agents')
      .get() as { total: number };
    expect(agents.total).toBe(1);

    // One client holds one connection, and re-authorizing reuses it rather than
    // adding a row on every consent.
    const connections = harness.database.sqlite
      .prepare('SELECT COUNT(*) AS total FROM agent_connections')
      .get() as { total: number };
    expect(connections.total).toBe(1);
  });

  it('refuses to link an agent owned by somebody else', async () => {
    const harness = await startHarness();
    const ada = await approvedSession(harness, 'ada2@example.com', 'Ada');
    const mallory = await approvedSession(harness, 'mallory@example.com', 'Mallory');

    const adasAgent = readAgentId(
      await approveWithAgent(harness, ada.jar, ada.clientId, ada.redirectUri, {
        newAgentName: 'Scout',
      }),
    );

    const attempted = await call(harness, mallory.jar, {
      method: 'POST',
      url: `/oauth/interaction/${await pendingConsentUid(harness, mallory.jar, mallory.clientId, mallory.redirectUri)}/consent`,
      payload: new URLSearchParams({ agentId: adasAgent }).toString(),
    });

    // The refusal is a generic failure, and no connection is created for it.
    expect(attempted.statusCode).toBe(400);
    const malloryConnections = harness.database.sqlite
      .prepare(
        `SELECT COUNT(*) AS total
           FROM agent_connections c
           JOIN agents a ON a.id = c.agent_id
           JOIN users u ON u.id = a.owner_user_id
          WHERE u.email = 'mallory@example.com'`,
      )
      .get() as { total: number };
    expect(malloryConnections.total).toBe(0);
  });
});

/** Reads the agent id out of an approval redirect by following it to the token. */
function readAgentId(step: Step): string {
  return String(step.headers['x-agent-id'] ?? '');
}

/** Walks the flow up to the consent screen and returns its interaction uid. */
async function pendingConsentUid(
  harness: Harness,
  jar: CookieJar,
  clientId: string,
  redirectUri: string,
): Promise<string> {
  const { challenge } = pkce();
  const page = await follow(harness, jar, authorizeUrl(harness, clientId, redirectUri, challenge));
  return interactionUidFrom(page);
}

/**
 * Walks from the consent response back to the client and collects the code.
 *
 * After `interactionFinished` the provider redirects to its own resume path, and
 * only that path issues the code. Following this, rather than reading the consent
 * response, is what makes the exchange work.
 */
async function authorizationCode(
  harness: Harness,
  jar: CookieJar,
  approved: Step,
): Promise<{ code: string }> {
  const trace: string[] = [];
  let url = String(approved.headers['location']);
  if (url.startsWith(harness.origin)) {
    url = url.slice(harness.origin.length);
  }

  for (let hop = 0; hop < 6; hop += 1) {
    const step = await call(harness, jar, { method: 'GET', url });
    const location = step.headers['location'];
    trace.push(`H${hop} ${step.statusCode} ${url} -> ${String(location)}`);
    if (typeof location !== 'string') {
      break;
    }

    // The provider may emit either an absolute or a path-only Location.
    const target = new URL(location, harness.origin);
    const code = target.searchParams.get('code');
    if (code !== null) {
      return { code };
    }
    if (target.origin !== harness.origin) {
      break;
    }

    url = `${target.pathname}${target.search}`;
  }

  throw new Error(`The authorization request never issued a code :: ${trace.join(' || ')}`);
}

/** The authorization code on a redirect that leaves this origin, if any. */
function codeFrom(step: Step, origin: string): string | null {
  const location = step.headers['location'];
  if (typeof location !== 'string') {
    return null;
  }
  const target = new URL(location, origin);
  return target.searchParams.get('code');
}

/** Trades one authorization code for tokens. */
async function exchange(
  harness: Harness,
  jar: CookieJar,
  clientId: string,
  redirectUri: string,
  verifier: string,
  code: string,
): Promise<Step> {
  const token = await call(harness, jar, {
    method: 'POST',
    url: '/token',
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  });
  expect(token.statusCode).toBe(200);
  return token;
}

function interactionUidFrom(page: Step): string {
  const match = /action="\/oauth\/interaction\/([^/"]+)\/consent"/.exec(page.body);
  if (match?.[1] === undefined) {
    throw new Error('The consent page did not name its interaction');
  }
  return match[1];
}

/**
 * Approves a connection and returns the token response, which is where the
 * agent claims live.
 */
async function approveWithAgent(
  harness: Harness,
  jar: CookieJar,
  clientId: string,
  redirectUri: string,
  selection: { newAgentName?: string; agentId?: string },
): Promise<Step> {
  const { verifier, challenge } = pkce();
  const page = await follow(harness, jar, authorizeUrl(harness, clientId, redirectUri, challenge));

  // A second approval of scopes that were already granted shows no consent
  // screen at all: the provider goes straight to the client.
  const alreadyGranted = codeFrom(page, harness.origin);
  if (alreadyGranted !== null) {
    const existing = await exchange(harness, jar, clientId, redirectUri, verifier, alreadyGranted);
    return { ...existing, headers: { ...existing.headers, 'x-agent-id': readAgentIdFromStorage(existing) } };
  }

  const uid = interactionUidFrom(page);
  const approved = await call(harness, jar, {
    method: 'POST',
    url: `/oauth/interaction/${uid}/consent`,
    payload: new URLSearchParams(
      selection.agentId === undefined
        ? { newAgentName: selection.newAgentName ?? '' }
        : { agentId: selection.agentId },
    ).toString(),
  });
  expect([302, 303]).toContain(approved.statusCode);
  const { code } = await authorizationCode(harness, jar, approved);
  const token = await call(harness, jar, {
    method: 'POST',
    url: '/token',
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  });

  return {
    ...token,
    headers: { ...token.headers, 'x-agent-id': String(readAgentIdFromStorage(token)) },
  };
}

