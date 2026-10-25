import {defineConfig,devices} from '@playwright/test';
const origin=process.env['AGENT_CHAT_CLOUD_ORIGIN'];
if(!origin||new URL(origin).protocol!=='https:')throw new Error('Set the explicit HTTPS QA target');
export default defineConfig({
 outputDir:'.local-state/cloud/artifacts',
 testDir:'./tests/cloud',testMatch:'**/*.cloud.spec.ts',workers:1,retries:0,
 // The real Supabase fallback scheduler runs once per minute; include cold starts and HTTPS ingress.
 timeout:240000,expect:{timeout:15000},reporter:[['list']],
 use:{...devices['Desktop Chrome'],baseURL:origin,...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']?{launchOptions:{executablePath:process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']}}:{})},
});
