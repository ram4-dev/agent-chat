import { fileURLToPath } from 'node:url';
import { readConfig, type RuntimeConfig } from './env.js';

/**
 * Repository root, derived from this module's own location. Both
 * `apps/server/src/config` and `apps/server/dist/config` sit four levels below
 * the root, so the same expression is correct before and after a build.
 */
export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Reads the process environment, defaulting to the repository root. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  return readConfig({ env, repoRoot: REPOSITORY_ROOT });
}

export {
  CONFIG_DEFAULTS,
  ConfigError,
  LOG_LEVELS,
  NODE_ENVIRONMENTS,
  readConfig,
  type LogLevel,
  type NodeEnvironment,
  type ReadConfigInput,
  type RuntimeConfig,
} from './env.js';
