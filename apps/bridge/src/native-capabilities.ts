import { probeNativeProfile } from './codex/native-profile-probe.js';

try {
  const codex = await probeNativeProfile();
  console.log(JSON.stringify({ codex, hermes: { verified: false }, grokBot: { verified: false }, automaticActivationAllowed: false }));
} catch (error) {
  const cause = error instanceof Error ? error.cause : undefined;
  if (typeof cause === 'object' && cause !== null && 'profileSelected' in cause) console.error(JSON.stringify(cause));
  console.error('Native capability probe failed; automatic activation remains disabled');
  process.exitCode = 1;
}
