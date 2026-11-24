import { createKey, listKeys, revokeKey } from '../../services/key-service.js';
import { stringFlag } from '../args.js';
import type { Command, CommandResult } from '../command.js';
import { ExitCode } from '../exit-codes.js';
import { confirm, formatTime, idArgument, refusedResult, serviceErrorResult, table, usageResult, withDatabase } from '../helpers.js';

export const keyCreateCommand: Command = {
  path: ['key', 'create'],
  summary: 'Mint an API key. The token is shown once.',
  usage: 'websnapper key create --label <text>',
  run: async ({ args, config }) => {
    const label = stringFlag(args, 'label');
    if (label === undefined) {
      return usageResult(`Usage: ${keyCreateCommand.usage}`);
    }
    return withDatabase(config, async (database) => {
      let result: CommandResult;
      try {
        const { key, token } = createKey(database, label, Date.now());
        result = {
          exitCode: ExitCode.success,
          data: { id: key.id, label: key.label, token },
          text: `Created key ${key.id} (${key.label}). Store this token now; it cannot be shown again:\n\n${token}`,
        };
      } catch (error) {
        result = serviceErrorResult(error);
      }
      return result;
    });
  },
};

export const keyListCommand: Command = {
  path: ['key', 'list'],
  summary: 'List API keys.',
  usage: 'websnapper key list',
  run: ({ config }) => withDatabase(config, async (database) => {
    const keys = listKeys(database);
    const rows = keys.map((key) => [String(key.id), key.label, formatTime(key.createdAt), formatTime(key.lastUsedAt), key.revokedAt === null ? 'active' : `revoked ${formatTime(key.revokedAt)}`]);
    return {
      exitCode: ExitCode.success,
      data: { keys },
      text: keys.length === 0 ? 'No keys. Create one with: websnapper key create --label <text>' : table(['ID', 'LABEL', 'CREATED', 'LAST USED', 'STATUS'], rows),
    };
  }),
};

export const keyRevokeCommand: Command = {
  path: ['key', 'revoke'],
  summary: 'Revoke an API key.',
  usage: 'websnapper key revoke <id> [--yes]',
  run: async ({ args, config }) => {
    const id = idArgument(args.words[2]);
    if (id === null) {
      return usageResult(`Usage: ${keyRevokeCommand.usage}`);
    }
    if (!(await confirm(args, `Revoke key ${id}? Clients using it will be refused.`))) {
      return refusedResult();
    }
    return withDatabase(config, async (database) => {
      const revoked = revokeKey(database, id, Date.now());
      return revoked
        ? { exitCode: ExitCode.success, data: { id }, text: `Revoked key ${id}.` }
        : { exitCode: ExitCode.failure, data: { error: `No active key ${id}.` }, text: `No active key ${id}.` };
    });
  },
};
