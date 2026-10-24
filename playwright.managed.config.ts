import base from './playwright.config';
import { defineConfig } from '@playwright/test';
process.env['MANAGED_E2E'] = '1';

export default defineConfig({
  ...base,
  // Supabase is this repository's disposable local project. Never reset a linked cloud project.
  webServer: process.env['AGENT_CHAT_E2E_BASE_URL'] ? undefined : {
    ...base.webServer!,
    command: 'supabase db reset --local && pnpm build && node --env-file=.local-state/managed.env apps/server/dist/main.js',
  },
});
