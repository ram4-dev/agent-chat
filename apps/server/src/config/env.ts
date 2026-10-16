import { isAbsolute, resolve } from 'node:path';
import { MIGRATIONS_DIRECTORY } from '@agent-chat/contracts';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface RuntimeConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  logLevel: LogLevel;
  /** Absolute path of the SQLite file. */
  databasePath: string;
  /** Absolute path of the numbered migration directory. */
  migrationsDir: string;
  /** Absolute path of the built web client. */
  webDistDir: string;
  /** Bounded wait for the SQLite write lock before a write fails closed. */
  busyTimeoutMs: number;
  /**
   * The bare origin the authorization server publishes as its issuer.
   *
   * It must carry no path: a path-bearing issuer makes the provider publish
   * endpoints under that path while still expecting them at the root.
   */
  publicOrigin: string;
  /** Optional JWKS file. Without one, local runs generate signing keys. */
  oidcJwksPath?: string;
}

export interface ReadConfigInput {
  env: Record<string, string | undefined>;
  /** Repository root used to resolve relative paths from the environment. */
  repoRoot: string;
}

export const CONFIG_DEFAULTS = {
  nodeEnv: 'development',
  host: '127.0.0.1',
  port: 4318,
  logLevel: 'info',
  databasePath: '.local-state/agent-chat.db',
  migrationsDir: MIGRATIONS_DIRECTORY,
  webDistDir: 'apps/web/dist',
  busyTimeoutMs: 5000,
} as const satisfies Record<string, string | number>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Turns raw environment variables into a validated runtime configuration.
 *
 * Every failure names the offending variable so a misconfigured deployment
 * fails before the server accepts traffic.
 */
export function readConfig({ env, repoRoot }: ReadConfigInput): RuntimeConfig {
  return {
    nodeEnv: readEnum(
      'NODE_ENV',
      env['NODE_ENV'],
      NODE_ENVIRONMENTS,
      CONFIG_DEFAULTS.nodeEnv,
    ),
    host: readText('HOST', env['HOST'], CONFIG_DEFAULTS.host),
    port: readInteger('PORT', env['PORT'], CONFIG_DEFAULTS.port, 1, 65_535),
    logLevel: readEnum(
      'LOG_LEVEL',
      env['LOG_LEVEL'],
      LOG_LEVELS,
      CONFIG_DEFAULTS.logLevel,
    ),
    databasePath: resolveFromRoot(
      repoRoot,
      readText('DATABASE_PATH', env['DATABASE_PATH'], CONFIG_DEFAULTS.databasePath),
    ),
    migrationsDir: resolveFromRoot(
      repoRoot,
      readText('MIGRATIONS_DIR', env['MIGRATIONS_DIR'], CONFIG_DEFAULTS.migrationsDir),
    ),
    webDistDir: resolveFromRoot(
      repoRoot,
      readText('WEB_DIST_DIR', env['WEB_DIST_DIR'], CONFIG_DEFAULTS.webDistDir),
    ),
    busyTimeoutMs: readInteger(
      'SQLITE_BUSY_TIMEOUT_MS',
      env['SQLITE_BUSY_TIMEOUT_MS'],
      CONFIG_DEFAULTS.busyTimeoutMs,
      1,
      60_000,
    ),
    publicOrigin: readPublicOrigin(
      env['PUBLIC_ORIGIN'],
      readText('HOST', env['HOST'], CONFIG_DEFAULTS.host),
      readInteger('PORT', env['PORT'], CONFIG_DEFAULTS.port, 1, 65_535),
    ),
    ...optionalText('oidcJwksPath', 'OIDC_JWKS_PATH', env['OIDC_JWKS_PATH']),
  };
}

/**
 * Resolves the issuer origin.
 *
 * An explicit value wins, and it is validated to be a bare origin so a
 * misconfiguration fails at startup instead of producing an issuer whose
 * published endpoints do not resolve.
 */
function readPublicOrigin(
  raw: string | undefined,
  host: string,
  port: number,
): string {
  if (raw === undefined) {
    return `http://${host}:${port}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`Invalid PUBLIC_ORIGIN: expected an absolute URL, received ${JSON.stringify(raw)}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`Invalid PUBLIC_ORIGIN: expected http or https, received ${JSON.stringify(raw)}`);
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new ConfigError(
      `Invalid PUBLIC_ORIGIN: the issuer must be a bare origin with no path, received ${JSON.stringify(raw)}`,
    );
  }

  return parsed.origin;
}

/** Omits the key entirely when unset, which keeps optional config honest. */
function optionalText<K extends string>(
  field: K,
  _envName: string,
  raw: string | undefined,
): Partial<Record<K, string>> {
  if (raw === undefined || raw.trim() === '') {
    return {};
  }
  return { [field]: raw.trim() } as Record<K, string>;
}

function readText(name: string, raw: string | undefined, fallback: string): string {
  if (raw === undefined) {
    return fallback;
  }
  if (raw.trim() === '') {
    throw new ConfigError(`Invalid ${name}: expected a non-empty value`);
  }
  return raw;
}

function readInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(
      `Invalid ${name}: expected an integer between ${min} and ${max}, received ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

function readEnum<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw === undefined) {
    return fallback;
  }
  if (!allowed.includes(raw as T)) {
    throw new ConfigError(
      `Invalid ${name}: expected one of ${allowed.join(', ')}, received ${JSON.stringify(raw)}`,
    );
  }
  return raw as T;
}

function resolveFromRoot(repoRoot: string, value: string): string {
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}
