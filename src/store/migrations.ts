import { numberColumn, type Database } from './database.js';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Schema changes in order. Never edit a released migration; add a new one. Times are Unix ms. */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE TABLE url_rules (
        id INTEGER PRIMARY KEY,
        pattern TEXT NOT NULL UNIQUE,
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE bans (
        ip TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX bans_expires_at ON bans (expires_at);
      CREATE TABLE housekeeping_runs (
        id INTEGER PRIMARY KEY,
        started_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL,
        result TEXT NOT NULL,
        detail TEXT NOT NULL
      );
    `,
  },
];

/** Creates the migrations ledger if it doesn't exist. */
function ensureLedger(database: Database): void {
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
}

/** Lists migrations not yet applied, oldest first. */
export function pendingMigrations(database: Database): { version: number; name: string }[] {
  ensureLedger(database);
  const applied = new Set(database.prepare('SELECT version FROM schema_migrations').all().map((row) => numberColumn(row, 'version')));
  return MIGRATIONS.filter((migration) => !applied.has(migration.version)).map(({ version, name }) => ({ version, name }));
}

/** Applies every pending migration, each in its own transaction; returns what was applied. */
export function applyMigrations(database: Database, now: number): { version: number; name: string }[] {
  const pending = pendingMigrations(database);
  for (const { version } of pending) {
    const migration = MIGRATIONS.find((candidate) => candidate.version === version);
    if (migration === undefined) {
      throw new Error(`Migration ${version} disappeared while migrating.`);
    }
    database.exec('BEGIN');
    try {
      database.exec(migration.sql);
      database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(version, migration.name, now);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return pending;
}
