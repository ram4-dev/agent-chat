import process from 'node:process';
import { Buffer } from 'node:buffer';
// Test-only runtime. Native provider state is separate from controller state.
import Database from '../../../apps/bridge/node_modules/better-sqlite3/lib/index.js';
import { createHash, sign } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { nativeProofPayload, nativeResultPayload } from '../../../packages/contracts/dist/index.js';
export async function createNativeRuntime() {
  const config = JSON.parse(readFileSync(process.env.NATIVE_FIXTURE_CONFIG, 'utf8'));
  const db = new Database(config.providerDb);
  db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL');
  db.exec('CREATE TABLE IF NOT EXISTS runs(start_key TEXT PRIMARY KEY,run_ref TEXT,result TEXT,proof TEXT,conversation_ref TEXT)');
  return {
    async describe() { return { targetId: config.targetId, durableResults: true, observeByStartKey: true, cancel: false, approvals: true }; },
    async start({ delivery, trustedInbound }) {
      if (trustedInbound !== false) throw new Error('Inbound must remain untrusted');
      const input = delivery.incoming?.text ?? '';
      const result = { decision: input === 'SILENCIO' ? 'no_reply' : 'reply', text: input === 'SILENCIO' ? '' : `Nativo: ${input}`, conversationRef: delivery.conversationRef ?? `thread:${delivery.bindingId}:${delivery.groupId}` };
      const runRef = `run:${delivery.startKey}`;
      const data = { eventId: delivery.ticket.eventId, targetId: delivery.targetId, startKey: delivery.startKey, runRef, terminal: 'completed', resultHash: createHash('sha256').update(nativeResultPayload(result)).digest('hex') };
      const proof = { data, signature: sign(null, Buffer.from(nativeProofPayload(data)), readFileSync(config.keyFile)).toString('base64url') };
      db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run(delivery.startKey, runRef, JSON.stringify(result), JSON.stringify(proof), result.conversationRef);
      if (config.crashMarker && !existsSync(config.crashMarker)) { writeFileSync(config.crashMarker, 'crashed'); process.exit(42); }
      return { runRef };
    },
    async observe(query) {
      const row = db.prepare('SELECT proof FROM runs WHERE start_key=?').get(query.startKey);
      return row ? { state: 'terminal', proof: JSON.parse(row.proof) } : { state: 'unknown' };
    },
    async recoverResult(query) { return JSON.parse(db.prepare('SELECT result FROM runs WHERE start_key=?').get(query.startKey).result); },
    async close() { db.close(); },
  };
}
