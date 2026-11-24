import type { LogLevel } from './config.js';

type Severity = LogLevel | 'error';

/** error always writes; the configured level adds warn, info and debug below it. */
const SEVERITY_ORDER: Record<Severity, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  error(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  debug(message: string, details?: Record<string, unknown>): void;
  child(tag: string): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  tag: string;
  /** When true every line goes to stderr, keeping stdout clean for --json output. */
  stderrOnly?: boolean;
}

/** Converts Error values in details into plain objects that JSON.stringify can show. */
function serialiseDetails(details: Record<string, unknown>): string {
  return JSON.stringify(details, (unusedKey, value: unknown) => (
    value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value
  ));
}

/** Creates a levelled logger writing single lines through console.log and console.error. */
export function createLogger(options: LoggerOptions): Logger {
  const threshold = SEVERITY_ORDER[options.level];

  const write = (severity: Severity, message: string, details?: Record<string, unknown>): void => {
    if (SEVERITY_ORDER[severity] >= threshold) {
      const suffix = details === undefined ? '' : ` ${serialiseDetails(details)}`;
      const line = `${new Date().toISOString()} ${severity.padEnd(5)} [${options.tag}] ${message}${suffix}`;
      if (options.stderrOnly === true || SEVERITY_ORDER[severity] >= SEVERITY_ORDER.warn) {
        console.error(line);
      } else {
        console.log(line);
      }
    }
  };

  return {
    error: (message, details) => write('error', message, details),
    warn: (message, details) => write('warn', message, details),
    info: (message, details) => write('info', message, details),
    debug: (message, details) => write('debug', message, details),
    child: (tag) => createLogger({ ...options, tag: `${options.tag}:${tag}` }),
  };
}
