import { VIEWPORT_PRESETS } from '../../browser/viewports.js';
import type { Command } from '../command.js';
import { ExitCode } from '../exit-codes.js';
import { table } from '../helpers.js';

export const viewportsCommand: Command = {
  path: ['viewports'],
  summary: 'List viewport presets.',
  usage: 'websnapper viewports',
  run: async () => {
    const presets = [...VIEWPORT_PRESETS.values()];
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
