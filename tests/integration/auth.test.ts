import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_LIMITS,
  AUTH_PATHS,
  DOMAIN_ERROR_CODES,
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

/** A plausible same-origin pair; the guard rejects a state change without it. */
const ORIGIN = 'http://127.0.0.1:4318';
const HOST = '127.0.0.1:4318';

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createWebDistFixture(): string {
  const webDistDir = temporaryDirectory('agent-chat-auth-web-');
  mkdirSync(join(webDistDir, 'assets'));
  writeFileSync(
    join(webDistDir, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
    'utf8',
  );
  return webDistDir;
}

async function startHarness(): Promise<Harness> {
  const database = createDatabase({
    path: join(temporaryDirectory('agent-chat-auth-'), 'auth.db'),
    busyTimeoutMs: 1000,
  });
  migrateFromDirectory(database.sqlite, join(REPOSITORY_ROOT, MIGRATIONS_DIRECTORY));

  const config = readConfig({
    repoRoot: REPOSITORY_ROOT,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', WEB_DIST_DIR: createWebDistFixture() },
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

const credentials = {
  email: 'person@example.com',
  displayName: 'Ada Lovelace',
  password: 'a-sufficiently-long-password',
};

function register(harness: Harness, body: unknown = credentials) {
  return harness.app.inject({
    method: 'POST',
    url: AUTH_PATHS.register,
    headers: { origin: ORIGIN, host: HOST },
    payload: body as object,
  });
}

function login(harness: Harness, body: unknown) {
  return harness.app.inject({
    method: 'POST',
    url: AUTH_PATHS.login,
    headers: { origin: ORIGIN, host: HOST },
    payload: body as object,
  });
}

function me(harness: Harness, cookie?: string) {
  return harness.app.inject({
    method: 'GET',
    url: AUTH_PATHS.me,
    headers: cookie === undefined ? {} : { cookie },
  });
}

/** Extracts the `name=value` pair a browser would send back. */
function sessionCookieOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') {
    throw new Error('The response did not set a session cookie');
  }
  return value.split(';')[0]!;
}

describe('POST /api/auth/register', () => {
  it('creates the account, sets an HttpOnly SameSite cookie, and returns no secret', async () => {
    const harness = await startHarness();

    const response = await register(harness);

    expect(response.statusCode).toBe(201);
    const body: Record<string, unknown> = response.json();
    expect(body['user']).toEqual({
      id: expect.any(String),
      email: 'person@example.com',
      displayName: 'Ada Lovelace',
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain('password');

    const setCookie = response.headers['set-cookie'];
    const cookieText = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(cookieText).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookieText).toContain('HttpOnly');
    expect(cookieText).toContain('SameSite=Lax');
    expect(cookieText).not.toContain('Secure');

    const stored = harness.database.sqlite
      .prepare('SELECT id, password_hash FROM users WHERE email = ?')
      .get('person@example.com') as { id: string; password_hash: string };
    expect(stored.password_hash).toMatch(/^\$argon2id\$/);
    // The cookie value must not be the stored row: only its hash is persisted.
    expect(sessionCookieOf(response)).not.toContain(stored.id);
  });

  it('answers a duplicate address, regardless of casing, with the shared conflict code', async () => {
    const harness = await startHarness();
    await register(harness);

    const response = await register(harness, {
      ...credentials,
      email: '  Person@Example.COM ',
      displayName: 'Someone Else',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.conflict } });
    const count = harness.database.sqlite
      .prepare('SELECT COUNT(*) AS total FROM users')
      .get() as { total: number };
    expect(count.total).toBe(1);
  });

  it.each([
    [{ ...credentials, email: 'not-an-email' }, 'malformed address'],
    [{ ...credentials, displayName: '   ' }, 'blank display name'],
    [{ ...credentials, password: 'short' }, 'password below the shared minimum'],
    [{ email: 'person@example.com' }, 'missing fields'],
  ])('rejects %j (%s) without creating a row', async (body, _label) => {
    const harness = await startHarness();

    const response = await register(harness, body);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.invalid_input } });
    const count = harness.database.sqlite
      .prepare('SELECT COUNT(*) AS total FROM users')
      .get() as { total: number };
    expect(count.total).toBe(0);
  });
});

