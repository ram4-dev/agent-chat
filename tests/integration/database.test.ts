import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  runImmediateTransaction,
  type DatabaseHandle,
} from '../../apps/server/src/persistence/client';

const openHandles: DatabaseHandle[] = [];
const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'agent-chat-db-'));
  temporaryDirectories.push(directory);
  return join(directory, 'app.db');
}

function openDatabaseAt(path: string, busyTimeoutMs = 5000): DatabaseHandle {
  const database = createDatabase({ path, busyTimeoutMs });
  openHandles.push(database);
  return database;
}

function openDatabase(busyTimeoutMs = 5000): DatabaseHandle {
  return openDatabaseAt(temporaryDatabasePath(), busyTimeoutMs);
}

afterEach(() => {
  while (openHandles.length > 0) {
    openHandles.pop()?.close();
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('createDatabase', () => {
  it('enables WAL, FULL synchronization, foreign keys, and the configured busy timeout', () => {
    const database = openDatabase(1234);

    expect(database.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.sqlite.pragma('synchronous', { simple: true })).toBe(2);
    expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.sqlite.pragma('busy_timeout', { simple: true })).toBe(1234);
  });

  it('sets and checks FULL independently on each writer and on reopening', () => {
    const path = temporaryDatabasePath();
    const first = openDatabaseAt(path);
    first.sqlite.pragma('synchronous = NORMAL'); // Negative control: this setting is per connection.
    const second = openDatabaseAt(path);
    expect(first.sqlite.pragma('synchronous', { simple: true })).toBe(1);
    expect(second.sqlite.pragma('synchronous', { simple: true })).toBe(2);
    const reopened = openDatabaseAt(path);
    expect(reopened.sqlite.pragma('synchronous', { simple: true })).toBe(2);
  });

  it('enforces foreign keys for rows written through the connection', () => {
    const database = openDatabase();
    database.sqlite.exec(`
      CREATE TABLE parents (id TEXT PRIMARY KEY);
      CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id));
    `);

    expect(() =>
      database.sqlite
        .prepare('INSERT INTO children (id, parent_id) VALUES (?, ?)')
        .run('child-1', 'missing-parent'),
    ).toThrowError(/FOREIGN KEY constraint failed/);
  });

  it('exposes a drizzle client reading through the same connection', () => {
    const database = openDatabase();

    const row = database.db.get<{ total: number }>(sql`SELECT 1 + 1 AS total`);

    expect(row).toEqual({ total: 2 });
  });
});

describe('runImmediateTransaction', () => {
  it('commits the work performed inside the callback', () => {
    const database = openDatabase();
    database.sqlite.exec('CREATE TABLE notes (id TEXT PRIMARY KEY)');

    const result = runImmediateTransaction(database.sqlite, () => {
      database.sqlite.prepare('INSERT INTO notes (id) VALUES (?)').run('note-1');
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(database.sqlite.prepare('SELECT COUNT(*) AS total FROM notes').get()).toEqual({
      total: 1,
    });
  });

  it('rolls back and rethrows when the callback fails', () => {
    const database = openDatabase();
    database.sqlite.exec('CREATE TABLE notes (id TEXT PRIMARY KEY)');

    expect(() =>
      runImmediateTransaction(database.sqlite, () => {
        database.sqlite.prepare('INSERT INTO notes (id) VALUES (?)').run('note-1');
        throw new Error('boom');
      }),
    ).toThrowError('boom');

    expect(database.sqlite.prepare('SELECT COUNT(*) AS total FROM notes').get()).toEqual({
      total: 0,
    });
  });

  it('takes the write lock as the transaction begins, before any statement runs', () => {
    const databasePath = temporaryDatabasePath();
    const writer = openDatabaseAt(databasePath);
    const otherWriter = openDatabaseAt(databasePath, 50);
    writer.sqlite.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY)');

    let blocked: unknown = null;
    runImmediateTransaction(writer.sqlite, () => {
      try {
        runImmediateTransaction(otherWriter.sqlite, () => {
          otherWriter.sqlite.prepare('INSERT INTO probe (id) VALUES (?)').run(1);
        });
      } catch (error) {
        blocked = error;
      }
    });

    expect(blocked).toBeInstanceOf(Error);
    expect((blocked as { code?: string }).code).toBe('SQLITE_BUSY');
  });

  it('still serves concurrent readers while a write transaction is open', () => {
    const databasePath = temporaryDatabasePath();
    const writer = openDatabaseAt(databasePath);
    const reader = openDatabaseAt(databasePath, 50);
    writer.sqlite.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY)');

    let readInsideWrite: unknown = null;
    runImmediateTransaction(writer.sqlite, () => {
      readInsideWrite = reader.sqlite.prepare('SELECT COUNT(*) AS total FROM probe').get();
    });

    expect(readInsideWrite).toEqual({ total: 0 });
  });
});
