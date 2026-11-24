import { addBan, liftBan, listActiveBans } from '../../services/ban-service.js';
import { stringFlag } from '../args.js';
import type { Command, CommandResult } from '../command.js';
import { ExitCode } from '../exit-codes.js';
import { formatTime, serviceErrorResult, table, usageResult, withDatabase } from '../helpers.js';

const MS_PER_MINUTE = 60_000;
const DEFAULT_MANUAL_BAN_MINUTES = 60;
const MANUAL_BAN_REASON = 'Banned by the operator.';

export const banListCommand: Command = {
  path: ['ban', 'list'],
  summary: 'List active bans.',
  usage: 'websnapper ban list',
  run: ({ config }) => withDatabase(config, async (database) => {
    const bans = listActiveBans(database, Date.now());
    const rows = bans.map((ban) => [ban.ip, formatTime(ban.createdAt), formatTime(ban.expiresAt), ban.reason]);
    return { exitCode: ExitCode.success, data: { bans }, text: bans.length === 0 ? 'No active bans.' : table(['IP', 'SINCE', 'UNTIL', 'REASON'], rows) };
  }),
};

export const banLiftCommand: Command = {
  path: ['ban', 'lift'],
  summary: 'Lift a ban now, rather than waiting for it to expire.',
  usage: 'websnapper ban lift <ip>',
  run: async ({ args, config }) => {
    const ip = args.words[2];
    if (ip === undefined) {
      return usageResult(`Usage: ${banLiftCommand.usage}`);
    }
    return withDatabase(config, async (database) => {
      let result: CommandResult;
      try {
        result = liftBan(database, ip, Date.now())
          ? { exitCode: ExitCode.success, data: { ip }, text: `Lifted the ban on ${ip}.` }
          : { exitCode: ExitCode.failure, data: { error: `${ip} is not banned.` }, text: `${ip} is not banned.` };
      } catch (error) {
        result = serviceErrorResult(error);
      }
      return result;
    });
  },
};

export const banAddCommand: Command = {
  path: ['ban', 'add'],
  summary: 'Ban an address for a number of minutes.',
  usage: `websnapper ban add <ip> [--minutes <n>]  (default ${DEFAULT_MANUAL_BAN_MINUTES})`,
  run: async ({ args, config }) => {
    const ip = args.words[2];
    const minutesText = stringFlag(args, 'minutes') ?? String(DEFAULT_MANUAL_BAN_MINUTES);
    const minutes = /^\d+$/.test(minutesText) ? Number(minutesText) : 0;
    if (ip === undefined || minutes < 1) {
      return usageResult(`Usage: ${banAddCommand.usage}`);
    }
    return withDatabase(config, async (database) => {
      let result: CommandResult;
      try {
        const ban = addBan(database, ip, MANUAL_BAN_REASON, minutes * MS_PER_MINUTE, Date.now());
        result = { exitCode: ExitCode.success, data: { ban }, text: `Banned ${ban.ip} until ${formatTime(ban.expiresAt)}.` };
      } catch (error) {
        result = serviceErrorResult(error);
      }
      return result;
    });
  },
};
