import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createUrlPolicy } from '../../runtime.js';
import { addRule, exportRules, importRules, listRules, removeRule } from '../../services/rule-service.js';
import { stringFlag } from '../args.js';
import type { Command, CommandResult } from '../command.js';
import { ExitCode } from '../exit-codes.js';
import { confirm, formatTime, idArgument, refusedResult, serviceErrorResult, table, usageResult, withDatabase } from '../helpers.js';

export const ruleAddCommand: Command = {
  path: ['rule', 'add'],
  summary: 'Add a URL rule (a JavaScript regular expression).',
  usage: "websnapper rule add '<pattern>' [--note <text>]",
  run: async ({ args, config }) => {
    const pattern = args.words[2];
    if (pattern === undefined) {
      return usageResult(`Usage: ${ruleAddCommand.usage}`);
    }
    return withDatabase(config, async (database) => {
      let result: CommandResult;
      try {
        const rule = addRule(database, pattern, stringFlag(args, 'note') ?? '', Date.now());
        result = { exitCode: ExitCode.success, data: { rule }, text: `Added rule ${rule.id}: ${rule.pattern}` };
      } catch (error) {
        result = serviceErrorResult(error);
      }
      return result;
    });
  },
};

export const ruleListCommand: Command = {
  path: ['rule', 'list'],
  summary: 'List URL rules.',
  usage: 'websnapper rule list',
  run: ({ config }) => withDatabase(config, async (database) => {
    const rules = listRules(database);
    const rows = rules.map((rule) => [String(rule.id), rule.pattern, rule.note, formatTime(rule.createdAt)]);
    const heading = `URL policy: ${config.urlPolicy.mode} (scope ${config.urlPolicy.scope})`;
    return {
      exitCode: ExitCode.success,
      data: { mode: config.urlPolicy.mode, scope: config.urlPolicy.scope, rules },
      text: rules.length === 0 ? `${heading}\nNo rules.` : `${heading}\n\n${table(['ID', 'PATTERN', 'NOTE', 'CREATED'], rows)}`,
    };
  }),
};

export const ruleRemoveCommand: Command = {
  path: ['rule', 'remove'],
  summary: 'Remove a URL rule.',
  usage: 'websnapper rule remove <id> [--yes]',
  run: async ({ args, config }) => {
    const id = idArgument(args.words[2]);
    if (id === null) {
      return usageResult(`Usage: ${ruleRemoveCommand.usage}`);
    }
    if (!(await confirm(args, `Remove rule ${id}?`))) {
      return refusedResult();
    }
    return withDatabase(config, async (database) => (removeRule(database, id)
      ? { exitCode: ExitCode.success, data: { id }, text: `Removed rule ${id}.` }
      : { exitCode: ExitCode.failure, data: { error: `No rule ${id}.` }, text: `No rule ${id}.` }));
  },
};

export const ruleTestCommand: Command = {
  path: ['rule', 'test'],
  summary: 'Show whether the URL policy allows a URL, and which rule matched.',
  usage: 'websnapper rule test <url>',
  run: async ({ args, config }) => {
    const url = args.words[2];
    if (url === undefined) {
      return usageResult(`Usage: ${ruleTestCommand.usage}`);
    }
    return withDatabase(config, async (database) => {
      const policy = createUrlPolicy(config, database);
      policy.refresh();
      const verdict = policy.evaluate(url, true);
      const ruleText = verdict.matchedRule === null ? '' : `\nMatched rule ${verdict.matchedRule.id}: ${verdict.matchedRule.pattern}`;
      return {
        exitCode: verdict.allowed ? ExitCode.success : ExitCode.refused,
        data: { url, mode: policy.mode, ...verdict },
        text: `${verdict.allowed ? 'ALLOWED' : 'BLOCKED'} (${policy.mode}): ${verdict.reason}${ruleText}`,
      };
    });
  },
};

export const ruleImportCommand: Command = {
  path: ['rule', 'import'],
  summary: 'Import rules from a file, one pattern per line; "#" lines become notes.',
  usage: 'websnapper rule import <file>',
  run: async ({ args, config }) => {
    const file = args.words[2];
    if (file === undefined) {
      return usageResult(`Usage: ${ruleImportCommand.usage}`);
    }
    const text = await readFile(resolve(file), 'utf8');
    return withDatabase(config, async (database) => {
      let result: CommandResult;
      try {
        const { added, skipped } = importRules(database, text, Date.now());
        result = { exitCode: ExitCode.success, data: { added, skipped }, text: `Imported ${added.length} rule(s); skipped ${skipped.length} already present.` };
      } catch (error) {
        result = serviceErrorResult(error);
      }
      return result;
    });
  },
};

export const ruleExportCommand: Command = {
  path: ['rule', 'export'],
  summary: 'Print every rule in the format rule import reads.',
  usage: 'websnapper rule export > rules.txt',
  run: ({ config }) => withDatabase(config, async (database) => {
    const rules = listRules(database);
    return { exitCode: ExitCode.success, data: { rules }, text: exportRules(rules) };
  }),
};
