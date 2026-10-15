import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_PATHS,
  DOMAIN_ERROR_CODES,
  GROUP_PATHS,
  MIGRATIONS_DIRECTORY,
  SESSION_COOKIE_NAME,
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
  close(): Promise<void>;
}

const temporaryDirectories: string[] = [];
const harnesses: Harness[] = [];

const ORIGIN = 'http://127.0.0.1:4318';
const HOST = '127.0.0.1:4318';
const MUTATION_HEADERS = { origin: ORIGIN, host: HOST };

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function startHarness(): Promise<Harness> {
  const webDistDir = temporaryDirectory('agent-chat-groups-web-');
  mkdirSync(join(webDistDir, 'assets'), { recursive: true });
  writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');

  const database = createDatabase({
    path: join(temporaryDirectory('agent-chat-groups-'), 'groups.db'),
    busyTimeoutMs: 1000,
  });
  migrateFromDirectory(database.sqlite, join(REPOSITORY_ROOT, MIGRATIONS_DIRECTORY));

  const config = readConfig({
    repoRoot: REPOSITORY_ROOT,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', WEB_DIST_DIR: webDistDir },
  });

  const app = await createApp({ config, database });
  await app.ready();

  const harness: Harness = {
    app,
    database,
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

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') {
    throw new Error('The response did not set a session cookie');
  }
  return value.split(';')[0]!;
}

/** Registers a person and returns the cookie a browser would send back. */
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

function createGroup(harness: Harness, cookie: string, name: string) {
  return harness.app.inject({
    method: 'POST',
    url: GROUP_PATHS.collection,
    headers: { ...MUTATION_HEADERS, cookie },
    payload: { name },
  });
}

function readGroup(harness: Harness, cookie: string, groupId: string) {
  return harness.app.inject({
    method: 'GET',
    url: GROUP_PATHS.one(groupId),
    headers: { cookie },
  });
}

function invite(harness: Harness, cookie: string, groupId: string) {
  return harness.app.inject({
    method: 'POST',
    url: GROUP_PATHS.invitations(groupId),
    headers: { ...MUTATION_HEADERS, cookie },
  });
}

function accept(harness: Harness, cookie: string, token: string) {
  return harness.app.inject({
    method: 'POST',
    url: GROUP_PATHS.acceptInvitation,
    headers: { ...MUTATION_HEADERS, cookie },
    payload: { token },
  });
}

function removeMember(harness: Harness, cookie: string, groupId: string, memberId: string) {
  return harness.app.inject({
    method: 'DELETE',
    url: GROUP_PATHS.removeMember(groupId, memberId),
    headers: { ...MUTATION_HEADERS, cookie },
  });
}

describe('private groups', () => {
  it('makes the creator the first admin and lists the group only for its members', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const grace = await signUp(harness, 'grace@example.com', 'Grace');

    const created = await createGroup(harness, ada, '  Research  ');
    expect(created.statusCode).toBe(201);
    const group = created.json().group;
    expect(group.name).toBe('Research');
    expect(created.json().role).toBe('admin');

    const adasGroups = await harness.app.inject({
      method: 'GET',
      url: GROUP_PATHS.collection,
      headers: { cookie: ada },
    });
    expect(adasGroups.json().groups).toEqual([
      { id: group.id, name: 'Research', createdAt: group.createdAt, role: 'admin' },
    ]);

    const gracesGroups = await harness.app.inject({
      method: 'GET',
      url: GROUP_PATHS.collection,
      headers: { cookie: grace },
    });
    expect(gracesGroups.json()).toEqual({ groups: [] });
  });

  it('hides a private group from a non-member behind the same not_found code as an unknown id', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const grace = await signUp(harness, 'grace@example.com', 'Grace');
    const groupId: string = (await createGroup(harness, ada, 'Research')).json().group.id;

    const outsider = await readGroup(harness, grace, groupId);
    const unknown = await readGroup(harness, grace, 'does-not-exist');

    expect(outsider.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(outsider.json()).toEqual(unknown.json());
    expect(outsider.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.not_found } });
    expect(JSON.stringify(outsider.json())).not.toContain('Ada');
  });

  it('shows a member the member list with roles and the visible result of a removal', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const grace = await signUp(harness, 'grace@example.com', 'Grace');
    const groupId: string = (await createGroup(harness, ada, 'Research')).json().group.id;
    const token: string = (await invite(harness, ada, groupId)).json().token;
    await accept(harness, grace, token);

    const detail = await readGroup(harness, grace, groupId);

    expect(detail.statusCode).toBe(200);
    expect(detail.json().role).toBe('member');
    expect(
      detail.json().members.map((member: { displayName: string; role?: string }) => [
        member.displayName,
        member.role,
      ]),
    ).toEqual([
      ['Ada', 'admin'],
      ['Grace', 'member'],
    ]);

    const adaUserId = detail
      .json()
      .members.find((member: { displayName: string }) => member.displayName === 'Ada').id;
    expect((await removeMember(harness, ada, groupId, adaUserId)).json()).toEqual({
      error: { code: DOMAIN_ERROR_CODES.conflict },
    });
  });

  it('refuses every group route without a session', async () => {
    const harness = await startHarness();

    const response = await harness.app.inject({ method: 'GET', url: GROUP_PATHS.collection });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: DOMAIN_ERROR_CODES.unauthenticated },
    });
  });
});

