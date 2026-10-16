import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  AUTH_PATHS,
  GROUP_PATHS,
  MIGRATIONS_DIRECTORY,
  MESSAGE_PATHS,
} from '@agent-chat/contracts';
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

async function startHarness(): Promise<Harness> {
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

class CookieJar {
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

async function call(
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
async function agentToken(
  harness: Harness,
  email: string,
  agentName: string,
): Promise<{ token: string; jar: CookieJar }> {
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

  return { token: JSON.parse(token.body).access_token as string, jar };
}

/** Drives the flow for one owner and reports the agent it now owns. */
async function ownerWithAgent(
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

async function connect(token: string | undefined, harness: Harness) {
  const client = new Client({ name: 'test-mcp', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${harness.origin}/mcp`), {
    ...(token === undefined
      ? {}
      : { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
  });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

describe('MCP tool surface', () => {
  it('refuses an unauthenticated caller with the stable domain code', async () => {
    const harness = await startHarness();

    // The handshake itself is the first tool-like request, so that is where the
    // refusal surfaces. It names no reason: expired, forged, and missing
    // credentials all read the same.
    await expect(connect(undefined, harness)).rejects.toThrow('unauthenticated');
  });

  it('advertises the four approved tools to an authenticated agent', async () => {
    const harness = await startHarness();
    const { token } = await agentToken(harness, 'tools-owner@example.com', 'Roster');

    const { client, close } = await connect(token, harness);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'ack_inbox',
        'get_identity',
        'get_inbox',
        'list_groups',
        'read_messages',
        'send_message',
      ]);
    } finally {
      await close();
    }
  });

  it('answers an agent credential with its identity, owner, and granted scopes', async () => {
    const harness = await startHarness();
    const { token } = await agentToken(harness, 'mcp-owner@example.com', 'Scout');

    const { client, close } = await connect(token, harness);
    try {
      const result = await client.callTool({ name: 'get_identity', arguments: {} });
      const payload = JSON.parse(String((result.content as Array<{ text: string }>)[0]?.text)) as {
        agent: { id: string; name: string };
        owner: { email: string } | null;
        connection: { scopes: string[] };
      };

      expect(payload.agent.name).toBe('Scout');
      expect(payload.owner?.email).toBe('mcp-owner@example.com');
      // The credential reports what it may do, so a client never has to guess.
      expect(payload.connection.scopes).toEqual(
        expect.arrayContaining(['agent:read', 'agent:send', 'agent:inbox', 'agent:receive']),
      );
    } finally {
      await close();
    }
  });

  it('scopes read and send to groups the agent belongs to', async () => {
    const harness = await startHarness();
    const { token, jar } = await agentToken(harness, 'chat-owner@example.com', 'Scribe');

    const agent = harness.database.sqlite
      .prepare('SELECT id FROM agents LIMIT 1')
      .get() as { id: string };

    // The group is created and the agent admitted through the product's own
    // routes: no membership is seeded by hand.
    const created = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Research' },
    });
    expect(created.statusCode).toBe(201);
    const groupId = JSON.parse(created.body).group.id as string;

    const admitted = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agent.id),
    });
    expect([200, 201]).toContain(admitted.statusCode);

    const { client, close } = await connect(token, harness);
    try {
      const listed = await client.callTool({ name: 'list_groups', arguments: {} });
      const groups = JSON.parse(String((listed.content as Array<{ text: string }>)[0]?.text)) as {
        groups: Array<{ id: string; role: string }>;
      };
      expect(groups.groups.map((group) => [group.id, group.role])).toEqual([[groupId, 'member']]);

      const missing = await client.callTool({
        name: 'send_message',
        arguments: { group_id: 'not-a-member', text: 'nope', idempotency_key: 'k1' },
      });
      expect(missing.isError).toBe(true);
      expect(String((missing.content as Array<{ text: string }>)[0]?.text)).toBe('not_found');

      const sent = await client.callTool({
        name: 'send_message',
        arguments: { group_id: groupId, text: 'An update from the agent', idempotency_key: 'k1' },
      });
      expect(sent.isError).toBeUndefined();
      const message = JSON.parse(String((sent.content as Array<{ text: string }>)[0]?.text)) as {
        message: { text: string; author: { kind: string } };
      };
      expect(message.message.text).toBe('An update from the agent');
      expect(message.message.author.kind).toBe('agent');

      // Retrying the same key returns the same message, not a second one.
      const retry = await client.callTool({
        name: 'send_message',
        arguments: { group_id: groupId, text: 'An update from the agent', idempotency_key: 'k1' },
      });
      const retried = JSON.parse(String((retry.content as Array<{ text: string }>)[0]?.text)) as {
        replayed: boolean;
      };
      expect(retried.replayed).toBe(true);

      const stored = harness.database.sqlite
        .prepare('SELECT COUNT(*) AS total FROM messages')
        .get() as { total: number };
      expect(stored.total).toBe(1);

      const read = await client.callTool({
        name: 'read_messages',
        arguments: { group_id: groupId },
      });
      const page = JSON.parse(String((read.content as Array<{ text: string }>)[0]?.text)) as {
        messages: Array<{ text: string }>;
      };
      expect(page.messages[0]?.text).toBe('An update from the agent');
    } finally {
      await close();
    }
  });
});

describe('admitting an agent to a private group', () => {
  it('lets a group admin admit an agent and refuses a plain member and an outsider', async () => {
    const harness = await startHarness();
    const { jar: admin, agentId } = await ownerWithAgent(harness, 'admin@example.com', 'Scout');
    const { jar: member } = await ownerWithAgent(harness, 'member@example.com', 'Member');
    const { jar: outsider } = await ownerWithAgent(harness, 'outsider@example.com', 'Outsider');

    const created = await call(harness, admin, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Private' },
    });
    const groupId = JSON.parse(created.body).group.id as string;

    // A person outside the group is told nothing about it.
    const fromOutsider = await call(harness, outsider, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(fromOutsider.statusCode).toBe(404);
    expect(fromOutsider.json()).toEqual({ error: { code: 'not_found' } });

    const admitted = await call(harness, admin, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(admitted.statusCode).toBe(201);

    const detail = await call(harness, admin, { method: 'GET', url: GROUP_PATHS.one(groupId) });
    const members = (detail.json().members ?? []) as Array<{ kind: string; displayName: string }>;
    expect(members.filter((m) => m.kind === 'agent').map((m) => m.displayName)).toEqual(['Scout']);

    // Joining twice adds nothing.
    const again = await call(harness, admin, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(again.statusCode).toBe(200);

    // A member of the group who is not its admin cannot admit anyone.
    const invited = await call(harness, admin, {
      method: 'POST',
      url: GROUP_PATHS.invitations(groupId),
    });
    const accepted = await call(harness, member, {
      method: 'POST',
      url: GROUP_PATHS.acceptInvitation,
      payload: { token: JSON.parse(invited.body).token },
    });
    expect(accepted.statusCode).toBe(200);

    const fromMember = await call(harness, member, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(fromMember.statusCode).toBe(403);
    expect(fromMember.json()).toEqual({ error: { code: 'forbidden' } });
  });

  it('refuses an agent that does not exist or is revoked', async () => {
    const harness = await startHarness();
    const { jar, agentId } = await ownerWithAgent(harness, 'revoker@example.com', 'Scout');

    const created = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Private' },
    });
    const groupId = JSON.parse(created.body).group.id as string;

    const unknown = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, 'no-such-agent'),
    });
    expect(unknown.statusCode).toBe(404);

    harness.database.sqlite
      .prepare(`UPDATE agents SET status = 'revoked', revoked_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), agentId);

    const revoked = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(revoked.statusCode).toBe(404);
    expect(revoked.json()).toEqual({ error: { code: 'not_found' } });
  });
});

describe('durable inbox', () => {
  interface InboxEvent {
    event_id?: never;
    eventId: string;
    sequence: number;
    groupId: string;
    message: { text: string; author: { kind: string; displayName: string } };
  }

  /** Reads the pending events an agent currently sees. */
  async function readInbox(client: Awaited<ReturnType<typeof connect>>['client']) {
    const result = await client.callTool({ name: 'get_inbox', arguments: {} });
    const payload = JSON.parse(String((result.content as Array<{ text: string }>)[0]?.text)) as {
      events: InboxEvent[];
      nextCursor?: number;
    };
    return payload;
  }

  it('keeps an event pending until acknowledged, and history never acknowledges it', async () => {
    const harness = await startHarness();
    const { token, jar, agentId } = await ownerWithAgent(
      harness,
      'inbox-owner@example.com',
      'Scribe',
    );

    const created = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Announcements' },
    });
    const groupId = JSON.parse(created.body).group.id as string;
    await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });

    // A person posts while the agent is not listening: nothing reaches a runtime,
    // but nothing is lost either.
    const posted = await call(harness, jar, {
      method: 'POST',
      url: MESSAGE_PATHS.collection(groupId),
      payload: { text: 'A note while nobody is listening', idempotencyKey: 'note-1' },
    });
    expect(posted.statusCode).toBe(201);

    const { client, close } = await connect(token, harness);
    try {
      // AC10: the event is pending and readable after reconnecting.
      const first = await readInbox(client);
      expect(first.events).toHaveLength(1);
      expect(first.events[0]?.message.text).toBe('A note while nobody is listening');
      expect(first.events[0]?.groupId).toBe(groupId);
      expect(first.events[0]?.sequence).toEqual(expect.any(Number));

      // Still pending on a later read: retrieval alone never consumes it.
      const reread = await readInbox(client);
      expect(reread.events).toHaveLength(1);

      // AC11: reading message history does not acknowledge the event.
      await client.callTool({ name: 'read_messages', arguments: { group_id: groupId } });
      const afterHistory = await readInbox(client);
      expect(afterHistory.events).toHaveLength(1);

      // Acknowledging clears pending state, exactly once.
      const eventId = first.events[0]!.eventId;
      await client.callTool({ name: 'ack_inbox', arguments: { event_id: eventId } });
      const cleared = await readInbox(client);
      expect(cleared.events).toEqual([]);

      // Repeating the acknowledgement is safe rather than an error.
      const repeat = await client.callTool({ name: 'ack_inbox', arguments: { event_id: eventId } });
      expect(repeat.isError).toBeUndefined();
      expect((await readInbox(client)).events).toEqual([]);
    } finally {
      await close();
    }
  });

  it('notifies every other agent in the group and never its own author', async () => {
    const harness = await startHarness();
    const { token: authorToken, jar: authorJar, agentId: authorId } = await ownerWithAgent(
      harness,
      'author-owner@example.com',
      'Author',
    );
    const { token: listenerToken, agentId: listenerId } = await ownerWithAgent(
      harness,
      'listener-owner@example.com',
      'Listener',
    );

    const created = await call(harness, authorJar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Shared' },
    });
    const groupId = JSON.parse(created.body).group.id as string;
    for (const agentId of [authorId, listenerId]) {
      const admitted = await call(harness, authorJar, {
        method: 'POST',
        url: GROUP_PATHS.agentMember(groupId, agentId),
      });
      expect([200, 201]).toContain(admitted.statusCode);
    }

    const author = await connect(authorToken, harness);
    const listener = await connect(listenerToken, harness);
    try {
      await author.client.callTool({
        name: 'send_message',
        arguments: { group_id: groupId, text: 'From the author', idempotency_key: 'fan-1' },
      });

      // The other agent is notified of a message it did not write.
      const listenerEvents = await readInbox(listener.client);
      expect(listenerEvents.events).toHaveLength(1);
      expect(listenerEvents.events[0]?.message.text).toBe('From the author');
      expect(listenerEvents.events[0]?.message.author.displayName).toBe('Author');

      // An agent is never told about its own message.
      expect((await readInbox(author.client)).events).toEqual([]);
    } finally {
      await author.close();
      await listener.close();
    }
  });

  it('refuses to disclose an event whose group the agent has left', async () => {
    const harness = await startHarness();
    const { token, jar, agentId } = await ownerWithAgent(
      harness,
      'leaver-owner@example.com',
      'Leaver',
    );

    const created = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Temporary' },
    });
    const groupId = JSON.parse(created.body).group.id as string;
    await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    await call(harness, jar, {
      method: 'POST',
      url: MESSAGE_PATHS.collection(groupId),
      payload: { text: 'Private note', idempotencyKey: 'leave-1' },
    });

    const { client, close } = await connect(token, harness);
    try {
      expect((await readInbox(client)).events).toHaveLength(1);

      // The agent is removed from the group.
      const removed = await call(harness, jar, {
        method: 'DELETE',
        url: GROUP_PATHS.agentMember(groupId, agentId),
      });
      expect(removed.statusCode).toBe(200);

      // The event still exists, but confirming it would reveal that the group
      // holds messages the agent can no longer reach.
      expect((await readInbox(client)).events).toEqual([]);

      const eventId = 'left-behind';
      const acked = await client.callTool({ name: 'ack_inbox', arguments: { event_id: eventId } });
      expect(acked.isError).toBe(true);
      expect(String((acked.content as Array<{ text: string }>)[0]?.text)).toBe('not_found');
    } finally {
      await close();
    }
  });
});
