import { describe, expect, it } from 'vitest';
import {
  DOMAIN_ERROR_CODES,
  INITIAL_MIGRATION_FILE,
  INITIAL_MIGRATION_ID,
  LIMITS,
  LIVENESS_PATH,
  MIGRATIONS_DIRECTORY,
  MIGRATIONS_LEDGER_TABLE,
} from '@agent-chat/contracts';
import {
  DOMAIN_ERROR_CODES as serverErrorCodes,
  errorEnvelope,
} from '../../apps/server/src/adapters/http/index';
import { CONFIG_DEFAULTS } from '../../apps/server/src/config/index';

describe('shared limits', () => {
  it('pins every value from the approved limits table', () => {
    expect(LIMITS).toEqual({
      MESSAGE_TEXT_BYTES: 8192,
      PAGE_SIZE_DEFAULT: 50,
      PAGE_SIZE_MAX: 100,
      BROWSER_SOCKETS_MAX_PER_SESSION: 5,
      AGENT_RECEIVER_SOCKETS_MAX_PER_CONNECTION: 2,
      WEBSOCKET_FRAME_BYTES: 65536,
      OAUTH_AUTHORIZATION_CODE_TTL_SECONDS: 300,
      ACCESS_TOKEN_TTL_SECONDS: 600,
      REFRESH_TOKEN_FAMILY_MAX_LIFETIME_DAYS: 30,
    });
  });
});

describe('shared error codes', () => {
  it('exposes exactly the stable public error codes', () => {
    expect(Object.values(DOMAIN_ERROR_CODES).sort()).toEqual([
      'conflict',
      'forbidden',
      'invalid_input',
      'not_found',
      'rate_limited',
      'temporarily_unavailable',
      'unauthenticated',
    ]);
  });
});

describe('migration and liveness constants', () => {
  it('names the ledger, directory, and initial migration shared by server and tests', () => {
    expect(MIGRATIONS_LEDGER_TABLE).toBe('schema_migrations');
    expect(MIGRATIONS_DIRECTORY).toBe('db/migrations');
    expect(INITIAL_MIGRATION_ID).toBe('0001_initial_mvp');
    expect(INITIAL_MIGRATION_FILE).toBe('0001_initial_mvp.sql');
  });

  it('exposes the single liveness path the web client polls', () => {
    expect(LIVENESS_PATH).toBe('/liveness');
  });
});

describe('server consumption of the shared contracts', () => {
  it('answers with the very same error code object the contracts package exports', () => {
    expect(serverErrorCodes).toBe(DOMAIN_ERROR_CODES);
  });

  it('builds its error envelope from those codes', () => {
    expect(errorEnvelope(serverErrorCodes.not_found)).toEqual({
      error: { code: 'not_found' },
    });
  });

  it('takes its default migration directory from the shared constant', () => {
    expect(CONFIG_DEFAULTS.migrationsDir).toBe(MIGRATIONS_DIRECTORY);
  });

  it('keeps every limit in one exported object', () => {
    expect(Object.getOwnPropertyNames(LIMITS)).toEqual([
      'MESSAGE_TEXT_BYTES',
      'PAGE_SIZE_DEFAULT',
      'PAGE_SIZE_MAX',
      'BROWSER_SOCKETS_MAX_PER_SESSION',
      'AGENT_RECEIVER_SOCKETS_MAX_PER_CONNECTION',
      'WEBSOCKET_FRAME_BYTES',
      'OAUTH_AUTHORIZATION_CODE_TTL_SECONDS',
      'ACCESS_TOKEN_TTL_SECONDS',
      'REFRESH_TOKEN_FAMILY_MAX_LIFETIME_DAYS',
    ]);
  });
});