describe('POST /api/auth/login', () => {
  it('returns the same account for a differently cased address', async () => {
    const harness = await startHarness();
    const registered = (await register(harness)).json() as { user: unknown };

    const response = await login(harness, {
      email: ' PERSON@example.com ',
      password: credentials.password,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: registered.user });
  });

  it.each([
    [{ email: credentials.email, password: 'the-wrong-password' }, 'wrong password'],
    [{ email: 'missing@example.com', password: credentials.password }, 'unknown address'],
  ])('answers %j (%s) with one indistinguishable code', async (body) => {
    const harness = await startHarness();
    await register(harness);

    const response = await login(harness, body);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: DOMAIN_ERROR_CODES.unauthenticated },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('GET /api/auth/me', () => {
  it('resolves the session behind the cookie', async () => {
    const harness = await startHarness();
    const registered = await register(harness);
    const expected = registered.json().user;

    const response = await me(harness, sessionCookieOf(registered));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: expected });
  });

  it.each([
    [undefined, 'no cookie'],
    [`${SESSION_COOKIE_NAME}=not-a-token`, 'a malformed token'],
    [`${SESSION_COOKIE_NAME}=${'a'.repeat(43)}`, 'a well-formed but unknown token'],
  ])('refuses %j (%s)', async (cookie, _label) => {
    const harness = await startHarness();

    const response = await me(harness, cookie);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: DOMAIN_ERROR_CODES.unauthenticated },
    });
  });

  it('refuses a session whose inactivity window has closed', async () => {
    const harness = await startHarness();
    const registered = await register(harness);
    const cookie = sessionCookieOf(registered);
    const token = cookie.slice(`${SESSION_COOKIE_NAME}=`.length);

    harness.database.sqlite
      .prepare(
        `UPDATE human_sessions
            SET expires_at = ?
          WHERE id = (
            SELECT id FROM human_sessions ORDER BY created_at DESC LIMIT 1
          )`,
      )
      .run(new Date(Date.now() - 1000).toISOString());

    const response = await me(harness, cookie);

    expect(response.statusCode).toBe(401);
    // The row is still there; the session is simply no longer usable.
    const rows = harness.database.sqlite
      .prepare('SELECT COUNT(*) AS total FROM human_sessions')
      .get() as { total: number };
    expect(rows.total).toBe(1);
    expect(token).toHaveLength(43);
  });

  it('extends the inactivity window on every successful use', async () => {
    const harness = await startHarness();
    const registered = await register(harness);
    const cookie = sessionCookieOf(registered);

    // Shrink the window to a value that is still usable but far from the full
    // one, so a successful use has to move it forward.
    const shrunk = new Date(Date.now() + 1000).toISOString();
    harness.database.sqlite
      .prepare('UPDATE human_sessions SET expires_at = ?')
      .run(shrunk);

    expect((await me(harness, cookie)).statusCode).toBe(200);

    const after = harness.database.sqlite
      .prepare('SELECT expires_at FROM human_sessions LIMIT 1')
      .get() as { expires_at: string };

    expect(Date.parse(after.expires_at)).toBeGreaterThan(Date.parse(shrunk));
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session immediately and clears the cookie', async () => {
    const harness = await startHarness();
    const registered = await register(harness);
    const cookie = sessionCookieOf(registered);

    const response = await harness.app.inject({
      method: 'POST',
      url: AUTH_PATHS.logout,
      headers: { origin: ORIGIN, host: HOST, cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    const cleared = response.headers['set-cookie'];
    const clearedText = Array.isArray(cleared) ? cleared.join(';') : String(cleared);
    expect(clearedText).toContain('Max-Age=0');

    expect((await me(harness, cookie)).statusCode).toBe(401);
  });

  it('is idempotent and never needs a valid session', async () => {
    const harness = await startHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: AUTH_PATHS.logout,
      headers: { origin: ORIGIN, host: HOST },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('same-origin guard', () => {
  it.each([
    [undefined, 'no Origin header'],
    ['http://evil.example', 'a foreign origin'],
  ])('rejects a state-changing request with %s (%s)', async (origin, _label) => {
    const harness = await startHarness();
    const headers: Record<string, string> = { host: HOST };
    if (origin !== undefined) {
      headers['origin'] = origin;
    }

    const response = await harness.app.inject({
      method: 'POST',
      url: AUTH_PATHS.login,
      headers,
      payload: { email: credentials.email, password: credentials.password },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: DOMAIN_ERROR_CODES.forbidden } });
  });

  it('leaves read routes untouched', async () => {
    const harness = await startHarness();

    expect((await me(harness)).statusCode).toBe(401);
  });
});

describe('session storage', () => {
  it('keeps the shared inactivity window and never stores a raw token', async () => {
    const harness = await startHarness();
    const registered = await register(harness);
    const token = sessionCookieOf(registered).slice(`${SESSION_COOKIE_NAME}=`.length);

    const row = harness.database.sqlite
      .prepare('SELECT id, expires_at FROM human_sessions LIMIT 1')
      .get() as { id: string; expires_at: string };

    expect(row.id).not.toBe(token);
    expect(row.id).toHaveLength(64);
    const expectedTtlMs = AUTH_LIMITS.HUMAN_SESSION_INACTIVITY_SECONDS * 1000;
    expect(Date.parse(row.expires_at) - Date.now()).toBeLessThanOrEqual(expectedTtlMs);
    expect(Date.parse(row.expires_at) - Date.now()).toBeGreaterThan(expectedTtlMs - 60_000);
  });
});
