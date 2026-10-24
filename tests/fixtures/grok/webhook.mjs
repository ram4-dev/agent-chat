import { URL } from 'node:url';
import { setInterval, clearInterval } from 'node:timers';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { createHash, sign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import Database from '../../../apps/bridge/node_modules/better-sqlite3/lib/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { nativeProofPayload, nativeResultPayload } from '../../../packages/contracts/dist/index.js';
console.log(JSON.stringify({ fixturePid: process.pid }));
const db = new Database(process.env.GROK_FIXTURE_DB);
db.pragma('synchronous=FULL'); db.pragma('journal_mode=WAL');
db.exec('CREATE TABLE IF NOT EXISTS requests(start_key TEXT,body TEXT); CREATE TABLE IF NOT EXISTS runs(start_key TEXT PRIMARY KEY,wake TEXT NOT NULL,result TEXT,proof TEXT,done INTEGER NOT NULL DEFAULT 0)');
const client = new Client({ name: 'synthetic-grok-webhook', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', process.env.AGENT_CHAT_MCP_URL), { requestInit: { headers: { authorization: `Bearer ${process.env.AGENT_CHAT_MCP_TOKEN}` } } }));
async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error('Fixture native operation refused');
  return JSON.parse(response.content[0].text);
}
let working; let stopping = false;
async function processWake() {
  if (stopping || working || !existsSync(process.env.GROK_FIXTURE_RELEASE)) return;
  working = (async () => {
    const row = db.prepare('SELECT * FROM runs WHERE done=0 LIMIT 1').get(); if (!row) return;
    const wake = JSON.parse(row.wake);
    const d = await call('native_delivery', { eventId: wake.eventId });
    if (d.receipt) { db.prepare('UPDATE runs SET done=1 WHERE start_key=?').run(wake.startKey); return; }
    if (d.targetId !== wake.targetId || d.bindingId !== wake.bindingId || d.bindingRevision !== wake.revision || d.startKey !== wake.startKey || !d.started) throw new Error('Wrong fixture wake');
    let result; let proof;
    if (!row.result) {
      await call('native_grok_begin', { ticket: d.ticket, startKey: wake.startKey });
      result = { decision: d.incoming.text === 'SILENCIO' ? 'no_reply' : 'reply', text: d.incoming.text === 'SILENCIO' ? '' : `Grok simulado: ${d.incoming.text}`, conversationRef: d.conversationRef ?? `bot:${d.bindingId}:${d.groupId}` };
      const data = { eventId: wake.eventId, targetId: wake.targetId, startKey: wake.startKey, runRef: `webhook:${wake.startKey}`, terminal: 'completed', resultHash: createHash('sha256').update(nativeResultPayload(result)).digest('hex') };
      proof = { data, signature: sign(null, Buffer.from(nativeProofPayload(data)), readFileSync(process.env.GROK_FIXTURE_SIGNER)).toString('base64url') };
      // The fake native provider commits its terminal outcome before callback, independently of the controller.
      db.prepare('UPDATE runs SET result=?,proof=? WHERE start_key=?').run(JSON.stringify(result), JSON.stringify(proof), wake.startKey);
    } else { result = JSON.parse(row.result); proof = JSON.parse(row.proof); }
    const current = await call('native_delivery', { eventId: wake.eventId });
    if (!current.receipt) {
      await call('native_save', { ticket: current.ticket, result, proof });
      // Same callback delivered twice must not duplicate the result/publication.
      await call('native_save', { ticket: current.ticket, result, proof });
    }
    db.prepare('UPDATE runs SET done=1 WHERE start_key=?').run(wake.startKey);
  })();
  try { await working; } catch { /* Keep the durable outcome and retry callback/reconcile only, never generation. */ }
  finally { working = undefined; }
}
const timer = setInterval(() => { void processWake(); }, 100);
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${process.env.GROK_FIXTURE_WAKE_TOKEN}`) { res.writeHead(403); res.end(); return; }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error('Too large'); chunks.push(chunk); }
    const wake = JSON.parse(Buffer.concat(chunks).toString());
    if (Object.keys(wake).sort().join(',') !== 'bindingId,eventId,revision,startKey,targetId,version' || wake.version !== 1) throw new Error('Wrong fixture envelope');
    db.transaction(() => { db.prepare('INSERT INTO requests VALUES(?,?)').run(wake.startKey, JSON.stringify(wake)); db.prepare('INSERT OR IGNORE INTO runs(start_key,wake) VALUES(?,?)').run(wake.startKey, JSON.stringify(wake)); }).immediate();
    res.writeHead(200); res.end();
  } catch { res.writeHead(400); res.end(); }
});
server.listen(Number(process.env.PORT), process.env.HOST ?? '127.0.0.1');
process.once('SIGTERM', () => { stopping = true; clearInterval(timer); server.closeAllConnections(); server.close(); void (async () => { await working; await client.close(); db.close(); })(); });
