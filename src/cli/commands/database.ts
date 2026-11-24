import { openDatabase } from '../../store/database.js';
import { applyMigrations, pendingMigrations } from '../../store/migrations.js';
import type { Command } from '../command.js';
import { ExitCode } from '../exit-codes.js';

export const dbMigrateCommand: Command = {
  path: ['db', 'migrate'],
  summary: 'Create or upgrade the database schema.',
  usage: 'websnapper db migrate',
  run: async ({ config }) => {
    const database = openDatabase(config.databasePath);
    try {
      const applied = applyMigrations(database, Date.now());
      const text = applied.length === 0
        ? `Database is up to date: ${config.databasePath}`
        : `Applied ${applied.map((migration) => `${migration.version} (${migration.name})`).join(', ')} to ${config.databasePath}`;
      return { exitCode: ExitCode.success, data: { applied, databasePath: config.databasePath }, text };
    } finally {
      database.close();
    }
  },
};

export const dbStatusCommand: Command = {
  path: ['db', 'status'],
  summary: 'Show pending database migrations.',
  usage: 'websnapper db status',
  run: async ({ config }) => {
    const database = openDatabase(config.databasePath);
    try {
      const pending = pendingMigrations(database);
      return {
        exitCode: pending.length === 0 ? ExitCode.success : ExitCode.notReady,
        data: { pending, databasePath: config.databasePath },
        text: pending.length === 0 ? `Up to date: ${config.databasePath}` : `${pending.length} migration(s) pending. Run: websnapper db migrate`,
      };
    } finally {
      database.close();
    }
  },
};
