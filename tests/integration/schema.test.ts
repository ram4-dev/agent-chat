import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIRECTORY } from '@agent-chat/contracts';
import { REPOSITORY_ROOT } from '../../apps/server/src/config/index';
import { loadMigrations } from '../../apps/server/src/persistence/migrate';
import {
  createDatabase,
  type DatabaseHandle,
} from '../../apps/server/src/persistence/client';
import { migrateFromDirectory } from '../../apps/server/src/persistence/migrate';

const MIGRATIONS_PATH = join(REPOSITORY_ROOT, MIGRATIONS_DIRECTORY);
const MVP_TABLES = [
  'agent_automation_bindings',
  'agent_automation_jobs',
  'agent_connections',
  'agent_runtimes',
  'agents',
  'audit_events',
  'group_agent_memberships',
  'group_human_memberships',
  'groups',
  'human_sessions',
  'inbox_events',
  'invitations',
  'message_idempotency',
  'messages',
  'native_binding_groups',
  'native_binding_versions',
  'native_bindings',
  'native_connection_grants',
  'native_conversations',
  'native_deliveries',
  'native_pairing_challenges',
  'native_runtime_targets',
  'oauth_clients',
  'oauth_grants',
  'oauth_refresh_tokens',
  'oidc_artifacts',
  'schema_migrations',
  'users',
];

const temporaryDirectories: string[] = [];
const openHandles: DatabaseHandle[] = [];

function openMigratedDatabase(): DatabaseHandle {
  const directory = mkdtempSync(join(tmpdir(), 'agent-chat-schema-'));
  temporaryDirectories.push(directory);
  const database = createDatabase({
    path: join(directory, 'app.db'),
    busyTimeoutMs: 1000,
  });
  openHandles.push(database);
  migrateFromDirectory(database.sqlite, MIGRATIONS_PATH);
  return database;
}

