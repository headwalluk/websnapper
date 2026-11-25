import { availableViewports } from '../../browser/viewports.js';
import type { Command } from '../command.js';
import { ExitCode } from '../exit-codes.js';
import { table } from '../helpers.js';

export const viewportsCommand: Command = {
  path: ['viewports'],
  summary: 'List the viewport presets the configured size limits allow.',
  usage: 'websnapper viewports',
  run: async (context) => {
    const presets = availableViewports(context.config.snapshot);
    const rows = presets.map((preset) => [
      preset.slug,
      `${preset.width}x${preset.height}`,
      `@${preset.deviceScaleFactor}x`,
      preset.isMobile ? 'mobile' : '',
      preset.label,
    ]);
    return { exitCode: ExitCode.success, data: { viewports: presets }, text: table(['SLUG', 'SIZE', 'SCALE', 'TYPE', 'NAME'], rows) };
  },
};
