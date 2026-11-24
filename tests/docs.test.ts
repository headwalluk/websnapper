import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ExitCode } from '../src/cli/exit-codes.js';
import { KNOWN_VARIABLES } from '../src/config.js';
import { ERROR_CODES } from '../src/errors.js';

/** Reads a file from docs/. */
function doc(name: string): string {
  return readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8');
}

test('every error code is documented in docs/api.md with its status', () => {
  const api = doc('api.md');
  for (const [code, { status }] of Object.entries(ERROR_CODES)) {
    assert.match(api, new RegExp(`\\| ${status} \\| \`${code}\` \\|`), `${code} (${status}) missing from docs/api.md`);
  }
});

test('every exit code is documented in docs/cli.md', () => {
  const cli = doc('cli.md');
  for (const [name, code] of Object.entries(ExitCode)) {
    assert.match(cli, new RegExp(`\\| ${code} \\| \`${name}\` \\|`), `exit code ${name} missing from docs/cli.md`);
  }
});

test('every setting is documented in docs/configuration.md', () => {
  const configuration = doc('configuration.md');
  for (const name of KNOWN_VARIABLES) {
    assert.ok(configuration.includes(`\`${name}\``), `${name} missing from docs/configuration.md`);
  }
});
