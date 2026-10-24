import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  MIGRATION_FILE_PATTERN,
  MIGRATIONS_LEDGER_TABLE,
} from '@agent-chat/contracts';
import { runImmediateTransaction } from './client.js';

export interface MigrationFile {
  /** File name without the `.sql` extension, for example `0001_initial_mvp`. */
  id: string;
  fileName: string;
  sql: string;
  checksum: string;
}

export interface MigrationRunResult {
  /** Ids applied by this run, in order. */
  applied: string[];
  /** Ids already present in the ledger, in order. */
  skipped: string[];
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Reads every `NNNN_name.sql` file in `directory`, ordered by numeric prefix.
 *
 * Any `.sql` file that does not follow the convention, an empty directory, and
 * a missing directory all fail closed: a deployment must never start with a
 * partially discovered migration set.
 */
export function loadMigrations(directory: string): MigrationFile[] {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new MigrationError(`Migration directory not found: ${directory}`);
  }

  const fileNames = readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  if (fileNames.length === 0) {
    throw new MigrationError(`No migrations found in ${directory}`);
  }

  return fileNames.map((fileName) => {
    if (!MIGRATION_FILE_PATTERN.test(fileName)) {
      throw new MigrationError(
        `Invalid migration file name: ${fileName} (expected NNNN_snake_case.sql)`,
      );
    }
    const sql = readFileSync(join(directory, fileName), 'utf8');
    return {
      id: fileName.replace(/\.sql$/, ''),
      fileName,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    };
  });
}

/**
 * Applies every migration that is not in the ledger yet.
 *
 * Each migration runs inside `BEGIN IMMEDIATE` together with its ledger row, so
 * a failure leaves no partial schema and no recorded application. A migration
 * whose content changed after being applied is rejected: migration files are
 * immutable and corrections require a new numbered file.
 */
export function applyMigrations(
  sqlite: Database.Database,
  migrations: readonly MigrationFile[],
): MigrationRunResult {
  ensureLedger(sqlite);

  const recordedChecksums = new Map<string, string>(
    readLedger(sqlite).map((row) => [row.id, row.checksum]),
  );

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    const recordedChecksum = recordedChecksums.get(migration.id);

    if (recordedChecksum !== undefined) {
      if (recordedChecksum !== migration.checksum) {
        throw new MigrationError(
          `Migration ${migration.id} changed after it was applied; add a new numbered migration instead`,
        );
      }
      skipped.push(migration.id);
      continue;
    }

    runImmediateTransaction(sqlite, () => {
      sqlite.exec(migration.sql);
      recordMigration(sqlite, migration);
    });
    applied.push(migration.id);
  }

  return { applied, skipped };
}

/** Convenience wrapper used by both the server startup path and the tests. */
export function migrateFromDirectory(
  sqlite: Database.Database,
  directory: string,
): MigrationRunResult {
  return applyMigrations(sqlite, loadMigrations(directory));
}

function ensureLedger(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER_TABLE} (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function readLedger(sqlite: Database.Database): Array<{ id: string; checksum: string }> {
  return sqlite
    .prepare(`SELECT id, checksum FROM ${MIGRATIONS_LEDGER_TABLE} ORDER BY id`)
    .all() as Array<{ id: string; checksum: string }>;
}

function recordMigration(sqlite: Database.Database, migration: MigrationFile): void {
  sqlite
    .prepare(
      `INSERT INTO ${MIGRATIONS_LEDGER_TABLE} (id, checksum, applied_at) VALUES (?, ?, ?)`,
    )
    .run(migration.id, migration.checksum, new Date().toISOString());
}
