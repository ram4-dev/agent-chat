/**
 * Migration constants shared by the server startup path and the test harness.
 *
 * Migrations are numbered, forward-only SQL files. The ledger table records
 * which files were applied, so re-running the runner over an up-to-date
 * database is a no-op instead of an error.
 */
export const MIGRATIONS_LEDGER_TABLE = 'schema_migrations';

/** Repository-relative directory holding the numbered `.sql` migrations. */
export const MIGRATIONS_DIRECTORY = 'db/migrations';

export const INITIAL_MIGRATION_ID = '0001_initial_mvp';

export const INITIAL_MIGRATION_FILE = '0001_initial_mvp.sql';

/** `NNNN_snake_case.sql` */
export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
