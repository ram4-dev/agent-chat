import { probeCodex } from './codex/probe.js';

try {
  const report = await probeCodex();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  // Diagnostic completed successfully, but the activation gate is still closed.
  process.exitCode = 2;
} catch {
  // Subprocess errors can carry stderr, commands and environment. Do not print them.
  process.stderr.write('Codex capability probe failed; automatic processing remains disabled.\n');
  process.exitCode = 1;
}
