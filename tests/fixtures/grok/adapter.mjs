import process from 'node:process';
import { readFileSync } from 'node:fs';
import { createGrokRuntime } from '../../../apps/bridge/dist/native/grok.js';
// Test-only composition root: only the outbound transport is replaced with an owned local HTTP fixture.
// Production createNativeRuntime always constructs the public HTTPS/DNS-pinned transport.
export async function createNativeRuntime(directory) {
  const config = JSON.parse(readFileSync(process.env.GROK_FIXTURE_CONFIG, 'utf8'));
  return createGrokRuntime(config.selection, directory, { async notify(wake, signal) {
    const response = await globalThis.fetch(config.fixtureUrl, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROK_FIXTURE_WAKE_TOKEN}` }, body: JSON.stringify(wake) });
    return response.status;
  } });
}
