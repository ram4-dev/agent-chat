import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  type DatabaseHandle,
} from '../../apps/server/src/persistence/client';
import {
  applyMigrations,
  loadMigrations,
  migrateFromDirectory,
} from '../../apps/server/src/persistence/migrate';

const temporaryDirectories: string[] = [];
const openHandles: DatabaseHandle[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'agent-chat-migrations-'));
  temporaryDirectories.push(directory);
  return directory;
}

function openDatabase(): DatabaseHandle {
  const database = createDatabase({
    path: join(temporaryDirectory(), 'app.db'),
    busyTimeoutMs: 1000,
  });
  openHandles.push(database);
  return database;
}

function writeMigration(directory: string, fileName: string, sql: string): void {
  writeFileSync(join(directory, fileName), sql, 'utf8');
}

function ledgerRows(database: DatabaseHandle): Array<{ id: string }> {
  return database.sqlite
    .prepare('SELECT id FROM schema_migrations ORDER BY id')
    .all() as Array<{ id: string }>;
}

function tableNames(database: DatabaseHandle): string[] {
  const rows = database.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
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

describe('loadMigrations', () => {
  it('orders numbered migrations numerically and ignores files that are not migrations', () => {
    const directory = temporaryDirectory();
    writeMigration(directory, '0010_tenth.sql', 'CREATE TABLE tenth (id TEXT);');
    writeMigration(directory, 'README.md', 'not a migration');
    writeMigration(directory, '0001_first.sql', 'CREATE TABLE first (id TEXT);');
    writeMigration(directory, '.gitkeep', '');
    writeMigration(directory, '0002_second.sql', 'CREATE TABLE second (id TEXT);');

    expect(loadMigrations(directory).map((migration) => migration.id)).toEqual([
      '0001_first',
      '0002_second',
      '0010_tenth',
    ]);
  });

  it('rejects a .sql file that does not follow the numbered convention', () => {
    const directory = temporaryDirectory();
    writeMigration(directory, '0001_first.sql', 'CREATE TABLE first (id TEXT);');
    writeMigration(directory, 'initial.sql', 'CREATE TABLE initial (id TEXT);');

    expect(() => loadMigrations(directory)).toThrowError(/initial\.sql/);
  });

  it('fails closed on an empty migration directory', () => {
    expect(() => loadMigrations(temporaryDirectory())).toThrowError(/no migrations/i);
  });

  it('fails closed when the migration directory does not exist', () => {
    expect(() => loadMigrations(join(temporaryDirectory(), 'missing'))).toThrowError(
      /migration directory/i,
    );
  });
});

describe('applyMigrations', () => {
  it('applies pending migrations in order and records each checksum in the ledger', () => {
    const database = openDatabase();
    const directory = temporaryDirectory();
    writeMigration(directory, '0001_first.sql', 'CREATE TABLE first (id TEXT PRIMARY KEY);');
    writeMigration(directory, '0002_second.sql', 'CREATE TABLE second (id TEXT PRIMARY KEY);');

    const result = migrateFromDirectory(database.sqlite, directory);

    expect(result).toEqual({ applied: ['0001_first', '0002_second'], skipped: [] });
    expect(tableNames(database)).toEqual(['first', 'schema_migrations', 'second']);
    expect(ledgerRows(database)).toEqual([{ id: '0001_first' }, { id: '0002_second' }]);
  });

  it('is a no-op on a second run instead of an error', () => {
    const database = openDatabase();
    const directory = temporaryDirectory();
    writeMigration(directory, '0001_first.sql', 'CREATE TABLE first (id TEXT PRIMARY KEY);');

    migrateFromDirectory(database.sqlite, directory);
    const secondRun = migrateFromDirectory(database.sqlite, directory);

    expect(secondRun).toEqual({ applied: [], skipped: ['0001_first'] });
    expect(ledgerRows(database)).toEqual([{ id: '0001_first' }]);
  });

  it('rejects a migration whose file content changed after it was applied', () => {
    const database = openDatabase();
    const directory = temporaryDirectory();
    writeMigration(directory, '0001_first.sql', 'CREATE TABLE first (id TEXT PRIMARY KEY);');
    migrateFromDirectory(database.sqlite, directory);

    writeMigration(
      directory,
      '0001_first.sql',
      'CREATE TABLE first (id TEXT PRIMARY KEY, note TEXT);',
    );

    expect(() => migrateFromDirectory(database.sqlite, directory)).toThrowError(
      /0001_first.*changed/i,
    );
  });

  it('rolls back a failing migration and leaves it unrecorded so it can be retried', () => {
    const database = openDatabase();
    const directory = temporaryDirectory();
    writeMigration(
      directory,
      '0001_broken.sql',
      'CREATE TABLE ok (id TEXT PRIMARY KEY); CREATE TABLE ok (id TEXT PRIMARY KEY);',
    );

    expect(() => migrateFromDirectory(database.sqlite, directory)).toThrowError();
    expect(ledgerRows(database)).toEqual([]);
    expect(tableNames(database)).not.toContain('ok');
  });

  it('applies nothing when there are no pending migrations', () => {
    const database = openDatabase();

    expect(applyMigrations(database.sqlite, [])).toEqual({ applied: [], skipped: [] });
  });
});
