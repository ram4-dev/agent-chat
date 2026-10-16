import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../../apps/server/src/config/env';

const repoRoot = '/repo';

describe('readConfig', () => {
  it('applies the documented defaults when the environment is empty', () => {
    expect(readConfig({ env: {}, repoRoot })).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      // The issuer is derived from host and port when it is not given, because
      // a path-bearing issuer breaks the authorization server's own endpoints.
      publicOrigin: 'http://127.0.0.1:4318',
      port: 4318,
      logLevel: 'info',
      databasePath: resolve(repoRoot, '.local-state/agent-chat.db'),
      migrationsDir: resolve(repoRoot, 'db/migrations'),
      webDistDir: resolve(repoRoot, 'apps/web/dist'),
      busyTimeoutMs: 5000,
    });
  });

  it('reads explicit values and resolves relative paths against the repository root', () => {
    const config = readConfig({
      repoRoot,
      env: {
        NODE_ENV: 'test',
        HOST: '0.0.0.0',
        PORT: '4555',
        LOG_LEVEL: 'silent',
        DATABASE_PATH: 'tmp/e2e.db',
        MIGRATIONS_DIR: 'db/other',
        WEB_DIST_DIR: 'apps/web/build',
        SQLITE_BUSY_TIMEOUT_MS: '250',
      },
    });

    expect(config).toEqual({
      nodeEnv: 'test',
      host: '0.0.0.0',
      publicOrigin: 'http://0.0.0.0:4555',
      port: 4555,
      logLevel: 'silent',
      databasePath: resolve(repoRoot, 'tmp/e2e.db'),
      migrationsDir: resolve(repoRoot, 'db/other'),
      webDistDir: resolve(repoRoot, 'apps/web/build'),
      busyTimeoutMs: 250,
    });
  });

  it('keeps absolute paths untouched', () => {
    const config = readConfig({
      repoRoot,
      env: { DATABASE_PATH: '/var/lib/agent-chat/app.db' },
    });

    expect(config.databasePath).toBe('/var/lib/agent-chat/app.db');
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', 'port'],
    ['PORT', ''],
    ['SQLITE_BUSY_TIMEOUT_MS', '-1'],
    ['SQLITE_BUSY_TIMEOUT_MS', 'soon'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'chatty'],
    ['HOST', ''],
  ])('rejects an invalid %s', (key, value) => {
    expect(() => readConfig({ repoRoot, env: { [key]: value } })).toThrowError(
      new RegExp(key),
    );
  });
});
