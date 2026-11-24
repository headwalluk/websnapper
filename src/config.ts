import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { parseAddressList, type AddressList } from './net/address-list.js';

export type LogLevel = 'warn' | 'info' | 'debug';
export type AuthMode = 'open' | 'token';
export type UrlPolicyMode = 'open' | 'allow-list' | 'block-list';
export type UrlPolicyScope = 'all' | 'navigation';
export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const LOG_LEVELS = ['warn', 'info', 'debug'] as const;
export const AUTH_MODES = ['open', 'token'] as const;
export const URL_POLICY_MODES = ['open', 'allow-list', 'block-list'] as const;
export const URL_POLICY_SCOPES = ['all', 'navigation'] as const;
export const IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const;

/** Chromium cannot composite a surface taller than this. */
export const CHROMIUM_MAX_SURFACE_PX = 16384;
const MAX_PORT = 65535;
const MAX_QUALITY = 100;
const VARIABLE_PREFIX = 'WEBSNAPPER_';
const ENV_FILE_VARIABLE = 'WEBSNAPPER_ENV_FILE';

export interface Config {
  logLevel: LogLevel;
  listen: { host: string; port: number };
  trustedProxies: AddressList;
  authMode: AuthMode;
  databasePath: string;
  urlPolicy: { mode: UrlPolicyMode; scope: UrlPolicyScope };
  browser: {
    chromiumPath: string;
    ignoreTlsErrors: boolean;
    recycleAfter: number;
    navigationTimeoutMs: number;
  };
  pool: { size: number; queueMax: number; queueTimeoutMs: number };
  snapshot: {
    defaultFormat: ImageFormat;
    defaultQuality: number;
    maxWidthPx: number;
    maxHeightPx: number;
    maxFullHeightPx: number;
    maxDelayMs: number;
  };
  rateLimit: {
    perMinute: number;
    burst: number;
    banStrikes: number;
    banWindowSeconds: number;
    banDurationSeconds: number;
    exempt: AddressList;
  };
  /** PM2's NODE_APP_INSTANCE, '0' when not clustered. */
  workerIndex: string;
}

/** Thrown when configuration is invalid; lists every problem found. */
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** Every setting this app reads. A prefixed name that isn't here is reported as a likely typo. */
export const KNOWN_VARIABLES = new Set([
  ENV_FILE_VARIABLE,
  'WEBSNAPPER_HOST', 'WEBSNAPPER_PORT', 'WEBSNAPPER_TRUSTED_PROXIES', 'WEBSNAPPER_LOG_LEVEL',
  'WEBSNAPPER_AUTH_MODE', 'WEBSNAPPER_DATABASE_PATH',
  'WEBSNAPPER_URL_POLICY', 'WEBSNAPPER_URL_POLICY_SCOPE',
  'WEBSNAPPER_CHROMIUM_PATH', 'WEBSNAPPER_POOL_SIZE', 'WEBSNAPPER_QUEUE_MAX', 'WEBSNAPPER_QUEUE_TIMEOUT_MS',
  'WEBSNAPPER_NAVIGATION_TIMEOUT_MS', 'WEBSNAPPER_BROWSER_RECYCLE_AFTER', 'WEBSNAPPER_IGNORE_TLS_ERRORS',
  'WEBSNAPPER_DEFAULT_FORMAT', 'WEBSNAPPER_DEFAULT_QUALITY', 'WEBSNAPPER_MAX_WIDTH_PX', 'WEBSNAPPER_MAX_HEIGHT_PX',
  'WEBSNAPPER_MAX_FULL_HEIGHT_PX', 'WEBSNAPPER_MAX_DELAY_MS',
  'WEBSNAPPER_RATE_LIMIT_PER_MINUTE', 'WEBSNAPPER_RATE_LIMIT_BURST', 'WEBSNAPPER_BAN_STRIKES',
  'WEBSNAPPER_BAN_WINDOW_SECONDS', 'WEBSNAPPER_BAN_DURATION_SECONDS', 'WEBSNAPPER_RATE_LIMIT_EXEMPT',
]);

