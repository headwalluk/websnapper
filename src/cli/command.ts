import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import type { ParsedArgs } from './args.js';
import type { ExitCodeValue } from './exit-codes.js';

export interface CommandContext {
  args: ParsedArgs;
  config: Config;
  json: boolean;
  logger: Logger;
}

/** What a command returns. With --json, data is printed as the result; otherwise text is. */
export interface CommandResult {
  exitCode: ExitCodeValue;
  data: Record<string, unknown>;
  text: string;
}

export interface Command {
  /** Words that select the command, such as ["key", "create"]. */
  path: string[];
  summary: string;
  usage: string;
  run(context: CommandContext): Promise<CommandResult>;
}