describe('invitations', () => {
  it('lets an invited person join once and never again', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const grace = await signUp(harness, 'grace@example.com', 'Grace');
    const groupId: string = (await createGroup(harness, ada, 'Research')).json().group.id;

    const invitation = await invite(harness, ada, groupId);
    expect(invitation.statusCode).toBe(201);
    const { token, expiresAt } = invitation.json();
    expect(token).toHaveLength(43);
    // Only a hash reaches the database.
    const stored = harness.database.sqlite
      .prepare('SELECT token_hash FROM invitations LIMIT 1')
      .get() as { token_hash: string };
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token_hash).toHaveLength(64);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

    const accepted = await accept(harness, grace, token);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().role).toBe('member');
    expect((await readGroup(harness, grace, groupId)).statusCode).toBe(200);

    const reused = await accept(harness, grace, token);
    expect(reused.statusCode).toBe(404);
    expect(reused.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.not_found } });
  });

  it.each([
    ['an expired invitation', 0],
    ['an unknown token', -1],
  ])('refuses %s with the same not_found code', async (_label, mode) => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const grace = await signUp(harness, 'grace@example.com', 'Grace');
    const groupId: string = (await createGroup(harness, ada, 'Research')).json().group.id;
    const token: string = (await invite(harness, ada, groupId)).json().token;

    let presented = token;
    if (mode === 0) {
      harness.database.sqlite
        .prepare('UPDATE invitations SET expires_at = ?')
        .run(new Date(Date.now() - 1000).toISOString());
    } else {
      presented = 'x'.repeat(43);
    }

    const response = await accept(harness, grace, presented);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.not_found } });
  });

  it('lets only an admin invite, and answers a non-member as if the group did not exist', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const grace = await signUp(harness, 'grace@example.com', 'Grace');
    const ada2 = await signUp(harness, 'hopper@example.com', 'Hopper');
    const groupId: string = (await createGroup(harness, ada, 'Research')).json().group.id;
    await accept(harness, grace, (await invite(harness, ada, groupId)).json().token);

    const asMember = await invite(harness, grace, groupId);
    const asOutsider = await invite(harness, ada2, groupId);

    expect(asMember.statusCode).toBe(403);
    expect(asMember.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.forbidden } });
    expect(asOutsider.statusCode).toBe(404);
    expect(asOutsider.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.not_found } });
  });
});

describe('membership removal', () => {
  it('removes a plain member and denies them the group afterwards', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const grace = await signUp(harness, 'grace@example.com', 'Grace');
    const groupId: string = (await createGroup(harness, ada, 'Research')).json().group.id;
    await accept(harness, grace, (await invite(harness, ada, groupId)).json().token);

    const detail = await readGroup(harness, ada, groupId);
    const graceId = detail
      .json()
      .members.find((member: { displayName: string }) => member.displayName === 'Grace').id;

    const removed = await removeMember(harness, ada, groupId, graceId);

    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ status: 'ok' });
    expect((await readGroup(harness, grace, groupId)).statusCode).toBe(404);
    const remaining = await readGroup(harness, ada, groupId);
    expect(remaining.json().members).toHaveLength(1);
  });

  it('refuses to remove the last admin', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const groupId: string = (await createGroup(harness, ada, 'Research')).json().group.id;
    const adaId = (await readGroup(harness, ada, groupId)).json().members[0].id;

    const response = await removeMember(harness, ada, groupId, adaId);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.conflict } });
    expect((await readGroup(harness, ada, groupId)).statusCode).toBe(200);
  });

  it('refuses a plain member the removal of anyone', async () => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');
    const grace = await signUp(harness, 'grace@example.com', 'Grace');
    const groupId: string = (await createGroup(harness, ada, 'Research')).json().group.id;
    await accept(harness, grace, (await invite(harness, ada, groupId)).json().token);

    const adaId = (await readGroup(harness, grace, groupId))
      .json()
      .members.find((member: { displayName: string }) => member.displayName === 'Ada').id;

    const response = await removeMember(harness, grace, groupId, adaId);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.forbidden } });
  });
});

describe('group name validation', () => {
  it.each([
    [{ name: '   ' }, 'a blank name'],
    [{ name: 'x'.repeat(81) }, 'a name beyond the shared limit'],
    [{}, 'a missing name'],
  ])('rejects %j (%s) without creating a group', async (payload, _label) => {
    const harness = await startHarness();
    const ada = await signUp(harness, 'ada@example.com', 'Ada');

    const response = await harness.app.inject({
      method: 'POST',
      url: GROUP_PATHS.collection,
      headers: { ...MUTATION_HEADERS, cookie: ada },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.invalid_input } });
    const count = harness.database.sqlite
      .prepare('SELECT COUNT(*) AS total FROM groups')
      .get() as { total: number };
    expect(count.total).toBe(0);
  });

  it('names the session cookie the contracts package exports', async () => {
    const harness = await startHarness();
    const response = await harness.app.inject({
      method: 'POST',
      url: AUTH_PATHS.register,
      headers: MUTATION_HEADERS,
      payload: {
        email: 'ada@example.com',
        displayName: 'Ada',
        password: 'a-sufficiently-long-password',
      },
    });

    expect(cookieOf(response)).toContain(`${SESSION_COOKIE_NAME}=`);
  });
});
