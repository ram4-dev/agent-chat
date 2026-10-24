import { runNativeReceiver } from './native/receiver.js';
import { runReceiver } from './receiver.js';
const groups: string[] = [];
let state = '.local-state/bridge';
let nativeAdapter: string | undefined;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--native-adapter' && process.argv[i + 1]) nativeAdapter = process.argv[++i]!;
  else if (process.argv[i] === '--group' && process.argv[i + 1]) groups.push(process.argv[++i]!);
  else if (process.argv[i] === '--state' && process.argv[i + 1]) state = process.argv[++i]!;
  else throw new Error('Usage: receiver --group GROUP_ID [--group GROUP_ID] [--state DIRECTORY]');
}
try { if (nativeAdapter) { if (groups.length) throw new Error('Native groups come from owner consent'); await runNativeReceiver(nativeAdapter, state); } else await runReceiver(groups, state); }
catch { console.error('Receiver stopped. Check its configured runtime, MCP connection and durable state.'); process.exitCode = 1; }
