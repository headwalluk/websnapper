import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORK_DIRECTORY = mkdtempSync(join(tmpdir(), 'websnapper-cli-'));
const BASE_ENVIRONMENT = {
  // eslint-disable-next-line no-restricted-properties -- the child CLI needs PATH and nothing else from this environment
  PATH: process.env.PATH ?? '',
  WEBSNAPPER_ENV_FILE: join(WORK_DIRECTORY, 'absent.env'),
  WEBSNAPPER_DATABASE_PATH: join(WORK_DIRECTORY, 'cli.sqlite'),
};

after(() => rmSync(WORK_DIRECTORY, { recursive: true, force: true }));

/** Runs the CLI from source and captures its output. */
function runCli(args: string[], environment: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args], {
    cwd: PROJECT_ROOT,
    env: { ...BASE_ENVIRONMENT, ...environment },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('--help lists commands and exits 0', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /websnapper rule test/);
});

test('version prints the package version', () => {
  assert.match(runCli(['version']).stdout, /^\d+\.\d+\.\d+\n$/);
});

test('an unknown command exits with the usage code', () => {
  assert.equal(runCli(['frobnicate']).status, 2);
});

test('invalid configuration lists every problem and exits 3', () => {
  const result = runCli(['config'], { WEBSNAPPER_PORT: 'nope', WEBSNAPPER_AUTH_MODE: 'maybe' });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /WEBSNAPPER_PORT/);
  assert.match(result.stderr, /WEBSNAPPER_AUTH_MODE/);
});

test('data commands refuse until migrated, then key and rule commands work with --json', () => {
  assert.equal(runCli(['key', 'list']).status, 5);
  assert.equal(runCli(['db', 'migrate']).status, 0);
  const created = JSON.parse(runCli(['key', 'create', '--label', 'ci', '--json']).stdout) as { ok: boolean; token: string };
  assert.equal(created.ok, true);
  assert.match(created.token, /^wsk_/);
  assert.equal(runCli(['key', 'revoke', '1']).status, 4, 'revoking needs --yes when not on a terminal');
  assert.equal(runCli(['key', 'revoke', '1', '--yes']).status, 0);
  assert.equal(runCli(['rule', 'add', '(bad']).status, 2);
  assert.equal(runCli(['rule', 'add', '^https?://10\\.']).status, 0);
  const blocked = runCli(['rule', 'test', 'http://10.0.0.1/', '--json'], { WEBSNAPPER_URL_POLICY: 'block-list' });
  assert.equal(blocked.status, 4);
  assert.equal((JSON.parse(blocked.stdout) as { allowed: boolean }).allowed, false);
});