function seed(database: DatabaseHandle): void {
  database.sqlite.exec(`
    INSERT INTO users (id, email, password_hash, display_name) VALUES
      ('user-1', 'one@example.com', 'hash', 'One'),
      ('user-2', 'two@example.com', 'hash', 'Two');
    INSERT INTO groups (id, name, creator_user_id) VALUES
      ('group-1', 'Group One', 'user-1');
    INSERT INTO agents (id, owner_user_id, name) VALUES
      ('agent-1', 'user-1', 'Agent One'),
      ('agent-2', 'user-2', 'Agent Two');
    INSERT INTO messages (id, group_id, author_kind, human_author_id, text) VALUES
      ('message-1', 'group-1', 'human', 'user-1', 'hello'),
      ('message-3', 'group-1', 'human', 'user-1', 'again');
    INSERT INTO messages (id, group_id, author_kind, agent_author_id, text) VALUES
      ('message-2', 'group-1', 'agent', 'agent-1', 'hi');
  `);
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

describe('0001_initial_mvp', () => {
  let database: DatabaseHandle;

  beforeEach(() => {
    database = openMigratedDatabase();
    seed(database);
  });

  it('creates the complete MVP schema', () => {
    const tableNames = (
      database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(tableNames).toEqual(MVP_TABLES);
  });

  it('enforces foreign keys on the new tables', () => {
    expect(() =>
      database.sqlite
        .prepare(
          "INSERT INTO messages (id, group_id, author_kind, human_author_id, text) VALUES ('m-x', 'missing-group', 'human', 'user-1', 'text')",
        )
        .run(),
    ).toThrowError(/FOREIGN KEY constraint failed/);
  });

  it('rejects a message that is not authored by exactly one human or agent', () => {
    const insert = database.sqlite.prepare(
      'INSERT INTO messages (id, group_id, author_kind, human_author_id, agent_author_id, text) VALUES (?, ?, ?, ?, ?, ?)',
    );

    expect(() =>
      insert.run('m-both', 'group-1', 'human', 'user-1', 'agent-1', 'ambiguous'),
    ).toThrowError(/CHECK constraint failed/);
    expect(() =>
      insert.run('m-none', 'group-1', 'agent', null, null, 'anonymous'),
    ).toThrowError(/CHECK constraint failed/);
    expect(() =>
      insert.run('m-mismatch', 'group-1', 'agent', 'user-1', null, 'mismatched kind'),
    ).toThrowError(/CHECK constraint failed/);

    expect(insert.run('m-human', 'group-1', 'human', 'user-1', null, 'ok')).toBeTruthy();
    expect(insert.run('m-agent', 'group-1', 'agent', null, 'agent-1', 'ok')).toBeTruthy();
  });

  it('makes agent ownership immutable after insert', () => {
    expect(() =>
      database.sqlite
        .prepare("UPDATE agents SET owner_user_id = 'user-2' WHERE id = 'agent-1'")
        .run(),
    ).toThrowError(/immutable/);

    database.sqlite.prepare("UPDATE agents SET name = 'Renamed' WHERE id = 'agent-1'").run();
    expect(
      database.sqlite.prepare("SELECT name FROM agents WHERE id = 'agent-1'").get(),
    ).toEqual({ name: 'Renamed' });
  });

  it('keeps inbox sequence numbers unique per agent', () => {
    const insert = database.sqlite.prepare(
      'INSERT INTO inbox_events (id, agent_id, sequence, group_id, message_id) VALUES (?, ?, ?, ?, ?)',
    );

    insert.run('event-1', 'agent-1', 1, 'group-1', 'message-1');
    expect(() => insert.run('event-2', 'agent-1', 1, 'group-1', 'message-2')).toThrowError(
      /UNIQUE constraint failed/,
    );

    expect(insert.run('event-3', 'agent-2', 1, 'group-1', 'message-1')).toBeTruthy();
  });

  it('creates at most one inbox event per agent, message, and event type', () => {
    const insert = database.sqlite.prepare(
      'INSERT INTO inbox_events (id, agent_id, sequence, group_id, message_id, event_type) VALUES (?, ?, ?, ?, ?, ?)',
    );

    insert.run('event-1', 'agent-1', 1, 'group-1', 'message-1', 'message.created');
    expect(() =>
      insert.run('event-2', 'agent-1', 2, 'group-1', 'message-1', 'message.created'),
    ).toThrowError(/UNIQUE constraint failed/);
  });

  it('binds one idempotency key per author to one message', () => {
    const insert = database.sqlite.prepare(
      'INSERT INTO message_idempotency (author_kind, human_author_id, agent_author_id, idempotency_key, request_digest, message_id) VALUES (?, ?, ?, ?, ?, ?)',
    );

    insert.run('human', 'user-1', null, 'key-1', 'digest-1', 'message-1');
    expect(() =>
      insert.run('human', 'user-1', null, 'key-1', 'digest-2', 'message-3'),
    ).toThrowError(/UNIQUE constraint failed/);

    expect(insert.run('agent', null, 'agent-1', 'key-1', 'digest-3', 'message-2')).toBeTruthy();
  });

  it('rejects duplicate normalized emails and duplicate group membership', () => {
    expect(() =>
      database.sqlite
        .prepare(
          "INSERT INTO users (id, email, password_hash, display_name) VALUES ('user-3', 'one@example.com', 'hash', 'Three')",
        )
        .run(),
    ).toThrowError(/UNIQUE constraint failed/);

    database.sqlite
      .prepare(
        "INSERT INTO group_human_memberships (group_id, user_id, role) VALUES ('group-1', 'user-1', 'admin')",
      )
      .run();
    expect(() =>
      database.sqlite
        .prepare(
          "INSERT INTO group_human_memberships (group_id, user_id, role) VALUES ('group-1', 'user-1', 'member')",
        )
        .run(),
    ).toThrowError(/UNIQUE constraint failed/);
  });

  it('rejects an email that is not already normalized', () => {
    expect(() =>
      database.sqlite
        .prepare(
          "INSERT INTO users (id, email, password_hash, display_name) VALUES ('user-4', 'Upper@Example.com', 'hash', 'Four')",
        )
        .run(),
    ).toThrowError(/CHECK constraint failed/);
  });
});

describe('migration ledger behaviour', () => {
  it('applies every migration to an empty database once and is a no-op after that', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-chat-ledger-'));
    temporaryDirectories.push(directory);
    const database = createDatabase({
      path: join(directory, 'app.db'),
      busyTimeoutMs: 1000,
    });
    openHandles.push(database);

    const firstRun = migrateFromDirectory(database.sqlite, MIGRATIONS_PATH);
    const secondRun = migrateFromDirectory(database.sqlite, MIGRATIONS_PATH);

    // Derived from the migration directory rather than hardcoded, so adding a
    // migration cannot silently make this test assert a stale list.
    const allMigrations = loadMigrations(MIGRATIONS_PATH).map((migration) => migration.id);
    expect(firstRun).toEqual({ applied: allMigrations, skipped: [] });
    expect(secondRun).toEqual({ applied: [], skipped: allMigrations });
    expect(
      database.sqlite.prepare('SELECT id, checksum FROM schema_migrations').all(),
    ).toEqual(allMigrations.map((id) => ({ id, checksum: expect.stringMatching(/^[0-9a-f]{64}$/) })));
  });
});
