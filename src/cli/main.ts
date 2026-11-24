import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfigFromEnvironment } from '../config.js';
import { createLogger } from '../logger.js';
import { booleanFlag, parseArgs, type ParsedArgs } from './args.js';
import type { Command, CommandResult } from './command.js';
import { ExitCode } from './exit-codes.js';
import { banAddCommand, banLiftCommand, banListCommand } from './commands/bans.js';
import { dbMigrateCommand, dbStatusCommand } from './commands/database.js';
import { doctorCommand } from './commands/doctor.js';
import { keyCreateCommand, keyListCommand, keyRevokeCommand } from './commands/keys.js';
import { ruleAddCommand, ruleExportCommand, ruleImportCommand, ruleListCommand, ruleRemoveCommand, ruleTestCommand } from './commands/rules.js';
import { serveCommand } from './commands/serve.js';
import { configCommand } from './commands/show-config.js';
import { snapCommand } from './commands/snap.js';
import { viewportsCommand } from './commands/viewports.js';

const CLI_NAME = 'websnapper';
/** The project root, one level above src/ and dist/; relative paths in .env resolve against it. */
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** The project's .env, beside package.json, wherever the command is run from. */
const ENV_FILE_PATH = fileURLToPath(new URL('../../.env', import.meta.url));
const COMMANDS: Command[] = [
  serveCommand, snapCommand, viewportsCommand,
  keyCreateCommand, keyListCommand, keyRevokeCommand,
  ruleAddCommand, ruleListCommand, ruleRemoveCommand, ruleTestCommand, ruleImportCommand, ruleExportCommand,
  banListCommand, banLiftCommand, banAddCommand,
  dbMigrateCommand, dbStatusCommand, doctorCommand, configCommand,
];

/** Reads the package version from package.json, one level above src/ and dist/. */
function packageVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return packageJson.version;
}

/** Finds the command whose path matches the leading words. */
function findCommand(args: ParsedArgs): Command | undefined {
  return COMMANDS.find((command) => command.path.every((word, position) => args.words[position] === word));
}

/** Lists every command with its summary. */
function helpText(): string {
  const width = Math.max(...COMMANDS.map((command) => command.path.join(' ').length), 'version'.length);
  const lines = COMMANDS.map((command) => `  ${CLI_NAME} ${command.path.join(' ').padEnd(width)}  ${command.summary}`);
  return [
    `${CLI_NAME} ${packageVersion()}`,
    '',
    'Commands:',
    ...lines,
    `  ${CLI_NAME} ${'version'.padEnd(width)}  Show the version.`,
    '',
    'Common flags: --json, --yes, --help. Exit codes are listed in docs/cli.md.',
  ].join('\n');
}

/** Runs the CLI and resolves to the process exit code. */
async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const json = booleanFlag(args, 'json');
  const command = findCommand(args);
  let result: CommandResult;

  if (args.problems.length > 0) {
    result = { exitCode: ExitCode.usage, data: { error: args.problems.join(' ') }, text: args.problems.join('\n') };
  } else if (args.words[0] === 'version') {
    result = { exitCode: ExitCode.success, data: { version: packageVersion() }, text: packageVersion() };
  } else if (command === undefined || booleanFlag(args, 'help')) {
    const isKnown = args.words.length === 0 || command !== undefined || args.words[0] === 'help';
    result = {
      exitCode: isKnown ? ExitCode.success : ExitCode.usage,
      data: isKnown ? { commands: COMMANDS.map((entry) => entry.usage) } : { error: `Unknown command: ${args.words.join(' ')}` },
      text: command === undefined ? helpText() : `${command.summary}\n\nUsage: ${command.usage}`,
    };
  } else {
    try {
      const config = loadConfigFromEnvironment(ENV_FILE_PATH, PROJECT_ROOT);
      const logger = createLogger({ level: config.logLevel, tag: 'cli', stderrOnly: true });
      result = await command.run({ args, config, json, logger });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ConfigError) {
        result = { exitCode: ExitCode.invalidConfig, data: { error: 'Invalid configuration', problems: error.problems }, text: message };
      } else {
        console.error(error);
        result = { exitCode: ExitCode.failure, data: { error: message }, text: '' };
      }
    }
  }

  if (json) {
    console.log(JSON.stringify({ ok: result.exitCode === ExitCode.success, exitCode: result.exitCode, ...result.data }));
  } else if (result.text !== '') {
    const write = result.exitCode === ExitCode.success ? console.log : console.error;
    write(result.text);
  }
  return result.exitCode;
}

// Never process.exit() here: it drops output still queued for a pipe.
main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = ExitCode.failure;
  });
