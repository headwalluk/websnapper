import type { Config } from '../../config.js';
import type { Command } from '../command.js';
import { ExitCode } from '../exit-codes.js';

/** Returns the config as plain data; address lists become their entries. */
export function describeConfig(config: Config): Record<string, unknown> {
  return {
    ...config,
    trustedProxies: config.trustedProxies.entries,
    rateLimit: { ...config.rateLimit, exempt: config.rateLimit.exempt.entries },
  };
}

export const configCommand: Command = {
  path: ['config'],
  summary: 'Show the effective configuration.',
  usage: 'websnapper config',
  run: async ({ config }) => {
    const described = describeConfig(config);
    return { exitCode: ExitCode.success, data: { config: described }, text: JSON.stringify(described, null, 2) };
  },
};
