import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import type { NativeRuntimePort } from './runtime.js';
import { cloudWebhookTransport, approvedWebhook, type GrokWakeTransport } from './grok-transport.js';

export interface GrokWake { version: 1; eventId: string; bindingId: string; revision: number; targetId: string; startKey: string }
export interface GrokConfiguration { targetId: string; bindingId: string; revision: number; groupId: string; botRef: string; webhookUrl: string; approvedHosts: string[] }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function parseGrokConfiguration(raw: unknown): GrokConfiguration {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Grok configuration');
  const c = raw as Record<string, unknown>;
  if (!['targetId','bindingId','groupId'].every(key => typeof c[key] === 'string' && uuid.test(c[key] as string)) ||
      !Number.isSafeInteger(c.revision) || Number(c.revision) < 1 || typeof c.botRef !== 'string' || !uuid.test(c.botRef) || typeof c.webhookUrl !== 'string' ||
      !Array.isArray(c.approvedHosts) || !c.approvedHosts.length || !c.approvedHosts.every(host => typeof host === 'string' && host === host.toLowerCase() && !isIP(host))) throw new Error('Explicit Grok binding/bot/destination required');
  const config = c as unknown as GrokConfiguration;
  approvedWebhook(config.webhookUrl, config.approvedHosts);
  return config;
}
/** Webhook wake-up only. Results return through native_save; this adapter never signs invented provider completion. */
export async function createGrokRuntime(config: GrokConfiguration, directory: string, transport: GrokWakeTransport): Promise<NativeRuntimePort> {
  parseGrokConfiguration(config);
  const db = new Database(join(directory, 'grok-notifications.db'));
  try {
    db.pragma('synchronous=FULL'); db.pragma('journal_mode=WAL');
    if (db.pragma('synchronous', { simple: true }) !== 2) throw new Error('Grok dispatch requires FULL');
    db.exec('CREATE TABLE IF NOT EXISTS identity(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS wakes(start_key TEXT PRIMARY KEY,event_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN (\'uncertain\',\'accepted\')))');
    const identity = JSON.stringify([config.targetId,config.bindingId,config.revision,config.groupId,config.botRef,config.webhookUrl,[...config.approvedHosts].sort()]);
    const existing = db.prepare('SELECT value FROM identity WHERE id=1').get() as { value: string } | undefined;
    if (existing && existing.value !== identity) throw new Error('Grok target configuration changed');
    db.prepare('INSERT OR IGNORE INTO identity VALUES(1,?)').run(identity);
    return {
      async describe() { return { targetId: config.targetId, durableResults: true, observeByStartKey: true, cancel: false, approvals: false }; },
      async start({ delivery: d, trustedInbound }, signal) {
        if (trustedInbound !== false || !d.started || d.targetId !== config.targetId || d.bindingId !== config.bindingId || d.bindingRevision !== config.revision || d.groupId !== config.groupId || !uuid.test(d.startKey) || !uuid.test(d.ticket.eventId)) throw new Error('Grok delivery does not match owner selection');
        const wake: GrokWake = { version: 1, eventId: d.ticket.eventId, bindingId: d.bindingId, revision: d.bindingRevision, targetId: d.targetId, startKey: d.startKey };
        // Commit before the single external side effect. No key is ever reset or retransmitted.
        db.prepare('INSERT INTO wakes VALUES(?,?,\'uncertain\')').run(d.startKey, d.ticket.eventId);
        if (signal.aborted) throw new Error('Webhook dispatch cancelled');
        let status: number;
        try { status = await transport.notify(wake, signal); } catch { throw new Error('Webhook dispatch unconfirmed; automatic retry disabled'); }
        if (signal.aborted || status !== 200) throw new Error('Webhook acceptance unconfirmed; automatic retry disabled');
        db.prepare("UPDATE wakes SET state='accepted' WHERE start_key=?").run(d.startKey);
        // This is a dispatch reference, not an undocumented Grok API run ID.
        return { runRef: `webhook:${d.startKey}` };
      },
      async observe(q) {
        if (q.targetId !== config.targetId || q.bindingId !== config.bindingId || q.groupId !== config.groupId) throw new Error('Grok delivery mapping mismatch');
        const row = db.prepare('SELECT event_id,state FROM wakes WHERE start_key=?').get(q.startKey) as { event_id: string; state: string } | undefined;
        if (row && row.event_id !== q.eventId) throw new Error('Grok event mismatch');
        return { state: row?.state === 'accepted' ? 'active' : 'unknown' };
      },
      async recoverResult() { throw new Error('Grok results must return through authenticated native_save with verified terminal evidence'); },
      async close() { db.close(); },
    };
  } catch (error) { db.close(); throw error; }
}
export async function createNativeRuntime(directory: string): Promise<NativeRuntimePort> {
  const path = process.env['AGENT_CHAT_GROK_CONFIG']; const bearer = process.env['AGENT_CHAT_GROK_WEBHOOK_TOKEN'];
  if (!path || !bearer) throw new Error('Explicit Grok configuration and opaque credential required');
  const config = parseGrokConfiguration(JSON.parse(await readFile(path, 'utf8')));
  return createGrokRuntime(config, directory, cloudWebhookTransport(config.webhookUrl, config.approvedHosts, bearer));
}
