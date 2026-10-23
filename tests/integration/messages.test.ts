import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  AUTH_PATHS,
  BROWSER_SOCKET_PATH,
  DOMAIN_ERROR_CODES,
  GROUP_PATHS,
  MESSAGE_PATHS,
  MIGRATIONS_DIRECTORY,
  parseBrowserEvent,
  type BrowserEvent,
  type MessageView,
} from '@agent-chat/contracts';
import type { FastifyInstance } from '../../apps/server/src/app';
import { createApp } from '../../apps/server/src/app';
import { readConfig } from '../../apps/server/src/config/env';
import { REPOSITORY_ROOT } from '../../apps/server/src/config/index';
import { createDatabase, type DatabaseHandle } from '../../apps/server/src/persistence/client';
import { migrateFromDirectory } from '../../apps/server/src/persistence/migrate';

interface Harness {
  app: FastifyInstance;
  database: DatabaseHandle;
  baseUrl: string;
  close(): Promise<void>;
}

const temporaryDirectories: string[] = [];
const harnesses: Harness[] = [];
const sockets: WebSocket[] = [];

const ORIGIN = 'http://127.0.0.1:4318';
const MUTATION_HEADERS = { origin: ORIGIN, host: '127.0.0.1:4318' };

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function startHarness(): Promise<Harness> {
  const webDistDir = temporaryDirectory('agent-chat-chat-web-');
  mkdirSync(join(webDistDir, 'assets'), { recursive: true });
  writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');

  const database = createDatabase({
    path: join(temporaryDirectory('agent-chat-chat-'), 'chat.db'),
    busyTimeoutMs: 1000,
  });
  migrateFromDirectory(database.sqlite, join(REPOSITORY_ROOT, MIGRATIONS_DIRECTORY));

  const config = readConfig({
    repoRoot: REPOSITORY_ROOT,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', WEB_DIST_DIR: webDistDir },
  });

  const app = await createApp({ config, database });
  await app.listen({ host: '127.0.0.1', port: 0 });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The test server did not bind a TCP port');
  }

  const harness: Harness = {
    app,
    database,
    baseUrl: `http://127.0.0.1:${address.port}`,
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
  while (sockets.length > 0) {
    sockets.pop()?.terminate();
  }
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

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') {
    throw new Error('The response did not set a session cookie');
  }
  return value.split(';')[0]!;
}

async function signUp(harness: Harness, email: string, displayName: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: AUTH_PATHS.register,
    headers: MUTATION_HEADERS,
    payload: { email, displayName, password: 'a-sufficiently-long-password' },
  });
  expect(response.statusCode).toBe(201);
  return cookieOf(response);
}

async function makeGroup(harness: Harness, cookie: string, name: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: GROUP_PATHS.collection,
    headers: { ...MUTATION_HEADERS, cookie },
    payload: { name },
  });
  return response.json().group.id;
}

async function inviteAndJoin(
  harness: Harness,
  admin: string,
  guest: string,
  groupId: string,
): Promise<void> {
  const invitation = await harness.app.inject({
    method: 'POST',
    url: GROUP_PATHS.invitations(groupId),
    headers: { ...MUTATION_HEADERS, cookie: admin },
  });
  const accepted = await harness.app.inject({
    method: 'POST',
    url: GROUP_PATHS.acceptInvitation,
    headers: { ...MUTATION_HEADERS, cookie: guest },
    payload: { token: invitation.json().token },
  });
  expect(accepted.statusCode).toBe(200);
}

function send(harness: Harness, cookie: string, groupId: string, payload: unknown) {
  return harness.app.inject({
    method: 'POST',
    url: MESSAGE_PATHS.collection(groupId),
    headers: { ...MUTATION_HEADERS, cookie },
    payload: payload as object,
  });
}

function read(
  harness: Harness,
  cookie: string,
  groupId: string,
  query: { limit?: number; before?: string } = {},
) {
  const search = new URLSearchParams();
  if (query.limit !== undefined) {
    search.set('limit', String(query.limit));
  }
  if (query.before !== undefined) {
    search.set('before', query.before);
  }
  const suffix = search.size === 0 ? '' : `?${search.toString()}`;

  return harness.app.inject({
    method: 'GET',
    url: `${MESSAGE_PATHS.collection(groupId)}${suffix}`,
    headers: { cookie },
  });
}