/** Collects parse problems while reading typed values out of a variable map. */
class VariableReader {
  readonly problems: string[] = [];
  private readonly variables: Record<string, string | undefined>;

  constructor(variables: Record<string, string | undefined>) {
    this.variables = variables;
  }

  /** Returns a trimmed value, or undefined when unset or empty. */
  raw(name: string): string | undefined {
    const value = this.variables[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  }

  /** Returns the value, or the fallback when unset. */
  optional(name: string, fallback: string): string {
    return this.raw(name) ?? fallback;
  }

  /** Returns one of a fixed set of values, recording a problem for anything else. */
  choice<Choice extends string>(name: string, choices: readonly Choice[], fallback: Choice): Choice {
    const value = this.raw(name) ?? fallback;
    const matched = choices.find((candidate) => candidate === value);
    if (matched === undefined) {
      this.problems.push(`${name} must be one of ${choices.join(', ')}; got "${value}".`);
    }
    return matched ?? fallback;
  }

  /** Returns a whole number within bounds, recording a problem for anything else. */
  integer(name: string, fallback: number, minimum: number, maximum: number): number {
    const value = this.raw(name);
    const parsed = value === undefined ? fallback : Number(value);
    const isValid = Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum;
    if (!isValid) {
      this.problems.push(`${name} must be a whole number from ${minimum} to ${maximum}; got "${value}".`);
    }
    return isValid ? parsed : fallback;
  }

  /** Returns a boolean from true/false/1/0/yes/no. */
  flag(name: string, fallback: boolean): boolean {
    const value = this.raw(name)?.toLowerCase();
    let result = fallback;
    if (value === 'true' || value === '1' || value === 'yes') {
      result = true;
    } else if (value === 'false' || value === '0' || value === 'no') {
      result = false;
    } else if (value !== undefined) {
      this.problems.push(`${name} must be true or false; got "${value}".`);
    }
    return result;
  }

  /** Returns a comma-separated list of IP addresses and CIDR ranges. */
  addresses(name: string): AddressList {
    const value = this.raw(name) ?? '';
    const entries = value.split(',').map((item) => item.trim()).filter((item) => item !== '');
    const parsed = parseAddressList(entries);
    for (const invalidEntry of parsed.invalidEntries) {
      this.problems.push(`${name} must list IP addresses or CIDR ranges; got "${invalidEntry}".`);
    }
    return parsed.list;
  }
}

/** Reads a .env file into a plain map; empty when the file doesn't exist. */
export function readEnvFile(envFilePath: string): Record<string, string> {
  const fileVariables = existsSync(envFilePath) ? parseEnv(readFileSync(envFilePath, 'utf8')) : {};
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(fileVariables)) {
    if (value !== undefined) {
      variables[name] = value;
    }
  }
  return variables;
}

