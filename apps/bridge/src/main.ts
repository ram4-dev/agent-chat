import { runReceiver } from './receiver.js';
const groups: string[] = [];
let state = '.local-state/bridge';
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--group' && process.argv[i + 1]) groups.push(process.argv[++i]!);
  else if (process.argv[i] === '--state' && process.argv[i + 1]) state = process.argv[++i]!;
  else throw new Error('Usage: receiver --group GROUP_ID [--group GROUP_ID] [--state DIRECTORY]');
}
try { await runReceiver(groups, state); }
catch { console.error('Receiver could not start. Check Codex login, MCP connection and local state.'); process.exitCode = 1; }
