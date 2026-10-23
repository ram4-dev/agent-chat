import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const port = 4319;
const externalOrigin = process.env['AGENT_CHAT_E2E_BASE_URL'];

/**
 * The real-route check boots the production server entrypoint against a fresh
 * temporary SQLite database, so the built web client and the API are served
 * from one origin exactly as they are in production.
 */
const databasePath = `.local-state/e2e/e2e-${Date.now()}.db`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: externalOrigin ?? `http://${host}:${port}`,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: externalOrigin ? undefined : {
    command: 'pnpm build && node apps/server/dist/main.js',
    url: `http://${host}:${port}/liveness`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
    env: {
      HOST: host,
      PORT: String(port),
      LOG_LEVEL: 'warn',
      DATABASE_PATH: databasePath,
      WEB_DIST_DIR: 'apps/web/dist',
      MIGRATIONS_DIR: 'db/migrations',
    },
  },
});
