import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { createDatabase, migrateFromDirectory } from './persistence/index.js';

/**
 * Production entrypoint: open the database, apply migrations, then accept
 * traffic. A failed migration prevents startup, and shutdown closes both the
 * server and the database before the process exits.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  mkdirSync(dirname(config.databasePath), { recursive: true });

  const database = createDatabase({
    path: config.databasePath,
    busyTimeoutMs: config.busyTimeoutMs,
  });
  const app = await createApp({ config, database });

  try {
    const migrations = migrateFromDirectory(database.sqlite, config.migrationsDir);
    app.log.info(
      { applied: migrations.applied, skipped: migrations.skipped },
      'database migrations resolved',
    );
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    database.close();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => database.close())
      .then(() => {
        process.exit(0);
      });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

await main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
