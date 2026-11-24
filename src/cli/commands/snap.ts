import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSnapshotRuntime } from '../../runtime.js';
import { parseSnapshotRequest } from '../../services/snapshot-request.js';
import { booleanFlag, stringFlag, type ParsedArgs } from '../args.js';
import type { Command, CommandContext, CommandResult } from '../command.js';
import { ExitCode } from '../exit-codes.js';
import { serviceErrorResult, usageResult, withDatabase } from '../helpers.js';

const STDOUT_MARKER = '-';
/** CLI flag to API parameter, for flags that carry a value. */
const VALUE_FLAGS = { viewport: 'viewport', width: 'width', height: 'height', format: 'format', quality: 'quality', wait: 'wait', 'delay-ms': 'delay_ms' } as const;

/** Turns CLI flags into the same parameters the HTTP API takes. */
function snapshotParameters(args: ParsedArgs, url: string): URLSearchParams {
  const parameters = new URLSearchParams({ url });
  for (const [flag, parameter] of Object.entries(VALUE_FLAGS)) {
    const value = stringFlag(args, flag);
    if (value !== undefined) {
      parameters.set(parameter, value);
    }
  }
  if (booleanFlag(args, 'full')) {
    parameters.set('full', '1');
  }
  return parameters;
}

/** Takes one snapshot through the same service the server uses. */
async function snap(context: CommandContext): Promise<CommandResult> {
  const url = context.args.words[1];
  const output = stringFlag(context.args, 'output');
  if (url === undefined || output === undefined) {
    return usageResult(`Usage: ${snapCommand.usage}`);
  }
  if (output === STDOUT_MARKER && context.json) {
    return usageResult('--json cannot be combined with --output -, which writes the image to stdout.');
  }
  return withDatabase(context.config, async (database) => {
    const runtime = createSnapshotRuntime(context.config, database, context.logger);
    let result: CommandResult;
    try {
      const request = parseSnapshotRequest(snapshotParameters(context.args, url), context.config.snapshot);
      const snapshot = await runtime.service.capture(request);
      const outputPath = output === STDOUT_MARKER ? STDOUT_MARKER : resolve(output);
      if (outputPath === STDOUT_MARKER) {
        process.stdout.write(snapshot.image);
      } else {
        await writeFile(outputPath, snapshot.image);
      }
      const summary = { output: outputPath, bytes: snapshot.image.byteLength, contentType: snapshot.contentType, finalUrl: snapshot.finalUrl, renderMs: snapshot.renderMs };
      result = {
        exitCode: ExitCode.success,
        data: summary,
        text: outputPath === STDOUT_MARKER ? '' : `Wrote ${summary.bytes} bytes (${summary.contentType}) to ${outputPath} in ${summary.renderMs} ms.`,
      };
    } catch (error) {
      result = serviceErrorResult(error);
    } finally {
      await runtime.host.close();
    }
    return result;
  });
}

export const snapCommand: Command = {
  path: ['snap'],
  summary: 'Take a snapshot locally, without the HTTP server.',
  usage: 'websnapper snap <url> --output <file|-> [--viewport <slug> | --width <px> [--height <px>]] [--full] [--format png|jpeg|webp] [--quality 1-100] [--wait load|networkidle] [--delay-ms <ms>]',
  run: snap,
};