/** Opens one browser socket and resolves the first frame the server sends. */
function openSocket(baseUrl: string, cookie: string): Promise<{ socket: WebSocket; first: BrowserEvent }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}${BROWSER_SOCKET_PATH}`, {
      headers: { cookie, origin: baseUrl },
    });
    sockets.push(socket);

    socket.once('message', (raw: Buffer) => {
      const event = parseBrowserEvent(JSON.parse(raw.toString('utf8')));
      if (event === undefined) {
        reject(new Error('The server sent a frame that is not a browser event'));
        return;
      }
      resolve({ socket, first: event });
    });
    socket.once('error', reject);
  });
}

function nextEvent(socket: WebSocket, timeoutMs = 5000): Promise<BrowserEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No frame arrived in time')), timeoutMs);
    socket.once('message', (raw: Buffer) => {
      clearTimeout(timer);
      const event = parseBrowserEvent(JSON.parse(raw.toString('utf8')));
      if (event === undefined) {
        reject(new Error('The server sent a frame that is not a browser event'));
        return;
      }
      resolve(event);
    });
  });
}

describe('POST /api/groups/:groupId/messages', () => {
  it('attributes the message to the session, never to a supplied name', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const groupId = await makeGroup(harness, ada, 'Research');

    const response = await send(harness, ada, groupId, {
      text: 'Hello everyone',
      idempotencyKey: 'key-1',
      author: { kind: 'agent', id: 'someone-else' },
      displayName: 'Mallory',
    });

    expect(response.statusCode).toBe(201);
    const message: MessageView = response.json().message;
    expect(message.author).toEqual({ kind: 'human', id: expect.any(String), displayName: 'Ada' });
    expect(message.text).toBe('Hello everyone');
    expect(JSON.stringify(message)).not.toContain('Mallory');
  });

  it('returns one message for a retried key and refuses a reused key with new content', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const groupId = await makeGroup(harness, ada, 'Research');

    const first = await send(harness, ada, groupId, { text: 'Hi', idempotencyKey: 'k' });
    const retry = await send(harness, ada, groupId, { text: 'Hi', idempotencyKey: 'k' });
    const reused = await send(harness, ada, groupId, { text: 'Different', idempotencyKey: 'k' });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().message.id).toBe(first.json().message.id);
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.conflict } });

    const stored = harness.database.sqlite
      .prepare('SELECT COUNT(*) AS total FROM messages')
      .get() as { total: number };
    expect(stored.total).toBe(1);
  });

  it.each([
    [{ text: '   ', idempotencyKey: 'k' }, 'blank text'],
    [{ text: 'x'.repeat(8 * 1024 + 1), idempotencyKey: 'k' }, 'text beyond the byte limit'],
    [{ text: 'hello' }, 'missing key'],
    [{ text: 'hello', idempotencyKey: '' }, 'blank key'],
  ])('rejects %j (%s) without storing anything', async (payload, _label) => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const groupId = await makeGroup(harness, ada, 'Research');

    const response = await send(harness, ada, groupId, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.invalid_input } });
    const stored = harness.database.sqlite
      .prepare('SELECT COUNT(*) AS total FROM messages')
      .get() as { total: number };
    expect(stored.total).toBe(0);
  });

  it('answers a non-member as if the group did not exist', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const mallory = await signUp(harness, 'mallory@example.com', 'Mallory');
    const groupId = await makeGroup(harness, ada, 'Research');

    const write = await send(harness, mallory, groupId, { text: 'Hi', idempotencyKey: 'k' });
    const fetch = await read(harness, mallory, groupId);

    expect(write.statusCode).toBe(404);
    expect(fetch.statusCode).toBe(404);
    expect(write.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.not_found } });
    expect(fetch.json()).toEqual(write.json());
  });
});

describe('GET /api/groups/:groupId/messages', () => {
  it('pages newest first with an exclusive cursor and bounds the page size', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const groupId = await makeGroup(harness, ada, 'Research');
    for (const text of ['one', 'two', 'three']) {
      await send(harness, ada, groupId, { text, idempotencyKey: text });
    }

    const first = await read(harness, ada, groupId, { limit: 2 });
    expect(first.json().messages.map((message: MessageView) => message.text)).toEqual([
      'three',
      'two',
    ]);
    const cursor = first.json().nextCursor;
    expect(cursor).toBe(first.json().messages[1].id);

    const second = await read(harness, ada, groupId, { limit: 2, before: cursor });
    expect(second.json().messages.map((message: MessageView) => message.text)).toEqual(['one']);
    expect(second.json().nextCursor).toBeUndefined();

    const capped = await read(harness, ada, groupId, { limit: 1000 });
    expect(capped.statusCode).toBe(200);
  });

  it('refuses a page size that is not a positive integer', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const groupId = await makeGroup(harness, ada, 'Research');

    expect((await read(harness, ada, groupId, { limit: 0 })).statusCode).toBe(400);
  });
});

describe('browser socket', () => {
  it('delivers a committed message to another member without a reload', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const grace = await signUp(harness, 'grace@example.com', 'Grace');
    const groupId = await makeGroup(harness, ada, 'Research');
    await inviteAndJoin(harness, ada, grace, groupId);

    const { socket, first } = await openSocket(harness.baseUrl, grace);
    expect(first).toEqual({ type: 'ready', groupIds: [groupId] });

    const delivered = nextEvent(socket);
    await send(harness, ada, groupId, { text: 'Live hello', idempotencyKey: 'live-1' });

    const event = await delivered;
    expect(event.type).toBe('message.created');
    if (event.type === 'message.created') {
      expect(event.message.text).toBe('Live hello');
      expect(event.message.groupId).toBe(groupId);
      expect(event.message.author.displayName).toBe('Ada');
    }
  });

  it('never delivers a group the session does not belong to', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const mallory = await signUp(harness, 'mallory@example.com', 'Mallory');
    const groupId = await makeGroup(harness, ada, 'Research');

    const { socket, first } = await openSocket(harness.baseUrl, mallory);
    expect(first).toEqual({ type: 'ready', groupIds: [] });

    const frames: BrowserEvent[] = [];
    socket.on('message', (raw: Buffer) => {
      const event = parseBrowserEvent(JSON.parse(raw.toString('utf8')));
      if (event !== undefined) {
        frames.push(event);
      }
    });

    await send(harness, ada, groupId, { text: 'Private', idempotencyKey: 'p-1' });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(frames).toEqual([]);
  });

  it('refuses an upgrade without a session', async () => {
    const harness = await startHarness();

    const outcome = await new Promise<string>((resolve) => {
      const socket = new WebSocket(`${harness.baseUrl.replace('http', 'ws')}${BROWSER_SOCKET_PATH}`, {
        headers: { origin: harness.baseUrl },
      });
      sockets.push(socket);
      socket.once('close', (code: number) => resolve(`closed:${code}`));
      socket.once('error', () => resolve('error'));
    });

    expect(outcome).toBe('closed:4401');
  });
});
