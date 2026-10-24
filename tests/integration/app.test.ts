import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DOMAIN_ERROR_CODES, LIVENESS_PATH, MIGRATIONS_DIRECTORY } from '@agent-chat/contracts';
import { createApp } from '../../apps/server/src/app';
import { readConfig } from '../../apps/server/src/config/env';
import { REPOSITORY_ROOT } from '../../apps/server/src/config/index';
import {
  createDatabase,
  type DatabaseHandle,
} from '../../apps/server/src/persistence/client';
import { migrateFromDirectory } from '../../apps/server/src/persistence/migrate';

interface RunningApp {
  baseUrl: string;
  database: DatabaseHandle;
  close(): Promise<void>;
}

const temporaryDirectories: string[] = [];
const runningApps: RunningApp[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createWebDistFixture(): string {
  const webDistDir = temporaryDirectory('agent-chat-web-');
  mkdirSync(join(webDistDir, 'assets'));
  writeFileSync(
    join(webDistDir, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
    'utf8',
  );
  writeFileSync(join(webDistDir, 'assets', 'index-abc123.js'), 'console.log("shell");', 'utf8');
  return webDistDir;
}

async function startApp(): Promise<RunningApp> {
  const database: DatabaseHandle = createDatabase({
    path: join(temporaryDirectory('agent-chat-app-'), 'app.db'),
    busyTimeoutMs: 1000,
  });
  migrateFromDirectory(database.sqlite, join(REPOSITORY_ROOT, MIGRATIONS_DIRECTORY));

  const config = readConfig({
    repoRoot: REPOSITORY_ROOT,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', WEB_DIST_DIR: createWebDistFixture() },
  });

  const app = await createApp({ config, database });
  await app.listen({ host: '127.0.0.1', port: 0 });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The test server did not bind a TCP port');
  }

  const running: RunningApp = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    database,
    close: async () => {
      await app.close();
      try {
        database.close();
      } catch {
        // The test may already have closed the connection on purpose.
      }
    },
  };
  runningApps.push(running);
  return running;
}

afterEach(async () => {
  while (runningApps.length > 0) {
    await runningApps.pop()?.close();
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('createApp', () => {
  it('answers the shared liveness path with the contract body', async () => {
    const app = await startApp();

    const response = await fetch(`${app.baseUrl}${LIVENESS_PATH}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('serves the built web shell and its assets from the same origin', async () => {
    const app = await startApp();

    const shell = await fetch(`${app.baseUrl}/`);
    expect(shell.status).toBe(200);
    expect(shell.headers.get('content-type')).toContain('text/html');
    expect(await shell.text()).toContain('<div id="root"></div>');

    const asset = await fetch(`${app.baseUrl}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(await asset.text()).toBe('console.log("shell");');
  });

  it('answers an unknown path with the shared not_found code', async () => {
    const app = await startApp();

    const response = await fetch(`${app.baseUrl}/assets/does-not-exist.js`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: DOMAIN_ERROR_CODES.not_found },
    });
  });

  it('refuses a path that tries to leave the built client directory', async () => {
    const app = await startApp();

    const response = await fetch(
      `${app.baseUrl}/assets/%2e%2e%2f%2e%2e%2fpackage.json`,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: DOMAIN_ERROR_CODES.not_found },
    });
  });

  it('answers a request that cannot reach the database with a stable contract code', async () => {
    const app = await startApp();
    app.database.close();

    const response = await fetch(`${app.baseUrl}${LIVENESS_PATH}`);
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: DOMAIN_ERROR_CODES.temporarily_unavailable },
    });
    expect(JSON.stringify(body)).not.toContain('database connection');
  });
});
