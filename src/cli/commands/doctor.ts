import { BrowserHost } from '../../browser/browser-host.js';
import { createUrlPolicy } from '../../runtime.js';
import { countActiveKeys } from '../../services/key-service.js';
import { openDatabase } from '../../store/database.js';
import { pendingMigrations } from '../../store/migrations.js';
import type { Command, CommandContext, CommandResult } from '../command.js';
import { ExitCode } from '../exit-codes.js';

type CheckStatus = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** Checks the database, schema, keys and rules. */
function databaseChecks(context: CommandContext): Check[] {
  const { config } = context;
  const checks: Check[] = [];
  const database = openDatabase(config.databasePath);
  try {
    checks.push({ name: 'database', status: 'ok', detail: config.databasePath });
    const pending = pendingMigrations(database);
    if (pending.length > 0) {
      checks.push({ name: 'migrations', status: 'fail', detail: `${pending.length} pending; run websnapper db migrate` });
    } else {
      checks.push({ name: 'migrations', status: 'ok', detail: 'up to date' });
      const activeKeys = countActiveKeys(database);
      if (config.authMode === 'open') {
        checks.push({ name: 'auth', status: 'warn', detail: 'open: no authentication' });
      } else {
        checks.push({ name: 'auth', status: activeKeys === 0 ? 'warn' : 'ok', detail: `token: ${activeKeys} active key(s)` });
      }
      const policy = createUrlPolicy(config, database);
      policy.refresh();
      const isEmptyAllowList = policy.mode === 'allow-list' && policy.ruleCount() === 0;
      checks.push({
        name: 'url policy',
        status: isEmptyAllowList ? 'warn' : 'ok',
        detail: `${policy.mode}, scope ${policy.scope}, ${policy.ruleCount()} rule(s)${isEmptyAllowList ? ': every URL will be refused' : ''}`,
      });
    }
  } finally {
    database.close();
  }
  return checks;
}

/** Launches and closes Chromium. */
async function browserCheck(context: CommandContext): Promise<Check> {
  const host = new BrowserHost(context.config.browser, context.logger);
  let check: Check;
  try {
    const version = await host.start();
    check = { name: 'chromium', status: 'ok', detail: `${version} at ${context.config.browser.chromiumPath}` };
  } catch (error) {
    check = { name: 'chromium', status: 'fail', detail: `${context.config.browser.chromiumPath}: ${(error as Error).message}` };
  } finally {
    await host.close();
  }
  return check;
}

/** Runs every check and summarises them. */
async function doctor(context: CommandContext): Promise<CommandResult> {
  const checks = [{ name: 'config', status: 'ok', detail: 'valid' } as Check, ...databaseChecks(context), await browserCheck(context)];
  const failed = checks.filter((check) => check.status === 'fail');
  const migrationsPending = failed.some((check) => check.name === 'migrations');
  let exitCode: CommandResult['exitCode'];
  if (failed.length === 0) {
    exitCode = ExitCode.success;
  } else if (migrationsPending && failed.length === 1) {
    exitCode = ExitCode.notReady;
  } else {
    exitCode = ExitCode.failure;
  }
  const width = Math.max(...checks.map((check) => check.name.length));
  const text = checks.map((check) => `${check.status.toUpperCase().padEnd(4)}  ${check.name.padEnd(width)}  ${check.detail}`).join('\n');
  return { exitCode, data: { checks }, text };
}

export const doctorCommand: Command = {
  path: ['doctor'],
  summary: 'Check configuration, database, rules and Chromium.',
  usage: 'websnapper doctor',
  run: doctor,
};