/** Validates and normalises settings into a Config. Relative paths resolve against baseDirectory. */
export function loadConfig(variables: Record<string, string | undefined>, baseDirectory: string): Config {
  const reader = new VariableReader(variables);

  for (const name of Object.keys(variables)) {
    if (name.startsWith(VARIABLE_PREFIX) && !KNOWN_VARIABLES.has(name)) {
      reader.problems.push(`Unknown setting ${name}. Check for a typo.`);
    }
  }

  const databasePath = reader.optional('WEBSNAPPER_DATABASE_PATH', './data/websnapper.sqlite');
  const config: Config = {
    logLevel: reader.choice('WEBSNAPPER_LOG_LEVEL', LOG_LEVELS, 'info'),
    listen: {
      host: reader.optional('WEBSNAPPER_HOST', '127.0.0.1'),
      port: reader.integer('WEBSNAPPER_PORT', 8490, 1, MAX_PORT),
    },
    trustedProxies: reader.addresses('WEBSNAPPER_TRUSTED_PROXIES'),
    authMode: reader.choice('WEBSNAPPER_AUTH_MODE', AUTH_MODES, 'token'),
    databasePath: isAbsolute(databasePath) ? databasePath : resolve(baseDirectory, databasePath),
    urlPolicy: {
      mode: reader.choice('WEBSNAPPER_URL_POLICY', URL_POLICY_MODES, 'open'),
      scope: reader.choice('WEBSNAPPER_URL_POLICY_SCOPE', URL_POLICY_SCOPES, 'all'),
    },
    browser: {
      chromiumPath: reader.optional('WEBSNAPPER_CHROMIUM_PATH', '/usr/bin/chromium'),
      ignoreTlsErrors: reader.flag('WEBSNAPPER_IGNORE_TLS_ERRORS', false),
      recycleAfter: reader.integer('WEBSNAPPER_BROWSER_RECYCLE_AFTER', 500, 1, 1_000_000),
      navigationTimeoutMs: reader.integer('WEBSNAPPER_NAVIGATION_TIMEOUT_MS', 20_000, 1000, 300_000),
    },
    pool: {
      size: reader.integer('WEBSNAPPER_POOL_SIZE', 3, 1, 64),
      queueMax: reader.integer('WEBSNAPPER_QUEUE_MAX', 20, 0, 10_000),
      queueTimeoutMs: reader.integer('WEBSNAPPER_QUEUE_TIMEOUT_MS', 15_000, 100, 300_000),
    },
    snapshot: {
      defaultFormat: reader.choice('WEBSNAPPER_DEFAULT_FORMAT', IMAGE_FORMATS, 'png'),
      defaultQuality: reader.integer('WEBSNAPPER_DEFAULT_QUALITY', 80, 1, MAX_QUALITY),
      maxWidthPx: reader.integer('WEBSNAPPER_MAX_WIDTH_PX', 3840, 100, CHROMIUM_MAX_SURFACE_PX),
      maxHeightPx: reader.integer('WEBSNAPPER_MAX_HEIGHT_PX', 2160, 100, CHROMIUM_MAX_SURFACE_PX),
      maxFullHeightPx: reader.integer('WEBSNAPPER_MAX_FULL_HEIGHT_PX', 16_000, 100, CHROMIUM_MAX_SURFACE_PX),
      maxDelayMs: reader.integer('WEBSNAPPER_MAX_DELAY_MS', 5000, 0, 60_000),
    },
    rateLimit: {
      perMinute: reader.integer('WEBSNAPPER_RATE_LIMIT_PER_MINUTE', 60, 1, 100_000),
      burst: reader.integer('WEBSNAPPER_RATE_LIMIT_BURST', 10, 1, 100_000),
      banStrikes: reader.integer('WEBSNAPPER_BAN_STRIKES', 20, 1, 100_000),
      banWindowSeconds: reader.integer('WEBSNAPPER_BAN_WINDOW_SECONDS', 60, 1, 86_400),
      banDurationSeconds: reader.integer('WEBSNAPPER_BAN_DURATION_SECONDS', 900, 1, 2_592_000),
      exempt: reader.addresses('WEBSNAPPER_RATE_LIMIT_EXEMPT'),
    },
    workerIndex: variables.NODE_APP_INSTANCE ?? '0',
  };

  if (config.snapshot.maxHeightPx > config.snapshot.maxFullHeightPx) {
    reader.problems.push('WEBSNAPPER_MAX_HEIGHT_PX must not be larger than WEBSNAPPER_MAX_FULL_HEIGHT_PX.');
  }
  if (reader.problems.length > 0) {
    throw new ConfigError(reader.problems);
  }
  return config;
}

/** Returns the .env path to read: WEBSNAPPER_ENV_FILE when set, otherwise the given default. */
export function resolveEnvFilePath(defaultPath: string): string {
  const override = process.env[ENV_FILE_VARIABLE]?.trim();
  return override === undefined || override === '' ? defaultPath : resolve(override);
}

/** Reads the .env file and the process environment (which wins) and loads the Config. */
export function loadConfigFromEnvironment(defaultEnvFilePath: string, baseDirectory: string): Config {
  const envFilePath = resolveEnvFilePath(defaultEnvFilePath);
  return loadConfig({ ...readEnvFile(envFilePath), ...process.env }, baseDirectory);
}
