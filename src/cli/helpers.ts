import { createInterface } from 'node:readline/promises';
import type { Config } from '../config.js';
import { ServiceError, type ErrorCode } from '../errors.js';
import { openDatabase, type Database } from '../store/database.js';
import { pendingMigrations } from '../store/migrations.js';
import { booleanFlag, type ParsedArgs } from './args.js';
import type { CommandResult } from './command.js';
import { ExitCode, type ExitCodeValue } from './exit-codes.js';

/** Exit code for each service error a command can surface. */
export const ERROR_EXIT_CODES: Record<ErrorCode, ExitCodeValue> = {
  invalid_request: ExitCode.usage,
  unauthorised: ExitCode.refused,
  url_blocked: ExitCode.refused,
  not_found: ExitCode.failure,
  method_not_allowed: ExitCode.usage,
  rate_limited: ExitCode.refused,
  internal_error: ExitCode.failure,
  upstream_error: ExitCode.failure,
  unavailable: ExitCode.notReady,
  upstream_timeout: ExitCode.failure,
};

/** Builds a result for a usage problem. */
export function usageResult(message: string): CommandResult {
  return { exitCode: ExitCode.usage, data: { error: message }, text: message };
}

/** Converts a ServiceError into a command result; rethrows anything else. */
export function serviceErrorResult(error: unknown): CommandResult {
  if (!(error instanceof ServiceError)) {
    throw error;
  }
  return { exitCode: ERROR_EXIT_CODES[error.code], data: { error: error.message, code: error.code }, text: error.message };
}

/** Opens the database, refusing with notReady while migrations are pending, and always closes it. */
export async function withDatabase(config: Config, work: (database: Database) => Promise<CommandResult>): Promise<CommandResult> {
  const database = openDatabase(config.databasePath);
  try {
    const pending = pendingMigrations(database);
    let result: CommandResult;
    if (pending.length > 0) {
      const message = `${pending.length} database migration(s) pending. Run: websnapper db migrate`;
      result = { exitCode: ExitCode.notReady, data: { error: message, pending }, text: message };
    } else {
      result = await work(database);
    }
    return result;
  } finally {
    database.close();
  }
}

/** Reads a positive whole-number positional argument. */
export function idArgument(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

/** Confirms a destructive action: --yes, or a "y" on a terminal. Refuses when neither is possible. */
export async function confirm(args: ParsedArgs, question: string): Promise<boolean> {
  if (booleanFlag(args, 'yes')) {
    return true;
  }
  if (!process.stdin.isTTY) {
    return false;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    prompt.close();
  }
}

/** The result of declining a confirmation. */
export function refusedResult(): CommandResult {
  const message = 'Not confirmed. Pass --yes to run without a prompt.';
  return { exitCode: ExitCode.refused, data: { error: message }, text: message };
}

/** Formats a Unix-ms time for display. */
export function formatTime(value: number | null): string {
  return value === null ? '-' : new Date(value).toISOString().replace('.000Z', 'Z');
}

/** Lays out rows as aligned columns. */
export function table(headings: string[], rows: string[][]): string {
  const widths = headings.map((heading, column) => Math.max(heading.length, ...rows.map((row) => (row[column] ?? '').length)));
  const render = (cells: string[]): string => cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ').trimEnd();
  return [render(headings), ...rows.map(render)].join('\n');
}
