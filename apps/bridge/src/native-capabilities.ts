import { probeNativeProfile } from './codex/native-profile-probe.js';

const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGTERM', cancel);
process.once('SIGINT', cancel);
process.once('disconnect', cancel);
try {
  const codex = await probeNativeProfile({ signal: controller.signal });
  console.log(JSON.stringify({ codex, hermes: { verified: false }, grokBot: { verified: false }, automaticActivationAllowed: false }));
} catch (error) {
  const cause = error instanceof Error ? error.cause : undefined;
  if (typeof cause === 'object' && cause !== null && 'profileSelected' in cause) console.error(JSON.stringify(cause));
  console.error('Native capability probe failed; automatic activation remains disabled');
  process.exitCode = 1;
} finally {
  process.removeListener('SIGTERM', cancel);
  process.removeListener('SIGINT', cancel);
  process.removeListener('disconnect', cancel);
}
