import base from './playwright.config';
import { defineConfig } from '@playwright/test';
process.env['MANAGED_E2E'] = '1';

export default defineConfig({
  ...base,
  // These suites exercise the SQLite-only native/legacy execution backend.
  // They run in the default full E2E suite, separately from Supabase mode.
  testIgnore: ['**/automation.spec.ts', '**/native-*.spec.ts', '**/grok-notifications.spec.ts', '**/hermes-*.spec.ts'],
  // Supabase is this repository's disposable local project. Never reset a linked cloud project.
  webServer: process.env['AGENT_CHAT_E2E_BASE_URL'] ? undefined : {
    ...base.webServer!,
    command: 'supabase db reset --local && pnpm build && node --env-file=.local-state/managed.env apps/server/dist/main.js',
  },
});
