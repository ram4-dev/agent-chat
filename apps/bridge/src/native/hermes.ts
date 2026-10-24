import Database from 'better-sqlite3';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeProofPayload, nativeResultPayload, type NativeDeliveryView, type NativeResult, type NativeTerminalProof } from '@agent-chat/contracts';
import { HermesRunsProbe, hermesRunFingerprint } from '../adapters/hermes-runs.js';
import type { NativeRunQuery, NativeRuntimePort } from './runtime.js';
interface Configuration { targetId: string; profileRef: string; origin: string; token: string; signingKey: string }
interface Saved { event_id: string; session_id: string; fingerprint: string; run_ref: string | null; result_json: string | null; proof_json: string | null }
function source(q: NativeRunQuery) {
  if (!q.incoming) throw new Error('Native incoming event unavailable');
  const author = { id: `agent-chat:${q.incoming.author.kind}:${q.incoming.author.id}`, name: `${q.incoming.author.kind}:${q.incoming.author.id}`, is_bot: q.incoming.author.kind === 'agent' };
  const input = JSON.stringify({ transport: 'agent-chat', trusted_inbound: false, binding_id: q.bindingId, group_id: q.groupId, event_id: q.eventId,
    author: { kind: q.incoming.author.kind, id: q.incoming.author.id }, text: q.incoming.text });
  const session = q.conversationRef ?? `agent-chat:${q.bindingId}:${q.groupId}:${q.conversationGeneration}`;
  return { author, input, session, fingerprint: hermesRunFingerprint(session, input, author) };
}
export async function createHermesRuntime(config: Configuration, directory: string): Promise<NativeRuntimePort> {
  if (!config.targetId || !/^[a-z][a-z0-9_-]{0,63}$/.test(config.profileRef) || !config.token) throw new Error('Explicit Hermes target/profile/credential required');
  const origin = new URL(config.origin);
  if (origin.username || origin.password || origin.search || origin.hash || !['http:','https:'].includes(origin.protocol)) throw new Error('Invalid Hermes origin');
  if (origin.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(origin.hostname) && !origin.hostname.endsWith('.localhost')) throw new Error('Remote Hermes requires HTTPS');
  const prefix = `/p/${encodeURIComponent(config.profileRef)}`;
  if (origin.pathname !== '/' && origin.pathname.replace(/\/$/, '') !== prefix) throw new Error('Hermes profile URL mismatch');
  origin.pathname = prefix;
  const key = createPrivateKey(config.signingKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 connector key required');
  const identity = JSON.stringify([config.targetId, config.profileRef, origin.href, createPublicKey(key).export({ type: 'spki', format: 'pem' })]);
  const db = new Database(join(directory, 'hermes-runtime.db'));
  try {
    db.pragma('synchronous=FULL'); db.pragma('journal_mode=WAL');
    if (db.pragma('synchronous', { simple: true }) !== 2) throw new Error('Hermes journal requires FULL');
    db.exec('CREATE TABLE IF NOT EXISTS runtime_identity(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs(start_key TEXT PRIMARY KEY,event_id TEXT NOT NULL,session_id TEXT NOT NULL,fingerprint TEXT NOT NULL,run_ref TEXT,result_json TEXT,proof_json TEXT)');
    if (!(db.pragma('table_info(runs)') as { name: string }[]).some(column => column.name === 'confirmed_at')) db.exec('ALTER TABLE runs ADD COLUMN confirmed_at INTEGER');
    function purge() { db.prepare('UPDATE runs SET result_json=NULL,proof_json=NULL WHERE confirmed_at IS NOT NULL AND confirmed_at < ?').run(Date.now() - 7 * 86400000); }
    purge();
    const existing = db.prepare('SELECT value FROM runtime_identity WHERE id=1').get() as { value: string } | undefined;
    if (existing && existing.value !== identity) throw new Error('Hermes runtime identity changed');
    db.prepare('INSERT OR IGNORE INTO runtime_identity VALUES(1,?)').run(identity);
    const probe = new HermesRunsProbe(origin.href, config.token);
    async function verifyPeer() {
      const capabilities = await probe.recoveryCapabilities();
      if (capabilities.protocol !== 1 || capabilities.profileRef !== config.profileRef || capabilities.supportedSource !== true || capabilities.durable !== true ||
          capabilities.readOnlyKeyLookup !== true || capabilities.normalCompletionQuiescent !== true || capabilities.cancelQuiescence !== false) throw new Error('Hermes recovery capabilities not verified');
    }
    const saved = (startKey: string) => db.prepare('SELECT * FROM runs WHERE start_key=?').get(startKey) as Saved | undefined;
    function query(d: NativeDeliveryView): NativeRunQuery {
      return { eventId: d.ticket.eventId, targetId: d.targetId, startKey: d.startKey, runRef: d.runRef, bindingId: d.bindingId, groupId: d.groupId, conversationGeneration: d.conversationGeneration, conversationRef: d.conversationRef, incoming: d.incoming };
    }
    function validate(q: NativeRunQuery, s: ReturnType<typeof source>, row?: Saved) {
      if (q.targetId !== config.targetId || (row && (row.event_id !== q.eventId || row.fingerprint !== s.fingerprint || row.session_id !== s.session || (row.run_ref && q.runRef && row.run_ref !== q.runRef)))) throw new Error('Hermes delivery mapping mismatch');
    }
    const maintenance = setInterval(() => {
      try { purge(); } catch { console.error('Hermes result retention maintenance failed'); }
    }, 3600000);
    maintenance.unref();
    return {
      async describe() { await verifyPeer(); return { targetId: config.targetId, durableResults: true, observeByStartKey: true, approvals: true, cancel: false }; },
      async start({ delivery, trustedInbound }, signal) {
        if (trustedInbound !== false || !delivery.started) throw new Error('Native start ticket required');
        await verifyPeer();
        const q = query(delivery); const s = source(q); validate(q, s);
        // Durable consumption before the single POST. Existing rows never resend creation.
        db.prepare('INSERT INTO runs(start_key,event_id,session_id,fingerprint) VALUES(?,?,?,?)').run(q.startKey, q.eventId, s.session, s.fingerprint);
        if (signal.aborted) throw new Error('Hermes dispatch cancelled');
        const runRef = await probe.start(s.session, s.input, q.startKey, s.author, signal);
        db.prepare('UPDATE runs SET run_ref=? WHERE start_key=?').run(runRef, q.startKey);
        return { runRef };
      },
      async observe(q, signal) {
        const s = source(q); const row = saved(q.startKey); validate(q, s, row);
        if (row?.proof_json) return { state: 'terminal', proof: JSON.parse(row.proof_json) as NativeTerminalProof };
        await verifyPeer();
        const evidence = await probe.lookup(q.startKey, s.fingerprint, signal);
        if (evidence.state === 'unknown') return { state: 'unknown' };
        if (evidence.profileRef !== config.profileRef || typeof evidence.runRef !== 'string' || (q.runRef && q.runRef !== evidence.runRef) || (row?.run_ref && row.run_ref !== evidence.runRef)) throw new Error('Hermes native run mismatch');
        if (evidence.state === 'awaiting_approval') return { state: 'awaiting_approval' };
        if (evidence.state === 'active') return { state: 'active' };
        if (evidence.state !== 'completed' || !['reply','no_reply'].includes(String(evidence.decision)) || typeof evidence.text !== 'string' || evidence.text.length > 4000 ||
            (evidence.decision === 'no_reply' && evidence.text !== '') || (evidence.decision === 'reply' && !evidence.text.trim())) return { state: 'unknown' };
        const result: NativeResult = { decision: evidence.decision as NativeResult['decision'], text: evidence.text, conversationRef: s.session };
        const data = { eventId: q.eventId, targetId: q.targetId, startKey: q.startKey, runRef: evidence.runRef, terminal: 'completed' as const,
          resultHash: createHash('sha256').update(nativeResultPayload(result)).digest('hex') };
        const proof = { data, signature: sign(null, Buffer.from(nativeProofPayload(data)), key).toString('base64url') };
        db.transaction(() => {
          db.prepare('INSERT OR IGNORE INTO runs(start_key,event_id,session_id,fingerprint,run_ref) VALUES(?,?,?,?,?)').run(q.startKey, q.eventId, s.session, s.fingerprint, evidence.runRef);
          db.prepare('UPDATE runs SET run_ref=?,result_json=?,proof_json=? WHERE start_key=?').run(evidence.runRef, JSON.stringify(result), JSON.stringify(proof), q.startKey);
        }).immediate();
        return { state: 'terminal', proof };
      },
      async recoverResult(q) {
        const s = source(q); const row = saved(q.startKey); validate(q, s, row);
        if (!row?.result_json) throw new Error('Hermes durable result unavailable');
        return JSON.parse(row.result_json) as NativeResult;
      },
      async unconfirmedResults() {
        purge();
        return (db.prepare('SELECT event_id,start_key FROM runs WHERE result_json IS NOT NULL AND confirmed_at IS NULL LIMIT 100').all() as { event_id: string; start_key: string }[]).map(row => ({ eventId: row.event_id, startKey: row.start_key }));
      },
      async confirmedReceipt(eventId, startKey) {
        db.prepare('UPDATE runs SET confirmed_at=COALESCE(confirmed_at,?) WHERE event_id=? AND start_key=?').run(Date.now(), eventId, startKey);
        purge();
      },
      async close() { clearInterval(maintenance); db.close(); },
    };
  } catch (error) { db.close(); throw error; }
}
/** Owner-selected entrypoint. Secrets arrive through opaque vault-env injection. */
export async function createNativeRuntime(directory: string): Promise<NativeRuntimePort> {
  const path = process.env['AGENT_CHAT_HERMES_CONFIG'];
  if (!path) throw new Error('Hermes target configuration required');
  const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  if (typeof raw.targetId !== 'string' || typeof raw.profileRef !== 'string' || typeof raw.origin !== 'string') throw new Error('Invalid Hermes target configuration');
  const token = process.env['AGENT_CHAT_HERMES_TOKEN']; const signingKey = process.env['AGENT_CHAT_HERMES_SIGNING_KEY'];
  if (!token || !signingKey) throw new Error('Hermes connector credential references unavailable');
  return await createHermesRuntime({ targetId: raw.targetId, profileRef: raw.profileRef, origin: raw.origin, token, signingKey }, directory);
}
