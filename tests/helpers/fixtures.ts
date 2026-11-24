import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Config } from '../../src/config.js';
import { createLogger, type Logger } from '../../src/logger.js';
import { openDatabase, type Database } from '../../src/store/database.js';
import { applyMigrations } from '../../src/store/migrations.js';

/** Builds a Config from defaults plus overrides, with paths under a temp directory. */
export function testConfig(overrides: Record<string, string> = {}, baseDirectory = tmpdir()): Config {
  return loadConfig({ WEBSNAPPER_LOG_LEVEL: 'warn', ...overrides }, baseDirectory);
}

/** A logger that only writes errors, to keep test output readable. */
export function quietLogger(): Logger {
  return createLogger({ level: 'warn', tag: 'test', stderrOnly: true });
}

/** Creates a migrated SQLite database in a fresh temp directory. */
export function testDatabase(): { database: Database; path: string; cleanUp: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'websnapper-test-'));
  const path = join(directory, 'test.sqlite');
  const database = openDatabase(path);
  applyMigrations(database, Date.now());
  return {
    database,
    path,
    cleanUp: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
