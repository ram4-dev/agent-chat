import Database from 'better-sqlite3';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkerOutput } from '../codex/worker.js';

export interface PendingEvent {
  eventId: string; sequence: number; groupId: string;
  message: { text: string; author: { kind: 'human' | 'agent' } };
}
interface Entry {
  eventId: string; groupId: string; phase: 'generating' | 'blocked' | 'saved' | 'sent' | 'acked';
  output: string | null;
}

/** One process holds the receiver lock. SQLite commits the output before any network publication. */
export class ReceiverJournal {
  private readonly db: Database.Database;
  constructor(directory: string, agentId?: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'journal.db');
    this.db = new Database(path);
    chmodSync(path, 0o600);
    this.db.pragma('journal_mode = WAL'); this.db.pragma('synchronous = FULL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS identity(agentId TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS events(eventId TEXT PRIMARY KEY, groupId TEXT NOT NULL, phase TEXT NOT NULL, output TEXT);
      CREATE TABLE IF NOT EXISTS threads(groupId TEXT PRIMARY KEY, threadId TEXT NOT NULL);`);
    const owner = this.db.prepare('SELECT agentId FROM identity LIMIT 1').get() as { agentId: string } | undefined;
    if (owner && agentId && owner.agentId !== agentId) { this.db.close(); throw new Error('Journal belongs to a different agent; use a separate state directory'); }
    if (!owner && !agentId) { this.db.close(); throw new Error('No receiver journal exists'); }
    if (agentId) this.db.prepare('INSERT OR IGNORE INTO identity VALUES(?)').run(agentId);
  }
  get(eventId: string): Entry | undefined { return this.db.prepare('SELECT * FROM events WHERE eventId=?').get(eventId) as Entry | undefined; }
  blocked(groupId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM events WHERE groupId=? AND phase IN ('generating','blocked') LIMIT 1").get(groupId);
  }
  start(event: PendingEvent) {
    this.db.prepare("INSERT INTO events(eventId,groupId,phase) VALUES(?,?,'generating')").run(event.eventId, event.groupId);
  }
  phase(eventId: string, phase: Entry['phase']) { this.db.prepare('UPDATE events SET phase=? WHERE eventId=?').run(phase, eventId); }
  thread(groupId: string): string | undefined {
    return (this.db.prepare('SELECT threadId FROM threads WHERE groupId=?').get(groupId) as { threadId: string } | undefined)?.threadId;
  }
  save(event: PendingEvent, output: WorkerOutput) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE events SET phase='saved',output=? WHERE eventId=?").run(JSON.stringify(output), event.eventId);
      if (output.threadId) this.db.prepare('INSERT INTO threads VALUES(?,?) ON CONFLICT(groupId) DO UPDATE SET threadId=excluded.threadId').run(event.groupId, output.threadId);
    })();
  }
  status() { return this.db.prepare('SELECT phase,count(*) AS count FROM events GROUP BY phase').all(); }
  resolve(eventId: string, text: string) {
    const entry = this.get(eventId);
    if (!entry || !['blocked', 'generating'].includes(entry.phase) || !text.trim() || text.length > 4000) {
      throw new Error('Provide an uncertain event and a reply between 1 and 4000 characters');
    }
    this.db.transaction(() => {
      this.db.prepare("UPDATE events SET phase='saved',output=? WHERE eventId=?")
        .run(JSON.stringify({ decision: 'reply', text: text.trim(), threadId: '' }), eventId);
      // An interrupted model turn may have changed its own thread. Resume from
      // server history in a fresh thread after an explicit operator resolution.
      this.db.prepare('DELETE FROM threads WHERE groupId=?').run(entry.groupId);
    })();
  }
  static status(directory: string): unknown[] {
    const db = new Database(join(directory, 'journal.db'), { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT eventId,groupId,phase FROM events WHERE phase<>? ORDER BY rowid').all('acked'); }
    finally { db.close(); }
  }
  close() { this.db.close(); }
}
