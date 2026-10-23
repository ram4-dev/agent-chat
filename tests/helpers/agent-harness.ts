import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  AUTH_PATHS,
  MIGRATIONS_DIRECTORY,
} from '@agent-chat/contracts';
import type { FastifyInstance } from '../../apps/server/src/app';
import { createApp } from '../../apps/server/src/app';
import { readConfig } from '../../apps/server/src/config/env';
import { REPOSITORY_ROOT } from '../../apps/server/src/config/index';
import { createDatabase, type DatabaseHandle } from '../../apps/server/src/persistence/client';
import { migrateFromDirectory } from '../../apps/server/src/persistence/migrate';

const temporaryDirectories: string[] = [];
const harnesses: Harness[] = [];

export interface Harness {
  app: FastifyInstance;
  database: DatabaseHandle;
  origin: string;
  close(): Promise<void>;
}

function temporaryDirectory(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export async function startHarness(): Promise<Harness> {
  const webDistDir = temporaryDirectory('agent-chat-mcp-web-');
  mkdirSync(join(webDistDir, 'assets'), { recursive: true });
  writeFileSync(join(webDistDir, 'index.html'), '<div id="root"></div>', 'utf8');

  const database = createDatabase({
    path: join(temporaryDirectory('agent-chat-mcp-'), 'mcp.db'),
    busyTimeoutMs: 1000,
  });
  migrateFromDirectory(database.sqlite, join(REPOSITORY_ROOT, MIGRATIONS_DIRECTORY));

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const config = readConfig({
    repoRoot: REPOSITORY_ROOT,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', WEB_DIST_DIR: webDistDir, PUBLIC_ORIGIN: origin },
  });
  const app = await createApp({ config, database });
  await app.ready();
  // The MCP client opens a real socket rather than going through `inject`, so
  // this harness binds the port the issuer was configured with.
  await app.listen({ host: '127.0.0.1', port });

  const harness: Harness = {
    app,
    database,
    origin,
    close: async () => {
      for (const client of app.websocketServer.clients) client.terminate();
      app.server.closeAllConnections();
      await app.close();
      try {
        database.close();
      } catch {
        // already closed on purpose
      }
    },
  };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()?.close();
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

export class CookieJar {
  private readonly cookies = new Map<string, string>();
  absorb(headers: Record<string, unknown>): void {
    const raw = headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [String(raw)];
    for (const entry of list) {
      const [pair] = entry.split(';');
      const at = pair?.indexOf('=') ?? -1;
      if (pair === undefined || at === -1) continue;
      this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }
  header(): string | undefined {
    return this.cookies.size === 0
      ? undefined
      : [...this.cookies.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
  }
}

export async function call(
  harness: Harness,
  jar: CookieJar,
  options: { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: unknown },
) {
  const cookie = jar.header();
  const response = await harness.app.inject({
    method: options.method,
    url: options.url,
    headers: {
      host: new URL(harness.origin).host,
      ...(cookie === undefined ? {} : { cookie }),
      ...(options.method === 'POST' || options.method === 'DELETE'
        ? {
            // A media type is declared only when there is a body: claiming
            // application/json with no payload is itself an error server-side,
            // and a request with no body is what an admission call sends.
            ...(options.payload === undefined
              ? {}
              : {
                  'content-type':
                    typeof options.payload === 'string'
                      ? 'application/x-www-form-urlencoded'
                      : 'application/json',
                }),
            ...(options.url.startsWith('/api/') || options.url.startsWith('/oauth/interaction/')
              ? { origin: harness.origin }
              : {}),
          }
        : {}),
    },
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });
  jar.absorb(response.headers as Record<string, unknown>);
  return response;
}

async function follow(harness: Harness, jar: CookieJar, start: string, maxHops = 10) {
  let url = start;
  let step = await call(harness, jar, { method: 'GET', url });
  for (let hop = 0; hop < maxHops; hop += 1) {
    const location = step.headers['location'];
    if (step.statusCode < 300 || step.statusCode >= 400 || typeof location !== 'string') return step;
    const target = new URL(location, harness.origin);
    if (target.searchParams.has('code') || target.searchParams.has('error')) return step;
    url = `${target.pathname}${target.search}`;
    step = await call(harness, jar, { method: 'GET', url });
  }
  throw new Error('redirect chain did not settle');
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Drives the whole approved flow and returns a live agent credential. */
export async function agentToken(
  harness: Harness,
  email: string,
  agentName: string,
): Promise<{ token: string; refreshToken: string; clientId: string; jar: CookieJar }> {
  const jar = new CookieJar();

  await call(harness, jar, {
    method: 'POST',
    url: AUTH_PATHS.register,
    payload: { email, displayName: 'Owner', password: 'a-sufficiently-long-password' },
  });

  const redirectUri = `${harness.origin}/callback`;
  const registration = await call(harness, jar, {
    method: 'POST',
    url: '/reg',
    payload: {
      client_name: 'MCP test client',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  const clientId = JSON.parse(registration.body).client_id as string;

  const { verifier, challenge } = pkce();
  const authorizeUrl = `/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid agent:read agent:send agent:inbox agent:receive',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state',
  })}`;

  const page = await follow(harness, jar, authorizeUrl);
  const form = /action="\/oauth\/interaction\/([^/"]+)\/consent"/.exec(page.body);
  expect(form?.[1]).toEqual(expect.any(String));

  const approved = await call(harness, jar, {
    method: 'POST',
    url: `/oauth/interaction/${form?.[1]}/consent`,
    payload: new URLSearchParams({ newAgentName: agentName }).toString(),
  });
  expect([302, 303]).toContain(approved.statusCode);

  const code = await codeFrom(harness, jar, String(approved.headers['location']));
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

  return { token: JSON.parse(token.body).access_token as string, refreshToken: JSON.parse(token.body).refresh_token as string, clientId, jar };
}

/** Drives the flow for one owner and reports the agent it now owns. */
export async function ownerWithAgent(
  harness: Harness,
  email: string,
  agentName: string,
): Promise<{ jar: CookieJar; agentId: string; token: string }> {
  const { token, jar } = await agentToken(harness, email, agentName);
  const agent = harness.database.sqlite
    .prepare(
      `SELECT a.id FROM agents a JOIN users u ON u.id = a.owner_user_id WHERE u.email = ?`,
    )
    .get(email) as { id: string };

  return { jar, agentId: agent.id, token };
}

/** Walks the provider's resume path and collects the issued code. */
async function codeFrom(harness: Harness, jar: CookieJar, resume: string): Promise<string> {
  let url = resume.startsWith(harness.origin) ? resume.slice(harness.origin.length) : resume;
  for (let hop = 0; hop < 6; hop += 1) {
    const step = await call(harness, jar, { method: 'GET', url });
    const location = step.headers['location'];
    if (typeof location !== 'string') break;
    const target = new URL(location, harness.origin);
    const code = target.searchParams.get('code');
    if (code !== null) return code;
    if (target.origin !== harness.origin) break;
    url = `${target.pathname}${target.search}`;
  }
  throw new Error('no authorization code');
}

export async function connect(token: string | undefined, harness: Harness) {
  const client = new Client({ name: 'test-mcp', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${harness.origin}/mcp`), {
    ...(token === undefined
      ? {}
      : { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
  });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

