import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BUSY_TIMEOUT_MS = 5000;
const IN_MEMORY_PATH = ':memory:';

export type Database = DatabaseSync;

/** Opens (creating if needed) the SQLite database in WAL mode, so the server and CLI can share it. */
export function openDatabase(databasePath: string): Database {
  if (databasePath !== IN_MEMORY_PATH) {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const database = new DatabaseSync(databasePath);
  database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}; PRAGMA foreign_keys = ON;`);
  return database;
}

/** Returns SQLite's data_version, which changes when another connection commits. */
export function dataVersion(database: Database): number {
  const row = database.prepare('PRAGMA data_version').get();
  return Number(row?.data_version ?? 0);
}

/** Reads a column as a string, throwing if the row doesn't have one. */
export function textColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new TypeError(`Expected text in column ${column}; got ${typeof value}.`);
  }
  return value;
}

/** Reads a column as a number, throwing if the row doesn't have one. */
export function numberColumn(row: Record<string, unknown>, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new TypeError(`Expected a number in column ${column}; got ${typeof value}.`);
  }
  return Number(value);
}

/** Reads a nullable numeric column. */
export function optionalNumberColumn(row: Record<string, unknown>, column: string): number | null {
  return row[column] === null || row[column] === undefined ? null : numberColumn(row, column);
}
